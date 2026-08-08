// 调度器正确性单测（编码「为什么这些行为重要」）：FSRS 配置钉死防漂移、三档评分实测口径回归、
// 评分落库九字段+pre_* 快照原子、标熟态断言拦截、今日队列额度/混排/缺行顺延、出卡三段序与队列内循环/防连出/
// 越 4:00 移出、再学一组不受额度、anki 式间隔格式化。业务语义变了这些测试就该失败。
//
// 生产与测试跑同一套数据函数，执行器不同：测试把 sqlite-proxy 回调指向进程内 better-sqlite3（复用 main/dbExecutor）。
import Database from 'better-sqlite3'
import { drizzle as betterDrizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as proxyDrizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { generatorParameters, Rating, State } from 'ts-fsrs'
import { runBatch as execBatch, runStmt as execStmt } from '../../../../main/dbExecutor'
import type { Db } from '@/db/client'
import * as words from '../words'
import { sessionCounts } from '@/wordbook'
import { dayWindow, nextDayAt } from '../time'
import { OUR_PARAMS, previewDueDates, schedule, type RateGrade } from './fsrs'
import { formatInterval, previewIntervals } from './preview'
import {
  buildTodaySession,
  extraCounts,
  extraGroup,
  intersperse,
  LEARN_AHEAD_MS,
  rate,
  StudySession,
  type QueueItem,
} from './queue'
import type { WordRecord } from '../types'
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

// 固定校准钟：2026-01-15 10:00 本地（落在今日窗口内）。
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime()
const ND = nextDayAt(NOW) // 次日 4:00（= 今日窗口右开界）

// ────────────────── 种子（raw，非数据函数） ──────────────────

function seedDict(h: TestDb, dictId: number, term = `w${dictId}`): void {
  h.sqlite
    .prepare('INSERT INTO dict (dict_id, term, term_type) VALUES (?,?,?)')
    .run(dictId, term, 1)
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

/** 种一条完整 user_word 行（默认带 dict 行，除非 withDict:false 用于缺行顺延测试）。joinTime 默认 = editTime（加入即同值）。 */
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

function seedLog(h: TestDb, dictId: number, reviewTime: number, preState: number): void {
  h.sqlite
    .prepare(
      'INSERT INTO user_review_log (dict_id, review_time, rating, duration_ms, pre_state, pre_stability, pre_difficulty, dirty) VALUES (?,?,3,0,?,0,0,0)',
    )
    .run(dictId, reviewTime, preState)
}

const readLog = (h: TestDb, dictId: number) =>
  h.sqlite
    .prepare(
      `SELECT review_time AS reviewTime, rating, duration_ms AS durationMs, pre_state AS preState,
              pre_stability AS preStability, pre_difficulty AS preDifficulty, dirty
       FROM user_review_log WHERE dict_id=?`,
    )
    .get(dictId) as
    | {
        reviewTime: number
        rating: number
        durationMs: number
        preState: number
        preStability: number
        preDifficulty: number
        dirty: number
      }
    | undefined

const logCount = (h: TestDb): number =>
  (h.sqlite.prepare('SELECT count(*) AS n FROM user_review_log').get() as { n: number }).n

const mkSettings = (o: Partial<Settings> = {}): Settings => ({
  newPerDay: 20,
  reviewsPerDay: 50,
  newReviewMix: 'mix',
  // 默认 pin joinTime（生产默认是 random）：保住本文件存量「加入序」断言的确定性；
  // random 抽词/复习同日随机由「抽词顺序」专用集合/分日用例覆盖（不测随机性本身）。
  newCardOrder: 'joinTime',
  meaningSource: 'concise',
  accent: 'us',
  autoPlayAudio: 1,
  // 阅读排版两项与调度无关，取生产默认占位即可（Settings 是整份视图，得给全）。
  readingFontSize: 16,
  readingFontFamily: 'serif',
  ...o,
})

/** 排空一个会话的主队列出卡序（新用例复用；同 buildTodaySession describe 内的 mainIds）。 */
const drainMain = (s: StudySession, now = NOW): number[] => {
  const out: number[] = []
  for (;;) {
    const c = s.nextCard(now)
    if (c.kind !== 'card') break
    out.push(c.dictId)
  }
  return out
}

/** 新词行（用于 schedule 直接测评分行为；state=0 走空卡）。 */
const newWord = (dictId = 1): WordRecord => ({
  dictId,
  due: null,
  stability: 0,
  difficulty: 0,
  scheduledDays: 0,
  learningSteps: 0,
  reps: 0,
  lapses: 0,
  state: 0,
  lastReview: null,
})

// ══════════════════ FSRS 配置与三档评分行为（实测口径回归） ══════════════════

describe('FSRS 配置钉死（防升包漂移，study.md「FSRS 参数」）', () => {
  it('OUR_PARAMS 与 generatorParameters({}) 全默认逐字段一致', () => {
    expect(OUR_PARAMS).toEqual(generatorParameters({}))
  })
})

describe('三档评分行为（study.md 评分映射）', () => {
  it('新卡首评 Good → Learning、step=1、due=now+10m', () => {
    const { next } = schedule(newWord(), NOW, Rating.Good)
    expect(next.state).toBe(State.Learning)
    expect(next.learningSteps).toBe(1)
    expect(next.due! - NOW).toBe(10 * MIN)
  })

  it('Learning 末步 Good → 毕业 Review 天级', () => {
    const step1 = schedule(newWord(), NOW, Rating.Good).next // Learning step=1
    const grad = schedule(step1, step1.due!, Rating.Good).next
    expect(grad.state).toBe(State.Review)
    expect(grad.scheduledDays).toBeGreaterThanOrEqual(1)
    expect(grad.due! - step1.due!).toBeGreaterThanOrEqual(DAY)
  })

  it('Review Again → Relearning、due=now+10m、lapses+1', () => {
    const review: WordRecord = {
      dictId: 1,
      due: NOW - 1000,
      stability: 20,
      difficulty: 5,
      scheduledDays: 20,
      learningSteps: 0,
      reps: 5,
      lapses: 1,
      state: State.Review,
      lastReview: NOW - 20 * DAY,
    }
    const { next } = schedule(review, NOW, Rating.Again)
    expect(next.state).toBe(State.Relearning)
    expect(next.due! - NOW).toBe(10 * MIN)
    expect(next.lapses).toBe(2)
  })

  it('提前复习间隔 < 按期复习间隔（ts-fsrs 原生按实际 elapsed）', () => {
    const base: WordRecord = {
      dictId: 1,
      due: NOW + 10 * DAY,
      stability: 10,
      difficulty: 5,
      scheduledDays: 10,
      learningSteps: 0,
      reps: 3,
      lapses: 0,
      state: State.Review,
      lastReview: NOW,
    }
    const onTime = schedule(base, base.due as number, Rating.Good).next
    const early = schedule(base, (base.due as number) - 5 * DAY, Rating.Good).next
    const onTimeInterval = onTime.due! - (base.due as number)
    const earlyInterval = early.due! - ((base.due as number) - 5 * DAY)
    expect(earlyInterval).toBeLessThan(onTimeInterval)
  })

  it('state=4（标熟态）喂 schedule 抛错（不可静默产 undefined）', () => {
    const mastered: WordRecord = { ...newWord(), state: 4, due: NOW, stability: 5, difficulty: 5 }
    expect(() => schedule(mastered, NOW, Rating.Good)).toThrow()
    expect(() => previewDueDates(mastered, NOW)).toThrow()
  })
})

// ══════════════════ 评分落库（rate：唯一评分路径） ══════════════════

describe('rate 落库：九字段整行 + 日志 pre_* 快照，同 batch 原子', () => {
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
  })

  const seedReview = (dictId = 1): void =>
    seedWord(h, {
      dictId,
      state: State.Review,
      due: NOW - 1000,
      stability: 8,
      difficulty: 6,
      scheduledDays: 8,
      reps: 3,
      lapses: 0,
      lastReview: NOW - 8 * DAY,
    })

  it('评分后 user_word 整行更新 + 日志一行，pre_* = 评分前快照', async () => {
    seedReview()
    const res = await rate(h.db, null, { dictId: 1, rating: Rating.Good, durationMs: 5000, snapshotReps: 3 }, NOW)
    expect(res.kind).toBe('rated')

    const row = await words.getWord(h.db, 1)
    expect(row?.reps).toBe(4)
    expect(row?.state).toBe(State.Review)
    expect(row?.due).toBeGreaterThan(ND) // 天级到期，越今日窗口

    const log = readLog(h, 1)!
    expect(log).toMatchObject({ rating: 3, preState: State.Review, durationMs: 5000, dirty: 1 })
    expect(log.reviewTime).toBe(NOW)
    expect(log.preStability).toBeCloseTo(8, 5) // 评分前 stability 快照
    expect(log.preDifficulty).toBeCloseTo(6, 5)
  })

  it('duration 上限 60s 截断', async () => {
    seedReview()
    await rate(h.db, null, { dictId: 1, rating: Rating.Good, durationMs: 999_999, snapshotReps: 3 }, NOW)
    expect(readLog(h, 1)!.durationMs).toBe(60_000)
  })

  it('重复评分（snapshotReps 不符）→ 幂等丢弃，不写日志、不改行', async () => {
    seedReview()
    const res = await rate(h.db, null, { dictId: 1, rating: Rating.Good, durationMs: 1000, snapshotReps: 99 }, NOW)
    expect(res).toEqual({ kind: 'discarded', reason: 'stale' })
    expect(logCount(h)).toBe(0)
    expect((await words.getWord(h.db, 1))?.reps).toBe(3)
  })

  it('标熟态（state=4）rate → 不可调度丢弃', async () => {
    seedWord(h, { dictId: 1, state: 4, due: NOW - 1000, stability: 5, difficulty: 5, reps: 2 })
    const res = await rate(h.db, null, { dictId: 1, rating: Rating.Good, durationMs: 1000, snapshotReps: 2 }, NOW)
    expect(res).toEqual({ kind: 'discarded', reason: 'unschedulable' })
    expect(logCount(h)).toBe(0)
  })

  it('新卡首评：pre_state=0（今日新学判据）、reps 0→1', async () => {
    seedWord(h, { dictId: 1, state: 0 })
    await rate(h.db, null, { dictId: 1, rating: Rating.Good, durationMs: 1000, snapshotReps: 0 }, NOW)
    expect(readLog(h, 1)!.preState).toBe(0)
    expect((await words.getWord(h.db, 1))?.reps).toBe(1)
  })
})

