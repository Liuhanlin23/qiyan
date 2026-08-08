// 多日仿真测试（累积性正确性）：虚拟时钟跑数十个虚拟天的完整学习流，每天收工后对**全库**断言不变量。
// 存在意义与 scheduler.test.ts / golden.test.ts 都不同：那两者验「单步对不对」「数值变没变」，
// 这里抓「单步全对但连起来错」——卡丢失 / 饿死、记账漂移（日志与 reps 对不上）、状态非法组合、额度被击穿。
//
// 确定性纪律：全程不用 Date.now() / Math.random()。评分策略是 hash(seed, dictId, 该词当前 reps) → [0,1) 落档，
// 因此**与出卡顺序无关**——建队用了不可播种的 SQLite random()（同日出卡顺序每次运行都不同），
// 只有「某词第 N 次评分评什么」恒定，轨迹才稳定。相应地本文件只做不变量/集合级断言，绝不断言顺序或具体数值。
//
// 虚拟时钟：每天从当日 10:00 开始，**每评一张卡前进 30 秒**。必须前进：日志唯一键 (dict_id, review_time)
// 幂等去重，同词两次评分落在同一毫秒会被静默吞掉，账目必错（I3 的 reps ↔ 日志行数正是这道防线）。
// 分钟级步卡（1m/10m）靠三段序的 learn-ahead（20 分钟窗）自然放行，无需把时钟拨到 due。
//
// 生产与测试跑同一套数据函数（同 scheduler.test.ts）：sqlite-proxy 回调指向进程内 better-sqlite3。
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
import { dayWindow } from '../time'
import type { RateGrade } from './fsrs'
import { buildTodaySession, rate } from './queue'
import type { StudySession } from './queue'
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

/** 每评一张卡时钟前进量（见文件头「虚拟时钟」）。 */
const STEP_MS = 30_000
/** 单日出卡安全上限：超限即疑似死循环，直接失败。 */
const MAX_CARDS_PER_DAY = 10_000

/** 第 k 个虚拟天的 10:00（用 Date 组件构造：DST 地区也稳落在当日 [4:00, 次日4:00) 窗口内）。 */
const dayStartAt = (k: number): number => new Date(2026, 0, 15 + k, 10, 0, 0, 0).getTime()

// ────────────────── 种子（raw，非数据函数；同 scheduler.test.ts） ──────────────────

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

/** 种一个 size 大的未学词池（dictId 1..size，joinTime 升序 = 加入序）。 */
function seedPool(h: TestDb, size: number): void {
  for (let i = 1; i <= size; i++) seedWord(h, { dictId: i, state: State.New, editTime: i })
}

const mkSettings = (o: Partial<Settings> = {}): Settings => ({
  newPerDay: 20,
  reviewsPerDay: 200,
  newReviewMix: 'mix',
  // 仿真固定 joinTime：新词「抽哪些」确定，剩下的随机只在同日复习桶内（策略对顺序不敏感，见文件头）。
  newCardOrder: 'joinTime',
  meaningSource: 'concise',
  accent: 'us',
  autoPlayAudio: 1,
  readingFontSize: 16,
  readingFontFamily: 'serif',
  ...o,
})

// ────────────────── 确定性评分策略 ──────────────────

/** 确定性整数 hash → [0,1)：键入 (seed, dictId, reps)，与出卡顺序无关。 */
function hash01(seed: number, dictId: number, reps: number): number {
  let x =
    (Math.imul(seed + 1, 0x9e3779b1) ^
      Math.imul(dictId + 1, 0x85ebca6b) ^
      Math.imul(reps + 1, 0xc2b2ae35)) >>>
    0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000
}

type Policy = (dictId: number, reps: number) => RateGrade

/** 按给定概率落三档；「某词第 N 次评分评什么」恒定（reps 即第 N 次的序号）。 */
const mkPolicy =
  (seed: number, pAgain: number, pHard: number): Policy =>
  (dictId, reps) => {
    const u = hash01(seed, dictId, reps)
    if (u < pAgain) return Rating.Again
    if (u < pAgain + pHard) return Rating.Hard
    return Rating.Good
  }

const ALL_GOOD: Policy = () => Rating.Good

// ────────────────── 全库查询（不变量检查用；测试内可裸 SQL） ──────────────────

interface RawWord {
  dictId: number
  due: number | null
  stability: number
  difficulty: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  state: number
  lastReview: number | null
}

