// 日边界 4:00 靶向用例（study.md「核心口径·日边界」「每日记账」「出卡顺序与重建」）。
// 存在意义：既有仿真固定在每天 10:00 学习，从没碰过 4:00 边界的边角；study.md 已拍板接受的两处记账分歧、
// 窗口右开界、learn-ahead 的 20 分钟整点，都只活在文档里没有测试钉死——将来很容易被人「好心修掉」。
// 本文件把这些行为固化成断言：期望值直接来自 study.md 与 queue.ts 现行为，改了这些行为这些测试就该失败。
//
// 单端测试；makeDb / seedWord / mkSettings 照抄 scheduler.test.ts（不 import 其它 *.test.ts，避免连带执行其用例）。
import Database from 'better-sqlite3'
import { drizzle as betterDrizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as proxyDrizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { Rating, State } from 'ts-fsrs'
import { runBatch as execBatch, runStmt as execStmt } from '../../../../main/dbExecutor'
import type { Db } from '@/db/client'
import * as words from '../words'
import { todayNewCount, todayReviewCount } from '../reviewLog'
import { dayWindow, nextDayAt } from '../time'
import { buildTodaySession, LEARN_AHEAD_MS, rate, StudySession } from './queue'
import type { Settings } from '@/settings'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../../drizzle', import.meta.url))

interface TestDb {
  db: Db
  sqlite: Database.Database
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeDb(): TestDb {
  const sqlite = new Database(':memory:')
  migrate(betterDrizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR })
  const db = proxyDrizzle(
    async (sql, params, method) => execStmt(sqlite, { sql, params, method }) as { rows: any[] },
    async (queries) => execBatch(sqlite, queries) as { rows: any[] }[],
  )
  return { db, sqlite }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** 本地时刻构造（月份从 1 起，便于对着 study.md 读）。 */
const at = (y: number, mo: number, d: number, h: number, mi = 0, s = 0, ms = 0): number =>
  new Date(y, mo - 1, d, h, mi, s, ms).getTime()

// 基准日：2026-01-15。今日窗口 = [01-15 04:00, 01-16 04:00)。
const TODAY_4AM = at(2026, 1, 15, 4)
const YESTERDAY_4AM = at(2026, 1, 14, 4)
const TOMORROW_4AM = at(2026, 1, 16, 4)
const TODAY_10AM = at(2026, 1, 15, 10)

// ────────────────── 种子（raw，非数据函数；同 scheduler.test.ts） ──────────────────

function seedDict(h: TestDb, dictId: number, term = `w${dictId}`): void {
  h.sqlite.prepare('INSERT INTO dict (dict_id, term, term_type) VALUES (?,?,?)').run(dictId, term, 1)
}

interface SeedWord {
  dictId: number
  state?: number
  due?: number | null
  stability?: number
  difficulty?: number
  scheduledDays?: number
  learningSteps?: number
  reps?: number
  lapses?: number
  lastReview?: number | null
  editTime?: number
  joinTime?: number
  isDeleted?: number
  withDict?: boolean
}

function seedWord(h: TestDb, o: SeedWord): void {
  h.sqlite
    .prepare(
      `INSERT INTO user_word
       (dict_id, due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review, join_time, edit_time, is_deleted, dirty)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
    )
    .run(
      o.dictId,
      o.due ?? null,
      o.stability ?? 0,
      o.difficulty ?? 0,
      o.scheduledDays ?? 0,
      o.learningSteps ?? 0,
      o.reps ?? 0,
      o.lapses ?? 0,
      o.state ?? 0,
      o.lastReview ?? null,
      o.joinTime ?? o.editTime ?? 0,
      o.editTime ?? 0,
      o.isDeleted ?? 0,
    )
  if (o.withDict !== false) seedDict(h, o.dictId)
}

const mkSettings = (o: Partial<Settings> = {}): Settings => ({
  newPerDay: 20,
  reviewsPerDay: 50,
  newReviewMix: 'mix',
  newCardOrder: 'joinTime', // pin 加入序：本文件断言的是边界归属，不测随机抽词
  meaningSource: 'concise',
  accent: 'us',
  autoPlayAudio: 1,
  readingFontSize: 16,
  readingFontFamily: 'serif',
  ...o,
})

/** 日志行（按时间序）。 */
const logsOf = (h: TestDb, dictId: number) =>
  h.sqlite
    .prepare(
      `SELECT review_time AS reviewTime, pre_state AS preState, rating
       FROM user_review_log WHERE dict_id=? ORDER BY review_time`,
    )
    .all(dictId) as { reviewTime: number; preState: number; rating: number }[]

/** 出卡序（不评分，只看队列归属）。 */
const drain = (s: StudySession, now: number): { dictId: number; kind: string }[] => {
  const out: { dictId: number; kind: string }[] = []
  for (let i = 0; i < 100; i++) {
    const c = s.nextCard(now)
    if (c.kind !== 'card') break
    out.push({ dictId: c.dictId, kind: c.cardKind })
  }
  return out
}

/** 一次「出卡 → 读当前 reps 做快照 → 评分」（模拟 UI 路径）。 */
async function rateOnce(
  h: TestDb,
  dictId: number,
  rating: 1 | 2 | 3,
  now: number,
  session: StudySession | null = null,
): Promise<void> {
  const row = (await words.getWord(h.db, dictId))!
  const res = await rate(h.db, session, { dictId, rating, durationMs: 3000, snapshotReps: row.reps }, now)
  if (res.kind !== 'rated') throw new Error(`dict=${dictId} 评分被丢弃(${res.reason})`)
}

// ══════════════════ 1. 拍板分歧②：3:5x 首评 + 4:0x 走步 → 两天各计一次 ══════════════════

describe('拍板分歧②（study.md §每日记账）：凌晨 3:5x 首评、4:0x 走步的词两天各计一次', () => {
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
  })

  it('首评日志落昨日窗口（记新学）、步内日志落今日窗口（记复习）——同机制、拍板接受', async () => {
    const firstAt = at(2026, 1, 15, 3, 55) // 属昨日窗口（凌晨 < 4:00）
    const stepAt = at(2026, 1, 15, 4, 5) // 属今日窗口（4:00 已翻转）
    seedWord(h, { dictId: 1, state: State.New })

    await rateOnce(h, 1, Rating.Again, firstAt) // 新卡首评 Again → 进 1m 步
    const afterFirst = (await words.getWord(h.db, 1))!
    expect(afterFirst.state, '新卡首评 Again → Learning').toBe(State.Learning)
    expect(afterFirst.due! - firstAt, '进 1 分钟步').toBe(MIN)

    await rateOnce(h, 1, Rating.Good, stepAt) // 4:05 走步评分

    // 两条日志分落两个窗口
    const logs = logsOf(h, 1)
    expect(logs.map((l) => l.reviewTime)).toEqual([firstAt, stepAt])
    expect(logs[0].preState, '首评快照 pre_state=0（新学判据）').toBe(0)
    expect(logs[1].preState, '步内评分快照 pre_state=1（已不是新词）').toBe(State.Learning)

    const yesterday = dayWindow(firstAt)
    const today = dayWindow(stepAt)
    expect(yesterday, '3:55 归昨日窗口').toEqual({ startMs: YESTERDAY_4AM, endMs: TODAY_4AM })
    expect(today, '4:05 归今日窗口').toEqual({ startMs: TODAY_4AM, endMs: TOMORROW_4AM })

    // 昨日窗口：该词算「新学」
    expect(await todayNewCount(h.db, yesterday.startMs, yesterday.endMs), '昨日窗口新学含该词').toBe(1)
    expect(await todayReviewCount(h.db, yesterday.startMs, yesterday.endMs), '昨日窗口不重复计复习').toBe(0)
    // 今日窗口：同一个词又算一次「复习」——两天各计一次，拍板接受的行为，测试把它钉死
    expect(await todayNewCount(h.db, today.startMs, today.endMs), '今日窗口无 pre_state=0 日志').toBe(0)
    expect(await todayReviewCount(h.db, today.startMs, today.endMs), '今日窗口复习含该词').toBe(1)
  })
})

// ══════════════════ 2. 拍板分歧①：昨日残留的分钟级步卡今天评分计入「今日复习数」 ══════════════════

describe('拍板分歧①（study.md §每日记账）：昨日残留分钟步卡不占额度，今天评它计入今日复习数', () => {
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
  })

  it('进 intraday 不占复习额度；今天评分后计入今日复习数', async () => {
    const lastNight = at(2026, 1, 14, 23) // 昨日窗口内的 23:00
    // 昨日 23:00 评分留下的分钟级步卡：state=1、scheduled_days=0、due 早于今日窗口右界（今天到期）
    seedWord(h, {
      dictId: 1,
      state: State.Learning,
      due: lastNight + 10 * MIN,
      scheduledDays: 0,
      learningSteps: 1,
      stability: 1.5,
      difficulty: 5,
      reps: 1,
      lastReview: lastNight,
    })
    // 一张天级到期复习卡，用来验证「分钟步卡没有吃掉复习额度」
    seedWord(h, {
      dictId: 2,
      state: State.Review,
      due: TODAY_10AM - 1000,
      scheduledDays: 5,
      stability: 8,
      difficulty: 5,
      reps: 3,
      lastReview: TODAY_10AM - 5 * DAY,
    })

    const s = await buildTodaySession(h.db, mkSettings({ newPerDay: 0, reviewsPerDay: 1 }), TODAY_10AM)
    // 复习额度只有 1：若分钟步卡占了额度，复习队列就会是 0
    expect(s.counts(), '分钟步卡进 intraday 计「学」、不占复习额度').toEqual({
      new: 0,
      learning: 1,
      review: 1,
    })
    expect(s.nextCard(TODAY_10AM), '到点分钟步卡最优先出').toEqual({
      kind: 'card',
      dictId: 1,
      cardKind: 'learning',
    })

    await rateOnce(h, 1, Rating.Good, TODAY_10AM)
    const today = dayWindow(TODAY_10AM)
    expect(logsOf(h, 1)[0].preState, '评分前状态是 Learning（不是新词）').toBe(State.Learning)
    expect(await todayNewCount(h.db, today.startMs, today.endMs), '不计新学').toBe(0)
    expect(
      await todayReviewCount(h.db, today.startMs, today.endMs),
      '计入今日复习数（分歧①：anki 对分钟步卡不扣额度，本产品扣——方向保守，拍板接受）',
    ).toBe(1)
  })
})

// ══════════════════ 3. 会话跨 4:00 全链：stale → 按新窗口重建 ══════════════════

describe('会话跨 4:00 全链（study.md「出卡顺序与重建」）', () => {
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
  })

  it('3:50 建会话学一半 → 推过 4:00 得 stale → 重建后额度按新窗口推导、分钟步卡回 intraday 最优先段、无重复计账', async () => {
    const beforeDawn = at(2026, 1, 15, 3, 50) // 昨日窗口末尾
    const afterDawn = at(2026, 1, 15, 4, 5) // 今日窗口开头
    const yesterday = dayWindow(beforeDawn)
    const today = dayWindow(afterDawn)
    for (let i = 1; i <= 5; i++) seedWord(h, { dictId: i, state: State.New, editTime: i })

    const settings = mkSettings({ newPerDay: 3, reviewsPerDay: 50, newReviewMix: 'newFirst' })
    const s1 = await buildTodaySession(h.db, settings, beforeDawn)
    expect(s1.windowEnd, '会话窗口右界 = 今日 4:00（凌晨归昨日窗口）').toBe(TODAY_4AM)
    expect(s1.counts(), '昨日窗口额度满 3').toEqual({ new: 3, learning: 0, review: 0 })

    // 学到一半：出 2 张新词并评 Good（进 10m 步，due 落在 4:00 之后）
    const learnedBeforeDawn: number[] = []
    for (let i = 0; i < 2; i++) {
      const c = s1.nextCard(beforeDawn + i * MIN)
      expect(c.kind).toBe('card')
      if (c.kind !== 'card') return
      learnedBeforeDawn.push(c.dictId)
      await rateOnce(h, c.dictId, Rating.Good, beforeDawn + i * MIN, s1)
    }
    expect(await todayNewCount(h.db, yesterday.startMs, yesterday.endMs), '昨日窗口新学 2').toBe(2)

    // 时钟推过 4:00 → 旧会话作废
    expect(s1.nextCard(afterDawn), '跨过窗口右界 → stale（须重建）').toEqual({ kind: 'stale' })

    // 按新窗口重建
    const s2 = await buildTodaySession(h.db, settings, afterDawn)
    expect(s2.windowEnd, '新会话窗口右界 = 次日 4:00').toBe(TOMORROW_4AM)
    expect(
      await todayNewCount(h.db, today.startMs, today.endMs),
      '新窗口内还没有 pre_state=0 日志 → 昨日的学习量不占今日额度',
    ).toBe(0)
    // 新额度 3 全额放开（池里还剩 3 个未学词），两张分钟步卡回到 intraday
    expect(s2.counts(), '额度按新窗口日志推导；分钟步卡回 intraday 计「学」不占额度').toEqual({
      new: 3,
      learning: 2,
      review: 0,
    })
    const order = drain(s2, afterDawn)
    expect(
      order.slice(0, 2).map((x) => x.kind),
      '仍在分钟步的卡回到当日队列最优先段',
    ).toEqual(['learning', 'learning'])
    expect(
      order.slice(0, 2).map((x) => x.dictId).sort((a, b) => a - b),
      '最优先段就是昨夜那两张卡',
    ).toEqual([...learnedBeforeDawn].sort((a, b) => a - b))

    // 无重复计账：昨日窗口计数不因今天的动作变化；今天评这两张卡按「复习」入账（分歧②同机制）
    for (const id of learnedBeforeDawn) await rateOnce(h, id, Rating.Good, afterDawn + MIN)
    expect(await todayNewCount(h.db, yesterday.startMs, yesterday.endMs), '昨日窗口新学仍是 2（按词去重、不回溯）').toBe(2)
    expect(await todayNewCount(h.db, today.startMs, today.endMs), '今日窗口不把昨夜的词算成新学').toBe(0)
    expect(await todayReviewCount(h.db, today.startMs, today.endMs), '今日窗口把它们算成复习，各 1 次').toBe(2)
  })
})

// ══════════════════ 4. learn-ahead 恰好 20:00 边界（queue.ts 的 <= 语义） ══════════════════

describe('learn-ahead 提前放行的 20 分钟整点边界', () => {
  const NOW = TODAY_10AM
  const W = TOMORROW_4AM

  it('sortDue = now + 20min 整 → 放行（<= 语义）；+1ms → 今日完成', () => {
    expect(LEARN_AHEAD_MS, 'learn-ahead 窗口固定 20 分钟').toBe(20 * MIN)

    const exact = NOW + LEARN_AHEAD_MS
    const onEdge = new StudySession([], [{ dictId: 10, due: exact, sortDue: exact }], W)
    expect(onEdge.nextCard(NOW), '恰好 20 分钟：<= 应放行').toEqual({
      kind: 'card',
      dictId: 10,
      cardKind: 'learning',
    })

    const past = NOW + LEARN_AHEAD_MS + 1
    const overEdge = new StudySession([], [{ dictId: 10, due: past, sortDue: past }], W)
    expect(overEdge.nextCard(NOW), '20 分钟 + 1ms：越窗，今日完成').toEqual({ kind: 'done' })
  })
})

// ══════════════════ 5. 今日窗口右开界：due < 次日 4:00 才算今日到期 ══════════════════

describe('今日窗口右开界（study.md「到期」= due < 次日 4:00，lt 严格小于）', () => {
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
  })

  it('due = 次日 4:00:00.000 不到期（不进复习队列）；due = 次日 4:00 − 1ms 到期（进队列）', async () => {
    expect(nextDayAt(TODAY_10AM), '今日窗口右开界 = 次日 4:00').toBe(TOMORROW_4AM)
    const common = { state: State.Review, scheduledDays: 5, stability: 8, difficulty: 5, reps: 3, lastReview: TODAY_10AM - 5 * DAY }
    seedWord(h, { dictId: 1, due: TOMORROW_4AM, ...common }) // 恰好边界：不属今日
    seedWord(h, { dictId: 2, due: TOMORROW_4AM - 1, ...common }) // 差 1ms：属今日

    const s = await buildTodaySession(h.db, mkSettings({ newPerDay: 0, reviewsPerDay: 50 }), TODAY_10AM)
    expect(s.counts(), '只有 1 张卡进复习队列').toEqual({ new: 0, learning: 0, review: 1 })
    expect(drain(s, TODAY_10AM).map((x) => x.dictId), '边界卡被右开界挡在门外').toEqual([2])

    // 词表四段同口径：边界卡归「记忆中」、差 1ms 的卡归「待复习」
    expect((await words.listSegment(h.db, 'due', TODAY_10AM)).map((w) => w.dictId)).toEqual([2])
    expect((await words.listSegment(h.db, 'memorizing', TODAY_10AM)).map((w) => w.dictId)).toEqual([1])
  })
})

// ══════════════════ 6. dayWindow 毫秒级归属：3:59:59.999 vs 4:00:00.000 ══════════════════

describe('dayWindow 毫秒级归属（4:00 整翻转）', () => {
  it('03:59:59.999 属昨日窗口；04:00:00.000 属今日窗口', () => {
    expect(dayWindow(at(2026, 1, 15, 3, 59, 59, 999)), '差 1ms 仍属昨日').toEqual({
      startMs: YESTERDAY_4AM,
      endMs: TODAY_4AM,
    })
    expect(dayWindow(at(2026, 1, 15, 4, 0, 0, 0)), '4:00 整即翻转进新的一天').toEqual({
      startMs: TODAY_4AM,
      endMs: TOMORROW_4AM,
    })
    // 窗口自身左闭右开、首尾相接：昨日 endMs === 今日 startMs
    expect(dayWindow(at(2026, 1, 15, 3, 59, 59, 999)).endMs).toBe(dayWindow(at(2026, 1, 15, 4)).startMs)
  })
})