// ══════════════════ 标熟 / 取消标熟（words 原语 + schedule 衔接） ══════════════════

describe('取消标熟后可正常继续评分（防线 2：learning_steps=0）', () => {
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
  })

  it('已学过的标熟词 unmaster → state=2、due 不变、s/d 保留、learning_steps=0，再评分不抛', async () => {
    const due = NOW + 5 * DAY
    seedWord(h, {
      dictId: 1,
      state: 4,
      due,
      stability: 12,
      difficulty: 5,
      scheduledDays: 5,
      learningSteps: 3, // 残留步索引，unmaster 必须清零
      reps: 4,
      lastReview: NOW - 5 * DAY,
    })
    await words.unmaster(h.db, 1, NOW)
    const row = (await words.getWord(h.db, 1))!
    expect(row.state).toBe(State.Review)
    expect(row.due).toBe(due)
    expect(row.stability).toBeCloseTo(12, 5)
    expect(row.learningSteps).toBe(0)
    // Again 应进 Relearning（步索引已清零，不会跳过）
    const { next } = schedule(row, NOW + 6 * DAY, Rating.Again)
    expect(next.state).toBe(State.Relearning)
  })

  it('从未学过就被标熟的词 unmaster → 回 state=0', async () => {
    seedWord(h, { dictId: 1, state: 4, due: null, lastReview: null })
    await words.unmaster(h.db, 1, NOW)
    expect((await words.getWord(h.db, 1))?.state).toBe(State.New)
  })
})