const allWords = (h: TestDb): RawWord[] =>
  h.sqlite
    .prepare(
      `SELECT dict_id AS dictId, due, stability, difficulty, scheduled_days AS scheduledDays,
              learning_steps AS learningSteps, reps, lapses, state, last_review AS lastReview
       FROM user_word WHERE is_deleted=0`,
    )
    .all() as RawWord[]

const countOne = (h: TestDb, sql: string, ...params: number[]): number =>
  (h.sqlite.prepare(sql).get(...params) as { n: number }).n

/** 未学池大小（state=0）。 */
const countNewPool = (h: TestDb): number =>
  countOne(h, 'SELECT count(*) AS n FROM user_word WHERE is_deleted=0 AND state=0')

/** 到期总数（state∈{1,2,3} 且 due<次日4:00）。 */
const countDue = (h: TestDb, nd: number): number =>
  countOne(
    h,
    'SELECT count(*) AS n FROM user_word WHERE is_deleted=0 AND state BETWEEN 1 AND 3 AND due < ?',
    nd,
  )

/**
 * 积压 = 本该更早复习却没复习的卡（due < 今日窗口起点 4:00）。
 * 与「到期数」（due<次日4:00，含今天自然到期的）区别开：稳态下每天把到期卡清完，积压恒为 0，
 * 只有跳过学习日才会堆积——所以它才是「空窗后恢复」的正确观测量（到期数受自然到期波动，永远不会归零）。
 */
const countOverdue = (h: TestDb, startMs: number): number =>
  countOne(
    h,
    'SELECT count(*) AS n FROM user_word WHERE is_deleted=0 AND state BETWEEN 1 AND 3 AND due < ?',
    startMs,
  )

/** 分钟级 intraday 卡数（state∈{1,3} 且 scheduled_days=0 且到期）。 */
const countIntraday = (h: TestDb, nd: number): number =>
  countOne(
    h,
    'SELECT count(*) AS n FROM user_word WHERE is_deleted=0 AND state IN (1,3) AND scheduled_days=0 AND due < ?',
    nd,
  )

/** 每词日志行数。 */
const logRowsByWord = (h: TestDb): Map<number, number> => {
  const rows = h.sqlite
    .prepare('SELECT dict_id AS dictId, count(*) AS n FROM user_review_log GROUP BY dict_id')
    .all() as { dictId: number; n: number }[]
  return new Map(rows.map((r) => [r.dictId, r.n]))
}

/** 每词「pre_state=2 且 rating=Again」日志行数（lapses 的期望口径）。 */
const lapseLogsByWord = (h: TestDb): Map<number, number> => {
  const rows = h.sqlite
    .prepare(
      'SELECT dict_id AS dictId, count(*) AS n FROM user_review_log WHERE pre_state=2 AND rating=1 GROUP BY dict_id',
    )
    .all() as { dictId: number; n: number }[]
  return new Map(rows.map((r) => [r.dictId, r.n]))
}

/** 到期却今日窗口内无日志的词（I2 饿死判据）。 */
const starvedDue = (h: TestDb, nd: number, startMs: number, endMs: number): number[] =>
  (
    h.sqlite
      .prepare(
        `SELECT w.dict_id AS dictId FROM user_word w
         WHERE w.is_deleted=0 AND w.state BETWEEN 1 AND 3 AND w.due < ?
           AND NOT EXISTS (SELECT 1 FROM user_review_log l
                           WHERE l.dict_id=w.dict_id AND l.review_time >= ? AND l.review_time < ?)`,
      )
      .all(nd, startMs, endMs) as { dictId: number }[]
  ).map((r) => r.dictId)

// ────────────────── 不变量 ──────────────────

/** I1 行合法性：状态枚举、state=0 三元同步、调度态字段范围、state=2 天级间隔 ≥1。 */
function checkI1(h: TestDb, label: string): void {
  for (const w of allWords(h)) {
    const at = `${label} dict=${w.dictId}`
    expect([0, 1, 2, 3], `${at} state 越界（本仿真不产生 4）`).toContain(w.state)
    if (w.state === State.New) {
      expect({ due: w.due, lastReview: w.lastReview, reps: w.reps }, `${at} state=0 三元`).toEqual({
        due: null,
        lastReview: null,
        reps: 0,
      })
      continue
    }
    expect(w.due, `${at} 调度态 due 非空`).not.toBeNull()
    expect(w.lastReview, `${at} 调度态 lastReview 非空`).not.toBeNull()
    expect(w.stability, `${at} stability>0`).toBeGreaterThan(0)
    expect(w.difficulty, `${at} difficulty ≥1`).toBeGreaterThanOrEqual(1)
    expect(w.difficulty, `${at} difficulty ≤10`).toBeLessThanOrEqual(10)
    expect(w.reps, `${at} reps ≥1`).toBeGreaterThanOrEqual(1)
    if (w.state === State.Review) {
      expect(w.scheduledDays, `${at} state=2 天级间隔 ≥1`).toBeGreaterThanOrEqual(1)
    }
  }
}