// ══════════════════ 穿插 intersperse（逐行对齐 anki intersperser.rs） ══════════════════

describe('intersperse 与 anki 测例逐位一致', () => {
  it('anki intersperser.rs 原测例', () => {
    expect(intersperse([1, 2, 3], [11, 22, 33])).toEqual([1, 11, 2, 22, 3, 33])
    expect(intersperse([1, 2, 3], [11, 22])).toEqual([1, 11, 2, 22, 3])
    expect(intersperse([1, 2, 3], [11, 22, 33, 44, 55, 66])).toEqual([11, 1, 22, 33, 2, 44, 55, 3, 66])
    expect(intersperse([1, 2, 3], [11, 22, 33, 44, 55, 66, 77, 88])).toEqual([
      11, 22, 1, 33, 44, 2, 55, 66, 3, 77, 88,
    ])
    expect(intersperse([1, 2, 3], [])).toEqual([1, 2, 3])
  })

  it('3 新插 8 复习 → [1,2,X,3,4,X,5,6,X,7,8] 形态（one=复习基准）', () => {
    const r = [1, 2, 3, 4, 5, 6, 7, 8]
    const n = ['a', 'b', 'c']
    expect(intersperse<number | string>(r, n)).toEqual([1, 2, 'a', 3, 4, 'b', 5, 6, 'c', 7, 8])
  })
})

// ══════════════════ 今日队列构建（额度/混排/缺行/中途 intraday） ══════════════════

describe('buildTodaySession', () => {
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
  })

  const mainIds = async (s: StudySession): Promise<number[]> => {
    const out: number[] = []
    for (;;) {
      const c = s.nextCard(NOW)
      if (c.kind !== 'card') break
      out.push(c.dictId)
    }
    return out
  }

  it('额度 = 上限 − 日志推导已学数（按词去重）', async () => {
    // 今日新学 3（101/102/103，其中 101 两条日志验证去重）；今日复习 1（201）
    for (const id of [101, 102, 103]) {
      seedWord(h, { dictId: id, state: State.Review, due: ND + DAY }) // 未到期，不进任何队列
      seedLog(h, id, NOW, 0)
    }
    seedLog(h, 101, NOW + 1000, 0) // 同词第二条 pre_state=0，去重后仍算 1 词
    seedWord(h, { dictId: 201, state: State.Review, due: ND + DAY })
    seedLog(h, 201, NOW, 2) // 今日复习 1
    // 新词池 10 个（编号 1..10，joinTime 加入序升序）
    for (let i = 1; i <= 10; i++) seedWord(h, { dictId: i, state: 0, editTime: i })
    // 到期复习池 4 个（301..304）
    for (let i = 301; i <= 304; i++) seedWord(h, { dictId: i, state: State.Review, due: NOW - i })

    const s = await buildTodaySession(h.db, mkSettings({ newPerDay: 5, reviewsPerDay: 3, newReviewMix: 'mix' }), NOW)
    const ids = await mainIds(s)
    const news = ids.filter((x) => x <= 10)
    const reviews = ids.filter((x) => x >= 301)
    expect(news).toEqual([1, 2]) // 5 − 3 = 2，最早两词
    expect(reviews).toHaveLength(2) // 3 − 1 = 2
  })

  it('newFirst / reviewFirst 纯拼接（复习按逾期日桶降序，桶间确定）', async () => {
    for (let i = 1; i <= 3; i++) seedWord(h, { dictId: i, state: 0, editTime: i })
    // 分日种卡规避同日随机：303 逾期 2 天 / 302 逾期 1 天 / 301 今日到期 → 桶降序确定 [303,302,301]。
    seedWord(h, { dictId: 301, state: State.Review, due: NOW, scheduledDays: 5 })
    seedWord(h, { dictId: 302, state: State.Review, due: NOW - DAY, scheduledDays: 5 })
    seedWord(h, { dictId: 303, state: State.Review, due: NOW - 2 * DAY, scheduledDays: 5 })

    const nf = await mainIds(await buildTodaySession(h.db, mkSettings({ newReviewMix: 'newFirst' }), NOW))
    expect(nf).toEqual([1, 2, 3, 303, 302, 301]) // 新词按 joinTime(加入序)，复习按逾期天数降序（逾期深者先）
    const rf = await mainIds(await buildTodaySession(h.db, mkSettings({ newReviewMix: 'reviewFirst' }), NOW))
    expect(rf).toEqual([303, 302, 301, 1, 2, 3])
  })

  it('缺行词（dict 未缓存）顺延不出（INNER JOIN dict）', async () => {
    seedWord(h, { dictId: 1, state: 0, editTime: 1 })
    seedWord(h, { dictId: 500, state: 0, editTime: 2, withDict: false }) // 无 dict 行
    const ids = await mainIds(await buildTodaySession(h.db, mkSettings(), NOW))
    expect(ids).toEqual([1])
  })

  it('中途重建：分钟级步骤卡进 intraday、不占复习额度、三段序最优先', async () => {
    // 分钟级学习卡（state=1、scheduled_days=0、到点）
    seedWord(h, { dictId: 9, state: State.Learning, scheduledDays: 0, due: NOW - MIN, stability: 1, difficulty: 5, reps: 1, lastReview: NOW - MIN })
    // 3 张天级到期复习卡，reviewsPerDay=2
    for (let i = 301; i <= 303; i++) seedWord(h, { dictId: i, state: State.Review, due: NOW - i, scheduledDays: 5 })
    const s = await buildTodaySession(h.db, mkSettings({ reviewsPerDay: 2, newPerDay: 0 }), NOW)
    expect(s.counts()).toEqual({ new: 0, learning: 1, review: 2 }) // intraday(9) 计学不占额度，复习仍取满 2
    const first = s.nextCard(NOW)
    expect(first).toEqual({ kind: 'card', dictId: 9, cardKind: 'learning' }) // 到点分钟卡最优先
  })
})

// ══════════════════ 出卡三段序 / 队列内循环 / 防连出 / 越 4:00 / stale ══════════════════

describe('StudySession 出卡序与队列内循环', () => {
  const W = NOW + HOUR // 今日窗口右界（测试用，足够容纳分钟级卡）

  it('段1 到点 intraday 最优先 → 段2 main → done（cardKind 随段/条目）', () => {
    const s = new StudySession(
      [{ dictId: 20, due: null, kind: 'new' }],
      [{ dictId: 10, due: NOW - 1000, sortDue: NOW - 1000 }],
      W,
    )
    expect(s.nextCard(NOW)).toEqual({ kind: 'card', dictId: 10, cardKind: 'learning' }) // intraday 恒属学
    expect(s.nextCard(NOW)).toEqual({ kind: 'card', dictId: 20, cardKind: 'new' }) // main 按条目 kind
    expect(s.nextCard(NOW)).toEqual({ kind: 'done' })
  })

  it('main 空后 learn-ahead ≤20min 放行；>20min 判今日完成', () => {
    const within = new StudySession([], [{ dictId: 10, due: NOW + 15 * MIN, sortDue: NOW + 15 * MIN }], W)
    expect(within.nextCard(NOW)).toEqual({ kind: 'card', dictId: 10, cardKind: 'learning' })

    const beyond = new StudySession([], [{ dictId: 10, due: NOW + 25 * MIN, sortDue: NOW + 25 * MIN }], W)
    expect(beyond.nextCard(NOW)).toEqual({ kind: 'done' })
    expect(LEARN_AHEAD_MS).toBe(20 * MIN)
  })

  it('评分后 due 在窗口内 → 按 due 回插 intraday，到点再出', () => {
    const s = new StudySession([{ dictId: 1, due: null, kind: 'new' }], [], W)
    expect(s.nextCard(NOW)).toEqual({ kind: 'card', dictId: 1, cardKind: 'new' }) // 段2 出 1
    s.requeue({ ...newWord(1), state: State.Learning, due: NOW + MIN }, NOW) // 1 分钟步回插
    expect(s.nextCard(NOW + MIN + 1)).toEqual({ kind: 'card', dictId: 1, cardKind: 'learning' }) // 到点再出，属学
  })

  it('评分后 due 越次日 4:00 → 移出本次队列', () => {
    const s = new StudySession([{ dictId: 1, due: null, kind: 'new' }], [], W)
    s.nextCard(NOW)
    s.requeue({ ...newWord(1), state: State.Review, due: W + DAY }, NOW) // 天级毕业，越窗口
    expect(s.nextCard(NOW)).toEqual({ kind: 'done' })
  })

  it('防连出：main 空 + 落 learn-ahead 窗口 + 会排队首 → 排第二，另一张先出', () => {
    // intraday 已有 cardB（due=NOW+5min）；main 已空。刚评的 cardA 新 due=NOW+1min（会排队首）。
    const s = new StudySession([], [{ dictId: 2, due: NOW + 5 * MIN, sortDue: NOW + 5 * MIN }], W)
    s.requeue({ ...newWord(1), state: State.Learning, due: NOW + MIN }, NOW)
    // 若无防连出，cardA(1) due 更小会先出；防连出后 cardB(2) 先出。
    expect(s.nextCard(NOW + 6 * MIN)).toEqual({ kind: 'card', dictId: 2, cardKind: 'learning' })
    expect(s.nextCard(NOW + 6 * MIN)).toEqual({ kind: 'card', dictId: 1, cardKind: 'learning' })
  })

  it('跨过窗口右界 → stale（须重建）', () => {
    const s = new StudySession([{ dictId: 1, due: null, kind: 'new' }], [], W)
    expect(s.nextCard(W)).toEqual({ kind: 'stale' })
    expect(s.nextCard(W + 1000)).toEqual({ kind: 'stale' })
  })

  it('标熟 drop：移出未出主队列与 intraday，不再出卡', () => {
    const s = new StudySession(
      [
        { dictId: 1, due: null, kind: 'new' },
        { dictId: 2, due: null, kind: 'new' },
      ],
      [{ dictId: 3, due: NOW - 1000, sortDue: NOW - 1000 }],
      W,
    )
    s.drop(2) // 标熟队列中的 2
    s.drop(3) // 标熟 intraday 中的 3
    expect(s.nextCard(NOW)).toEqual({ kind: 'card', dictId: 1, cardKind: 'new' })
    expect(s.nextCard(NOW)).toEqual({ kind: 'done' })
  })
})