/** I2 无卡丢失 / 无饿死：到期的卡当天必被出到（仅额度充足场景断言）。 */
function checkI2(h: TestDb, now: number, label: string): void {
  const win = dayWindow(now)
  expect(starvedDue(h, win.endMs, win.startMs, win.endMs), `${label} 到期却今日无日志（饿死）`).toEqual([])
}

/** I3 记账一致：额度硬上限、新词引入数 = min(额度, 剩余池)、每词 reps === 日志行数。 */
async function checkI3(h: TestDb, s: DayStats, settings: Settings, label: string): Promise<void> {
  expect(s.newIntroduced, `${label} 今日新学 ≤ newPerDay`).toBeLessThanOrEqual(settings.newPerDay)
  expect(s.newIntroduced, `${label} 今日新学 = min(额度, 剩余池)`).toBe(
    Math.min(settings.newPerDay, s.poolBefore),
  )
  expect(s.reviewed, `${label} 今日复习 ≤ reviewsPerDay`).toBeLessThanOrEqual(settings.reviewsPerDay)
  const logs = logRowsByWord(h)
  for (const w of allWords(h)) {
    expect(logs.get(w.dictId) ?? 0, `${label} dict=${w.dictId} reps ↔ 日志行数`).toBe(w.reps)
  }
}

/** I4 lapses 口径：lapses === 该词「pre_state=2 且 rating=Again」的日志数。 */
function checkI4(h: TestDb, label: string): void {
  const lapseLogs = lapseLogsByWord(h)
  for (const w of allWords(h)) {
    expect(w.lapses, `${label} dict=${w.dictId} lapses ↔ Review 态 Again 日志数`).toBe(
      lapseLogs.get(w.dictId) ?? 0,
    )
  }
}

/** I5 单调性（软断言，全 Good 场景）：同一词天级复习的 scheduled_days 逐次不减。 */
function checkI5(history: Map<number, number[]>, label: string): void {
  for (const [dictId, seq] of history) {
    seq.slice(1).forEach((sd, i) => {
      expect(sd, `${label} dict=${dictId} 第${i + 2}次天级间隔不该缩短（${seq.join('→')}）`).toBeGreaterThanOrEqual(
        seq[i],
      )
    })
  }
}

// ────────────────── 单日流程 ──────────────────

interface RebuildInfo {
  /** 重建时刻的今日复习数（额度推导输入）。 */
  revDone: number
  /** 重建后会话三计数。 */
  counts: { new: number; learning: number; review: number }
  /** 重建时刻库内分钟级 intraday 卡数。 */
  intraday: number
}

interface DayStats {
  day: number
  /** 当日评分次数（含队列内循环的重复出卡）。 */
  ratings: number
  /** 日志推导的今日新学数。 */
  newIntroduced: number
  /** 日志推导的今日复习数。 */
  reviewed: number
  /** 开工前未学池大小。 */
  poolBefore: number
  /** 开工前到期总数（due<次日4:00）。 */
  dueBefore: number
  /** 开工前积压数（due<今日4:00，即前几天欠下的）。 */
  overdueBefore: number
  rebuild: RebuildInfo | null
}

interface DayOpts {
  /** 出到一半时丢弃 session、同日同刻重建（C5）。 */
  rebuildMidway?: boolean
  /** 收集每词天级复习的 scheduled_days 序列（I5）。 */
  history?: Map<number, number[]>
}