// ══════════════════ 再学一组（不受额度、评分计入今日） ══════════════════

describe('再学一组取卡', () => {
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
  })

  it('继续学习：state=0 按 joinTime(加入序) 升序、排除本会话已出词', async () => {
    for (let i = 1; i <= 4; i++) seedWord(h, { dictId: i, state: 0, editTime: i })
    const items = await extraGroup(h.db, 'learn', 2, NOW, new Set([1]), 'joinTime')
    expect(items.map((x) => x.dictId)).toEqual([2, 3]) // 排除 1，取最早两词
  })

  it('继续复习：已到期且今日窗口内无日志，排除标熟态', async () => {
    seedWord(h, { dictId: 1, state: State.Review, due: NOW - 1000, scheduledDays: 5 }) // 到期，无日志 → 命中
    seedWord(h, { dictId: 2, state: State.Review, due: NOW - 1000, scheduledDays: 5 })
    seedLog(h, 2, NOW, 2) // 今日已复习 → 排除
    seedWord(h, { dictId: 3, state: 4, due: NOW - 1000 }) // 标熟态 due 未清 → 必须排除
    const items = await extraGroup(h.db, 'review', 10, NOW, new Set(), 'joinTime')
    expect(items.map((x) => x.dictId)).toEqual([1])
  })

  it('提前复习：未到期（due>=nd）按未来日桶升序（最近天优先）', async () => {
    seedWord(h, { dictId: 1, state: State.Review, due: ND + 3 * DAY, scheduledDays: 10 }) // 桶 3
    seedWord(h, { dictId: 2, state: State.Review, due: ND + 1 * DAY, scheduledDays: 10 }) // 桶 1
    seedWord(h, { dictId: 3, state: State.Review, due: NOW - 1000, scheduledDays: 10 }) // 已到期 → 不属提前
    const items = await extraGroup(h.db, 'ahead', 10, NOW, new Set(), 'joinTime')
    expect(items.map((x) => x.dictId)).toEqual([2, 1]) // 分日桶不同：最近天（桶小）优先
  })

  it('extraCounts 三选项可用数量', async () => {
    for (let i = 1; i <= 3; i++) seedWord(h, { dictId: i, state: 0, editTime: i }) // learn 3
    seedWord(h, { dictId: 10, state: State.Review, due: NOW - 1, scheduledDays: 5 }) // review 1
    seedWord(h, { dictId: 11, state: State.Review, due: ND + DAY, scheduledDays: 5 }) // ahead 1
    const c = await extraCounts(h.db, NOW, new Set([1]))
    expect(c).toEqual({ learn: 2, review: 1, ahead: 1 }) // learn 排除已出词 1
  })

  it('再学一组的卡评分照常记日志（计入今日数字）', async () => {
    seedWord(h, { dictId: 5, state: State.Review, due: ND + DAY, scheduledDays: 5, stability: 8, difficulty: 5, reps: 2, lastReview: NOW - DAY })
    const session = new StudySession([], [], NOW + HOUR)
    session.appendGroup(await extraGroup(h.db, 'ahead', 1, NOW, new Set(), 'joinTime'))
    const card = session.nextCard(NOW)
    expect(card).toEqual({ kind: 'card', dictId: 5, cardKind: 'review' }) // ahead 打标 review
    await rate(h.db, session, { dictId: 5, rating: Rating.Good, durationMs: 1000, snapshotReps: 2 }, NOW)
    expect(logCount(h)).toBe(1) // 提前复习也产生真实记忆事件日志
  })
})