/** 跑完一个虚拟天：建队 → 循环出卡评分直到 done → 返回当日统计。 */
async function runDay(
  h: TestDb,
  settings: Settings,
  policy: Policy,
  day: number,
  opts: DayOpts = {},
): Promise<DayStats> {
  const start = dayStartAt(day)
  const win = dayWindow(start)
  const poolBefore = countNewPool(h)
  const dueBefore = countDue(h, win.endMs)
  const overdueBefore = countOverdue(h, win.startMs)

  let now = start
  let session: StudySession = await buildTodaySession(h.db, settings, now)
  const planned = session.counts()
  const rebuildAt = opts.rebuildMidway
    ? Math.floor((planned.new + planned.learning + planned.review) / 2)
    : -1
  let rebuild: RebuildInfo | null = null
  let ratings = 0

  for (let guard = 0; ; guard++) {
    if (guard > MAX_CARDS_PER_DAY) {
      throw new Error(`day${day} 出卡次数超上限 ${MAX_CARDS_PER_DAY}（疑似死循环）`)
    }
    if (rebuild === null && rebuildAt >= 0 && ratings >= rebuildAt) {
      // 丢弃旧会话，同日同刻重建（模拟中途退出重进）
      const revDone = await todayReviewCount(h.db, win.startMs, win.endMs)
      session = await buildTodaySession(h.db, settings, now)
      rebuild = { revDone, counts: session.counts(), intraday: countIntraday(h, win.endMs) }
    }
    const c = session.nextCard(now)
    if (c.kind === 'stale') {
      throw new Error(`day${day} 出卡返回 stale（now 应恒在窗口内，时钟越界或建队窗口错）`)
    }
    if (c.kind === 'done') {
      expect(session.counts(), `day${day} done ⟺ 三计数全零`).toEqual({ new: 0, learning: 0, review: 0 })
      break
    }
    const row = await words.getWord(h.db, c.dictId)
    if (!row) throw new Error(`day${day} 出到不存在的词 dict=${c.dictId}`)
    const res = await rate(
      h.db,
      session,
      {
        dictId: c.dictId,
        rating: policy(c.dictId, row.reps),
        durationMs: 5000,
        snapshotReps: row.reps,
      },
      now,
    )
    if (res.kind !== 'rated') {
      throw new Error(`day${day} dict=${c.dictId} 评分被丢弃(${res.reason})：重复出卡或快照错乱`)
    }
    if (res.word.due == null || res.word.due <= now) {
      throw new Error(`day${day} dict=${c.dictId} 评分后 due=${res.word.due} 未晚于评分时刻 ${now}`)
    }
    if (opts.history && res.word.state === State.Review) {
      const seq = opts.history.get(c.dictId)
      if (seq) seq.push(res.word.scheduledDays)
      else opts.history.set(c.dictId, [res.word.scheduledDays])
    }
    ratings++
    now += STEP_MS
  }

  return {
    day,
    ratings,
    newIntroduced: await todayNewCount(h.db, win.startMs, win.endMs),
    reviewed: await todayReviewCount(h.db, win.startMs, win.endMs),
    poolBefore,
    dueBefore,
    overdueBefore,
    rebuild,
  }
}

/** 场景收尾统计（人工 sanity check 用；同时作为「仿真真的跑起来了」的下限断言依据）。 */
interface Summary {
  days: number
  ratings: number
  graduated: number
  learning: number
  untouched: number
  totalLapses: number
  avgScheduledDays: number
  maxScheduledDays: number
}

function summarize(h: TestDb, days: number, stats: readonly DayStats[]): Summary {
  const rows = allWords(h)
  const review = rows.filter((r) => r.state === State.Review)
  const sd = review.map((r) => r.scheduledDays)
  return {
    days,
    ratings: stats.reduce((a, s) => a + s.ratings, 0),
    graduated: review.length,
    learning: rows.filter((r) => r.state === State.Learning || r.state === State.Relearning).length,
    untouched: rows.filter((r) => r.state === State.New).length,
    totalLapses: rows.reduce((a, r) => a + r.lapses, 0),
    avgScheduledDays: sd.length ? +(sd.reduce((a, x) => a + x, 0) / sd.length).toFixed(2) : 0,
    maxScheduledDays: sd.length ? Math.max(...sd) : 0,
  }
}

// ══════════════════ 场景矩阵 ══════════════════

const LONG = 240_000 // 长仿真单测超时（vitest 默认 5s 远不够）