// ══════════════════ 抽词顺序（study.md「今日队列」：新词 random / 复习分桶随机） ══════════════════
// 不测「随机性本身」（SQLite random() 不可播种，统计断言必然 flaky）——只测排序键与集合性质。
describe('抽词顺序：新词 random / 复习分桶', () => {
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
  })

  it('新词 random：limit ≥ 候选池 → 集合与 joinTime 模式相等（抽全池，不断言顺序）', async () => {
    for (let i = 1; i <= 5; i++) seedWord(h, { dictId: i, state: 0, editTime: i })
    const s = await buildTodaySession(
      h.db,
      mkSettings({ newPerDay: 10, reviewsPerDay: 0, newCardOrder: 'random' }),
      NOW,
    )
    expect(new Set(drainMain(s))).toEqual(new Set([1, 2, 3, 4, 5]))
  })

  it('新词 random：limit < 候选池 → 恰 limit 个、无重复、均属候选池', async () => {
    for (let i = 1; i <= 8; i++) seedWord(h, { dictId: i, state: 0, editTime: i })
    const s = await buildTodaySession(
      h.db,
      mkSettings({ newPerDay: 3, reviewsPerDay: 0, newCardOrder: 'random' }),
      NOW,
    )
    const ids = drainMain(s)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3) // 无重复
    ids.forEach((id) => expect(id >= 1 && id <= 8).toBe(true)) // 均属候选池
  })

  it("extraGroup('learn') random：排除已出词、limit<剩余池 → 恰 limit 个无重复且均属剩余池", async () => {
    for (let i = 1; i <= 6; i++) seedWord(h, { dictId: i, state: 0, editTime: i })
    const items = await extraGroup(h.db, 'learn', 2, NOW, new Set([1, 2]), 'random')
    const ids = items.map((x) => x.dictId)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    ids.forEach((id) => expect([3, 4, 5, 6]).toContain(id)) // 排除 1、2 后只可能落在剩余池
  })

  it('复习跨日优先：limit=2 → 必为逾期最深的两卡且逾期深者在前（桶降序 + 截断优先级）', async () => {
    seedWord(h, { dictId: 1, state: State.Review, due: NOW, scheduledDays: 5 }) // 今日窗口 桶 0
    seedWord(h, { dictId: 2, state: State.Review, due: NOW - DAY, scheduledDays: 5 }) // 逾期 1 天 桶 1
    seedWord(h, { dictId: 3, state: State.Review, due: NOW - 2 * DAY, scheduledDays: 5 }) // 逾期 2 天 桶 2
    const s = await buildTodaySession(
      h.db,
      mkSettings({ newPerDay: 0, reviewsPerDay: 2, newReviewMix: 'reviewFirst' }),
      NOW,
    )
    expect(drainMain(s)).toEqual([3, 2]) // 今日到期的 1 被 limit 挡在门外
  })

  it('复习同日集合：同桶多卡、limit 充足 → 返回集合相等，不断言顺序', async () => {
    for (const id of [1, 2, 3, 4]) {
      seedWord(h, { dictId: id, state: State.Review, due: NOW - id * 1000, scheduledDays: 5 })
    }
    const s = await buildTodaySession(h.db, mkSettings({ newPerDay: 0, reviewsPerDay: 10 }), NOW)
    expect(new Set(drainMain(s))).toEqual(new Set([1, 2, 3, 4])) // 全今日桶、limit 充足
  })

  it("extraGroup('review') 分桶：limit=1 → 取逾期最深（桶降序）", async () => {
    seedWord(h, { dictId: 1, state: State.Review, due: NOW, scheduledDays: 5 }) // 桶 0
    seedWord(h, { dictId: 2, state: State.Review, due: NOW - 2 * DAY, scheduledDays: 5 }) // 桶 2
    const items = await extraGroup(h.db, 'review', 1, NOW, new Set(), 'joinTime')
    expect(items.map((x) => x.dictId)).toEqual([2])
  })

  it("extraGroup('ahead') 分桶：明日/后日各一卡、limit=1 → 必为明日卡（最近天优先）", async () => {
    seedWord(h, { dictId: 1, state: State.Review, due: ND + 12 * HOUR, scheduledDays: 10 }) // 明日窗口 桶 0
    seedWord(h, { dictId: 2, state: State.Review, due: ND + DAY + 12 * HOUR, scheduledDays: 10 }) // 后日窗口 桶 1
    const items = await extraGroup(h.db, 'ahead', 1, NOW, new Set(), 'joinTime')
    expect(items.map((x) => x.dictId)).toEqual([1])
  })

  it("extraGroup('ahead') 同日多卡：集合相等（同日随机）", async () => {
    for (const id of [1, 2, 3]) {
      seedWord(h, { dictId: id, state: State.Review, due: ND + id * HOUR, scheduledDays: 10 })
    }
    const items = await extraGroup(h.db, 'ahead', 10, NOW, new Set(), 'joinTime')
    expect(new Set(items.map((x) => x.dictId))).toEqual(new Set([1, 2, 3])) // 全明日桶
  })
})

// ══════════════════ 间隔预览格式化（anki 答题按钮规则） ══════════════════

describe('formatInterval 时长文案', () => {
  it('各档边界', () => {
    expect(formatInterval(30_000)).toBe('<1分钟')
    expect(formatInterval(60_000)).toBe('1分钟')
    expect(formatInterval(90_000)).toBe('2分钟') // round(1.5)
    expect(formatInterval(2 * HOUR)).toBe('2.0小时')
    expect(formatInterval(5 * DAY)).toBe('5天')
    expect(formatInterval(30 * DAY)).toBe('1.0个月') // 30 天进月档（表边界）
    expect(formatInterval(45 * DAY)).toBe('1.5个月')
    expect(formatInterval(400 * DAY)).toBe('1.1年')
  })
})

describe('previewIntervals 三档预览', () => {
  it('新卡三档：不认识<好过<认识，good=10分钟', () => {
    const p = previewIntervals(newWord(), NOW)
    expect(p.again).toBe('1分钟')
    expect(p.good).toBe('10分钟')
    const due = previewDueDates(newWord(), NOW)
    expect(due[Rating.Again]).toBeLessThan(due[Rating.Hard])
    expect(due[Rating.Hard]).toBeLessThan(due[Rating.Good])
  })
})

// ══════════════════ 日边界 4:00（study.md） ══════════════════

describe('dayWindow 4:00 翻转', () => {
  it('凌晨 2 点属昨日窗口', () => {
    const dawn = new Date(2026, 0, 15, 2, 0, 0, 0).getTime()
    const w = dayWindow(dawn)
    expect(new Date(w.startMs).getDate()).toBe(14) // 昨日 4:00
    expect(new Date(w.startMs).getHours()).toBe(4)
    expect(new Date(w.endMs).getDate()).toBe(15) // 今日 4:00
  })
})

// ══════════════════ 顶栏三计数（study.md「学习页顶栏」：counts 从会话队列即时派生） ══════════════════

describe('StudySession.counts 三计数派生', () => {
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
  })

  it('初始计数 = 队列长度：额度裁剪后新=新队列长、学=intraday+跨日步、复=state2 数', async () => {
    // 新词 4 个，newPerDay=2 → 新队列裁到 2（新=2）
    for (let i = 1; i <= 4; i++) seedWord(h, { dictId: i, state: 0, editTime: i })
    // 两张天级到期复习（state=2）→ 复
    seedWord(h, { dictId: 20, state: State.Review, due: NOW - 100, scheduledDays: 5 })
    seedWord(h, { dictId: 21, state: State.Review, due: NOW - 200, scheduledDays: 5 })
    // 跨日学习步（state=3、scheduled_days>0、到期）→ 归复习队列但打标 learning（计学不计复）
    seedWord(h, { dictId: 30, state: State.Relearning, due: NOW - 300, scheduledDays: 2 })
    // 分钟级步卡（state=1、scheduled_days=0、到期）→ intraday（计学）
    seedWord(h, { dictId: 40, state: State.Learning, due: NOW - MIN, scheduledDays: 0 })
    const s = await buildTodaySession(h.db, mkSettings({ newPerDay: 2, reviewsPerDay: 10 }), NOW)
    // 新=队列 2；学=intraday(40) 1 + 跨日步(30) 1 = 2；复=state2(20,21) 2
    expect(s.counts()).toEqual({ new: 2, learning: 2, review: 2 })
  })

  it('anki undo_counts 场景按本产品步长复刻（两张新词，steps 1m/10m）', async () => {
    for (let i = 1; i <= 2; i++) seedWord(h, { dictId: i, state: 0, editTime: i })
    const s = await buildTodaySession(h.db, mkSettings({ newPerDay: 10, reviewsPerDay: 0 }), NOW)
    // 出卡 + 评分：读当前 reps 做 snapshot（模拟 UI 出卡后评分），评的是刚服务的那张
    const step = async (now: number, grade: RateGrade): Promise<void> => {
      const c = s.nextCard(now)
      expect(c.kind).toBe('card')
      if (c.kind !== 'card') return
      const row = (await words.getWord(h.db, c.dictId))!
      await rate(h.db, s, { dictId: c.dictId, rating: grade, durationMs: 0, snapshotReps: row.reps }, now)
    }
    expect(s.counts()).toEqual({ new: 2, learning: 0, review: 0 }) // {2,0,0}
    await step(NOW, Rating.Again) // A 评 Again：新→分钟步（新−1、学+1）
    expect(s.counts()).toEqual({ new: 1, learning: 1, review: 0 }) // {1,1,0}
    await step(NOW, Rating.Good) // B 评 Good：新→分钟步（新−1、学+1）
    expect(s.counts()).toEqual({ new: 0, learning: 2, review: 0 }) // {0,2,0}
    await step(NOW + MIN + 1, Rating.Good) // A 步内 Good（1m→10m）：出队−1 回插+1，学净不变
    expect(s.counts()).toEqual({ new: 0, learning: 2, review: 0 }) // {0,2,0}
    await step(NOW + 12 * MIN, Rating.Good) // 一张走完学习步毕业（天级越窗移出）→ 学−1
    expect(s.counts()).toEqual({ new: 0, learning: 1, review: 0 }) // {0,1,0}
    await step(NOW + 12 * MIN, Rating.Good) // 另一张毕业 → 学−1
    expect(s.counts()).toEqual({ new: 0, learning: 0, review: 0 }) // {0,0,0}
    expect(s.nextCard(NOW + 12 * MIN)).toEqual({ kind: 'done' }) // done ⟺ 全零
  })

  it('步内卡评 Again → 学净不变（出队−1 回插+1）', async () => {
    seedWord(h, {
      dictId: 1,
      state: State.Learning,
      due: NOW - MIN,
      scheduledDays: 0,
      stability: 1,
      difficulty: 5,
      learningSteps: 1,
      reps: 1,
      lastReview: NOW - MIN,
    })
    const s = await buildTodaySession(h.db, mkSettings({ newPerDay: 0, reviewsPerDay: 0 }), NOW)
    expect(s.counts()).toEqual({ new: 0, learning: 1, review: 0 })
    const c = s.nextCard(NOW) // 服务后暂时出队
    expect(c).toMatchObject({ kind: 'card', dictId: 1, cardKind: 'learning' })
    const row = (await words.getWord(h.db, 1))!
    await rate(h.db, s, { dictId: 1, rating: Rating.Again, durationMs: 0, snapshotReps: row.reps }, NOW)
    expect(s.counts()).toEqual({ new: 0, learning: 1, review: 0 }) // 仍在分钟步 → 回插，净不变
  })

  it('复习卡评 Again → 复−1、学+1（转重学分钟步）', async () => {
    seedWord(h, {
      dictId: 1,
      state: State.Review,
      due: NOW - 1000,
      stability: 8,
      difficulty: 6,
      scheduledDays: 8,
      reps: 3,
      lastReview: NOW - 8 * DAY,
    })
    const s = await buildTodaySession(h.db, mkSettings({ newPerDay: 0, reviewsPerDay: 10 }), NOW)
    expect(s.counts()).toEqual({ new: 0, learning: 0, review: 1 })
    s.nextCard(NOW) // 服务复习卡（复队 −1）
    await rate(h.db, s, { dictId: 1, rating: Rating.Again, durationMs: 0, snapshotReps: 3 }, NOW)
    expect(s.counts()).toEqual({ new: 0, learning: 1, review: 0 }) // Again → 10 分钟重学步回插 intraday
  })

  it('复习卡评 Good 还清 → 复−1（天级越窗移出）', async () => {
    seedWord(h, {
      dictId: 1,
      state: State.Review,
      due: NOW - 1000,
      stability: 8,
      difficulty: 6,
      scheduledDays: 8,
      reps: 3,
      lastReview: NOW - 8 * DAY,
    })
    const s = await buildTodaySession(h.db, mkSettings({ newPerDay: 0, reviewsPerDay: 10 }), NOW)
    expect(s.counts()).toEqual({ new: 0, learning: 0, review: 1 })
    s.nextCard(NOW)
    await rate(h.db, s, { dictId: 1, rating: Rating.Good, durationMs: 0, snapshotReps: 3 }, NOW)
    expect(s.counts()).toEqual({ new: 0, learning: 0, review: 0 }) // 天级越窗移出，复−1
  })

  it('drop：标熟 intraday 卡学−1、标熟未出新词新−1、已出示卡标熟计数不变', () => {
    const s = new StudySession(
      [
        { dictId: 1, due: null, kind: 'new' },
        { dictId: 2, due: null, kind: 'new' },
        { dictId: 3, due: null, kind: 'new' },
      ],
      [{ dictId: 9, due: NOW - 1000, sortDue: NOW - 1000 }],
      NOW + HOUR,
    )
    expect(s.counts()).toEqual({ new: 3, learning: 1, review: 0 })
    s.drop(9) // 标熟 intraday 卡 → 学−1
    expect(s.counts()).toEqual({ new: 3, learning: 0, review: 0 })
    s.drop(3) // 标熟 main 未出段新词 → 新−1
    expect(s.counts()).toEqual({ new: 2, learning: 0, review: 0 })
    s.nextCard(NOW) // 出示 1（进已出段）
    expect(s.counts()).toEqual({ new: 1, learning: 0, review: 0 })
    s.drop(1) // 当前已出示卡标熟 → drop 对已出段 no-op
    expect(s.counts()).toEqual({ new: 1, learning: 0, review: 0 }) // 计数不变
  })

  it('done ⟺ 三计数全零：走完全队 nextCard=done 且 counts 全零，两者同真', () => {
    const s = new StudySession(
      [
        { dictId: 1, due: null, kind: 'new' },
        { dictId: 2, due: null, kind: 'review' },
      ],
      [{ dictId: 3, due: NOW - 1000, sortDue: NOW - 1000 }],
      NOW + HOUR,
    )
    expect(s.counts()).toEqual({ new: 1, learning: 1, review: 1 })
    expect(s.nextCard(NOW)).toEqual({ kind: 'card', dictId: 3, cardKind: 'learning' }) // 段1 intraday 先（学）
    expect(s.nextCard(NOW)).toEqual({ kind: 'card', dictId: 1, cardKind: 'new' }) // 段2 main 新
    expect(s.nextCard(NOW)).toEqual({ kind: 'card', dictId: 2, cardKind: 'review' }) // 段2 main 复
    expect(s.nextCard(NOW)).toEqual({ kind: 'done' })
    expect(s.counts()).toEqual({ new: 0, learning: 0, review: 0 })
  })

  it('appendGroup（learn / review）后对应计数上浮，nextCard 恢复出卡', async () => {
    for (let i = 1; i <= 2; i++) seedWord(h, { dictId: i, state: 0, editTime: i }) // learn 源
    seedWord(h, { dictId: 10, state: State.Review, due: ND + DAY, scheduledDays: 5 }) // ahead 源（未到期）
    const s = new StudySession([], [], NOW + HOUR)
    expect(s.counts()).toEqual({ new: 0, learning: 0, review: 0 })
    expect(s.nextCard(NOW)).toEqual({ kind: 'done' })
    s.appendGroup(await extraGroup(h.db, 'learn', 2, NOW, new Set(), 'joinTime')) // 继续学习 → 新上浮
    expect(s.counts()).toEqual({ new: 2, learning: 0, review: 0 })
    s.appendGroup(await extraGroup(h.db, 'ahead', 1, NOW, new Set(), 'joinTime')) // 提前复习 → 复上浮
    expect(s.counts()).toEqual({ new: 2, learning: 0, review: 1 })
    expect(s.nextCard(NOW).kind).toBe('card') // 从完成态恢复出卡
  })

  it('stale（跨 4:00）：旧会话 nextCard=stale，重建后计数按新队列重算', async () => {
    for (let i = 1; i <= 3; i++) seedWord(h, { dictId: i, state: 0, editTime: i })
    const s1 = await buildTodaySession(h.db, mkSettings({ newPerDay: 3 }), NOW)
    expect(s1.counts()).toEqual({ new: 3, learning: 0, review: 0 })
    expect(s1.nextCard(s1.windowEnd)).toEqual({ kind: 'stale' }) // 跨窗口右界 → UI 据此重建
    // 重建（新窗口、newPerDay=2 裁剪）→ 计数从新队列重算
    const s2 = await buildTodaySession(h.db, mkSettings({ newPerDay: 2 }), s1.windowEnd + HOUR)
    expect(s2.counts()).toEqual({ new: 2, learning: 0, review: 0 })
  })
})

describe('门面 sessionCounts', () => {
  it('无会话（未 startTodaySession）返回全零', () => {
    // 顶栏进页首帧、或会话未建时不崩、显示「新 0 · 学 0 · 复 0」。
    expect(sessionCounts()).toEqual({ new: 0, learning: 0, review: 0 })
  })
})