describe('多日仿真', () => {
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
  })

  it(
    'C1 基线：60 天 / 池 400 / 新20 复200 / 85-10-5 —— I1~I4 全量',
    async () => {
      // I5（天级间隔不减）按定义只在全 Good 下成立：混合策略里 Again 会合法地把间隔打回 2 天、
      // Hard 对高稳定度卡也可能压缩间隔，所以它落在 C2 而不在此处（不是漏测，是定义域）。
      const settings = mkSettings({ newPerDay: 20, reviewsPerDay: 200, newReviewMix: 'mix' })
      const policy = mkPolicy(1, 0.05, 0.1)
      seedPool(h, 400)
      const stats: DayStats[] = []
      for (let d = 0; d < 60; d++) {
        const s = await runDay(h, settings, policy, d)
        stats.push(s)
        const label = `C1 day${d}`
        checkI1(h, label)
        checkI2(h, dayStartAt(d), label)
        await checkI3(h, s, settings, label)
        checkI4(h, label)
      }
      const sum = summarize(h, 60, stats)
      expect(sum.untouched, '池 400 / 20 天引入完毕 → 60 天后无未学词').toBe(0)
      expect(sum.graduated, '绝大多数词应已毕业到天级 Review').toBeGreaterThan(350)
      expect(sum.totalLapses, '5% Again 下应确实产生过遗忘').toBeGreaterThan(0)
    },
    LONG,
  )

  it(
    'C2 全 Good：30 天 / 池 200 —— I1~I4 + I5 严格版（天级间隔不减）',
    async () => {
      const settings = mkSettings({ newPerDay: 20, reviewsPerDay: 200 })
      seedPool(h, 200)
      const history = new Map<number, number[]>()
      const stats: DayStats[] = []
      for (let d = 0; d < 30; d++) {
        const s = await runDay(h, settings, ALL_GOOD, d, { history })
        stats.push(s)
        const label = `C2 day${d}`
        checkI1(h, label)
        checkI2(h, dayStartAt(d), label)
        await checkI3(h, s, settings, label)
        checkI4(h, label) // 全 Good 下应恒为 0 ↔ 0（同时验证 lapses 不会凭空冒出来）
        checkI5(history, label)
      }
      const sum = summarize(h, 30, stats)
      expect(sum.untouched, '池 200 / 10 天引入完毕').toBe(0)
      expect(sum.totalLapses, '全 Good 不应产生任何遗忘').toBe(0)
      expect(sum.graduated, '全 Good 下 30 天后全部在天级 Review').toBe(200)
      expect(history.size, 'I5 应有可比较的天级复习序列').toBeGreaterThan(0)
    },
    LONG,
  )

  it(
    'C3 高遗忘：30 天 / 60-15-25 —— 重学循环下 I1~I4，lapses 持续增长',
    async () => {
      const settings = mkSettings({ newPerDay: 20, reviewsPerDay: 200 })
      const policy = mkPolicy(3, 0.25, 0.15)
      seedPool(h, 200)
      const stats: DayStats[] = []
      const lapseTrend: number[] = []
      for (let d = 0; d < 30; d++) {
        const s = await runDay(h, settings, policy, d)
        stats.push(s)
        const label = `C3 day${d}`
        checkI1(h, label)
        checkI2(h, dayStartAt(d), label)
        await checkI3(h, s, settings, label)
        checkI4(h, label)
        lapseTrend.push(allWords(h).reduce((a, w) => a + w.lapses, 0))
      }
      // lapses 单调不减（append-only 语义）且确实增长
      lapseTrend.slice(1).forEach((n, i) => expect(n).toBeGreaterThanOrEqual(lapseTrend[i]))
      expect(lapseTrend[lapseTrend.length - 1], '高遗忘策略下 lapses 应持续增长').toBeGreaterThan(50)
      expect(summarize(h, 30, stats).untouched).toBe(0)
    },
    LONG,
  )

  it(
    'C4 额度紧张：30 天 / 池 200 / 新5 复10 —— 额度硬上限不被击穿，积压下 I1 恒成立（跳过 I2）',
    async () => {
      const settings = mkSettings({ newPerDay: 5, reviewsPerDay: 10 })
      const policy = mkPolicy(4, 0.05, 0.1)
      seedPool(h, 200)
      const stats: DayStats[] = []
      for (let d = 0; d < 30; d++) {
        const s = await runDay(h, settings, policy, d)
        stats.push(s)
        const label = `C4 day${d}`
        checkI1(h, label)
        await checkI3(h, s, settings, label) // 含额度硬上限
        checkI4(h, label)
      }
      // 积压是预期结果：额度紧张下到期数应显著超过日复习额度
      const lastDay = 29
      const backlog = countDue(h, dayWindow(dayStartAt(lastDay)).endMs)
      expect(backlog, '额度紧张场景应确实积压（否则本场景没测到东西）').toBeGreaterThan(
        settings.reviewsPerDay,
      )
      expect(summarize(h, 30, stats).untouched, '新词额度 5/天 × 30 天 → 池 200 未取完').toBeGreaterThan(0)
    },
    LONG,
  )

  it(
    'C5 中途重建：30 天，每天出到一半丢弃 session 同日重建 —— 不重复计账、分钟步卡不占额度、收工 I2 成立',
    async () => {
      const settings = mkSettings({ newPerDay: 20, reviewsPerDay: 200 })
      const policy = mkPolicy(5, 0.1, 0.15)
      seedPool(h, 200)
      const stats: DayStats[] = []
      for (let d = 0; d < 30; d++) {
        const s = await runDay(h, settings, policy, d, { rebuildMidway: true })
        stats.push(s)
        const label = `C5 day${d}`
        checkI1(h, label)
        checkI2(h, dayStartAt(d), label) // 中途重建后当日仍不该有饿死的卡
        await checkI3(h, s, settings, label) // 额度推导正确 ⟺ 新词引入数仍 = min(额度, 池)
        checkI4(h, label)
        if (s.rebuild) {
          // 重建时复习额度按「已复习数」扣减，不因重建而重新放开
          expect(
            s.rebuild.counts.review,
            `${label} 重建后复习队列 ≤ 剩余复习额度`,
          ).toBeLessThanOrEqual(Math.max(0, settings.reviewsPerDay - s.rebuild.revDone))
          // 分钟级步卡回到 intraday（计「学」），且不消耗复习额度
          expect(
            s.rebuild.counts.learning,
            `${label} 重建后分钟步卡应全部回到队列`,
          ).toBeGreaterThanOrEqual(s.rebuild.intraday)
        }
      }
      expect(stats.filter((s) => s.rebuild !== null).length, '每天都应真的发生了重建').toBe(30)
      expect(summarize(h, 30, stats).untouched).toBe(0)
    },
    LONG,
  )

  it(
    'C6 停学空窗：学 10 天 → 空窗 7 天 → 恢复至积压清零 —— 恢复期 I1/I3 恒成立、积压逐日下降至 0',
    async () => {
      // 学习期额度充足（积压恒 0，作为干净基线）；恢复期收紧复习额度，让空窗欠下的账分多天消化，
      // 才能真正观察到「积压逐日下降」的曲线（额度紧张下 I2 本就不成立，故本场景只查 I1/I3，同场景矩阵）。
      const learn = mkSettings({ newPerDay: 10, reviewsPerDay: 200 })
      const recover = mkSettings({ newPerDay: 10, reviewsPerDay: 40 })
      const policy = mkPolicy(6, 0.1, 0.1)
      seedPool(h, 100) // 10 天 × 10 词 = 池刚好取完，空窗后不再引入新词
      const stats: DayStats[] = []
      for (let d = 0; d < 10; d++) {
        const s = await runDay(h, learn, policy, d)
        stats.push(s)
        const label = `C6 学习期 day${d}`
        checkI1(h, label)
        await checkI3(h, s, learn, label)
        checkI4(h, label)
        expect(s.overdueBefore, `${label} 每天清完 → 积压恒 0`).toBe(0)
      }

      // 空窗 7 天：时钟推进、不学（day 10..16）
      const resumeDay = 17
      expect(countOverdue(h, dayWindow(dayStartAt(resumeDay)).startMs), '空窗 7 天应确实堆出积压')
        .toBeGreaterThan(20)

      // 恢复学习直到某天开工时积压已清零；清零后再跑 2 天确认稳定不反弹
      const trend: number[] = []
      let cleared = -1
      for (let d = resumeDay; d < resumeDay + 25; d++) {
        const s = await runDay(h, recover, policy, d)
        stats.push(s)
        const label = `C6 恢复期 day${d}`
        checkI1(h, label)
        await checkI3(h, s, recover, label)
        checkI4(h, label)
        trend.push(s.overdueBefore)
        if (s.overdueBefore === 0) {
          cleared = d
          if (trend.length >= 3 && trend.slice(-3).every((x) => x === 0)) break
        }
      }
      const traj = trend.join('→')
      expect(cleared, `恢复 25 天内应清零积压（积压轨迹 ${traj}）`).toBeGreaterThan(0)
      expect(trend[0], `恢复首日积压最大（${traj}）`).toBe(Math.max(...trend))
      // 逐日不增（欠账只会被还，不会在恢复期反弹）
      trend.slice(1).forEach((n, i) => expect(n, `积压不该反弹（${traj}）`).toBeLessThanOrEqual(trend[i]))
      expect(trend[trend.length - 1], `末日积压归零（${traj}）`).toBe(0)
      expect(summarize(h, stats.length, stats).untouched, '池 100 应在学习期取完').toBe(0)
    },
    LONG,
  )
})
