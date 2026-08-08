// 双端同步 × 调度交叉仿真（sync.md §3 协议真源 + study.md 记账口径）：两个内存库当设备 A/B，
// 配一个逐条按 sync.md §3.2/§3.3 语义实现的假服务端，共用一个虚拟钟交错学习、多回合同步，
// 断言「两台设备各自学习、来回同步后真的收敛」——这是 wordbook.test.ts（单步仲裁）与
// simulation.test.ts（单端长周期）都覆盖不到的一层：机械件全对但编排/仲裁接不上时才会在这里炸。
//
// 已接受的局限（写死在这里免得后人误会）：回合编排在本文件内**重实现**（syncRound/pullLoop/pushDirty），
// 因为 SyncEngine 绑死了 db 单例与 api 模块。它验证的是「机械件 + 规格化编排」，
// SyncEngine 类自身的接线不在本测试范围；重实现逐步对齐 engine.ts 的 runRound（顺序 / 原子性 / 游标推进时机）。
//
// 虚拟钟纪律（同 simulation.test.ts）：全局单调、绝不回拨，任何落库写前先前进 ≥1ms——
// editTime 相等的 tie 只允许在 S4 里**故意**构造；日志唯一键 (dict_id, review_time) 撞了会被静默吞掉，账目必错。
//
// 生产与测试跑同一套数据函数（同 engine.test.ts / scheduler.test.ts）：sqlite-proxy 回调指向进程内 better-sqlite3。
import Database from 'better-sqlite3'
import { drizzle as betterDrizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as proxyDrizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { Rating, State } from 'ts-fsrs'
import { runBatch as execBatch, runStmt as execStmt } from '../../../main/dbExecutor'
import { runBatch, type Db } from '@/db/client'
import { getMeta, setMetaStmt } from '@/db/meta'
import { words as wordsCollection, reviewLogs as reviewLogsCollection } from '@/wordbook/collections'
import { addWords, getWord, setMastered } from '@/wordbook/words'
import { todayNewCount, todayReviewCount } from '@/wordbook/reviewLog'
import { dayWindow } from '@/wordbook/time'
import { buildTodaySession, rate, type QueueKind, type StudySession } from '@/wordbook/scheduler/queue'
import type { RateGrade } from '@/wordbook/scheduler/fsrs'
import type { BatchItem } from 'drizzle-orm/batch'
import type {
  ReviewLogRow,
  SyncChanges,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  WordRow,
} from './protocol'
import type { Settings } from '@/settings'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../drizzle', import.meta.url))

/** 与 engine.ts 同值（该文件未导出，此处按 sync.md §3.4 复刻：pull limit clamp[1,500]、push 200 行/批）。 */
const PULL_LIMIT = 500
const PUSH_BATCH = 200

const MIN = 60_000
const DAY = 24 * 60 * MIN
/** 每评一张卡时钟前进量（同 simulation.test.ts）。 */
const STEP_MS = 30_000
/** 单日出卡安全上限：超限即疑似死循环。 */
const MAX_CARDS_PER_DAY = 5_000
/** 单个 pullLoop 的翻页安全上限。 */
const MAX_PAGES = 200

/** 第 k 个虚拟天的 10:00（Date 组件构造，稳落在当日 [4:00, 次日4:00) 窗口内）。 */
const dayStartAt = (k: number): number => new Date(2026, 0, 15 + k, 10, 0, 0, 0).getTime()

// ══════════════════ 虚拟钟（两端共用，单调前进） ══════════════════

class Clock {
  private t: number
  constructor(start: number) {
    this.t = start
  }
  now(): number {
    return this.t
  }
  /** 前进 ms（默认 1ms）并返回新值：任何落库写前调用，保证 editTime 可区分、日志键不撞。 */
  tick(ms = 1): number {
    if (ms < 1) throw new Error(`虚拟钟必须前进 ≥1ms（收到 ${ms}）`)
    this.t += ms
    return this.t
  }
  /** 跳到某个绝对时刻（只许前进，绝不回拨）。 */
  jump(to: number): number {
    if (to < this.t) throw new Error(`虚拟钟回拨：${this.t} → ${to}`)
    this.t = to
    return this.t
  }
}

// ══════════════════ 设备（内存 sqlite + 迁移 + 自己的游标） ══════════════════

interface Device {
  name: string
  db: Db
  sqlite: Database.Database
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** 模拟一台设备：进程内 better-sqlite3 + 迁移建库，走与生产同一套数据函数（照抄 engine.test.ts）。 */
function makeDevice(name: string): Device {
  const sqlite = new Database(':memory:')
  migrate(betterDrizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR })
  const db = proxyDrizzle(
    async (sql, params, method) => execStmt(sqlite, { sql, params, method }) as { rows: any[] },
    async (queries) => execBatch(sqlite, queries) as { rows: any[] }[],
  )
  return { name, db, sqlite }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ══════════════════ 假服务端（逐条对齐 sync.md §3.2 / §3.3） ══════════════════

const logKey = (r: { dictId: number; reviewTime: number }): string => `${r.dictId}:${r.reviewTime}`

/** 服务端业务内容快照（不含 syncVer）：重放幂等断言用——`>=` 覆盖会重新发号，内容才是不变量。 */
interface ContentSnapshot {
  words: Omit<WordRow, 'syncVer'>[]
  logs: Omit<ReviewLogRow, 'syncVer'>[]
}

/**
 * 内存假服务端：只实现 words + reviewLogs 两个集合（本批范围）。
 * 单调号池从 1 起、全序无并列；上行行的 syncVer 一律忽略（客户端恒送 0），下发行必带服务端发的号。
 */
class FakeServer {
  private readonly wordRows = new Map<number, WordRow>()
  private readonly logRows = new Map<string, ReviewLogRow>()
  private nextVer = 1
  pushCalls = 0
  pullCalls = 0

  constructor(private readonly clock: Clock) {}

  logCount(): number {
    return this.logRows.size
  }
  wordCount(): number {
    return this.wordRows.size
  }
  wordOf(dictId: number): WordRow | undefined {
    const r = this.wordRows.get(dictId)
    return r ? { ...r } : undefined
  }
  maxVer(): number {
    return this.nextVer - 1
  }

  contentSnapshot(): ContentSnapshot {
    const strip = <T extends { syncVer: number }>(r: T): Omit<T, 'syncVer'> => {
      const { syncVer: _drop, ...rest } = r
      return rest
    }
    return {
      words: [...this.wordRows.values()].sort((a, b) => a.dictId - b.dictId).map(strip),
      logs: [...this.logRows.values()]
        .sort((a, b) => a.dictId - b.dictId || a.reviewTime - b.reviewTime)
        .map(strip),
    }
  }

  /**
   * push（sync.md §3.3）：
   * - words（LWW）：无行 → insert 发号；`remote.editTime >= existing.editTime` → 整行覆盖发号（**>= 语义**，
   *   等值也覆盖，重放友好）；严格更小 → 装入 `rejected.words` 带回服务端当前行（含其 syncVer）。
   * - reviewLogs（append-only）：按 (dictId, reviewTime) 幂等——已存在则静默成功、不发新号、不进 rejected。
   * 本仿真只产合法行，`skippedInvalid` 恒 0（形状守卫不在本批范围）。
   */
  push(req: SyncPushRequest): SyncPushResponse {
    this.pushCalls++
    const rejected: SyncChanges = {}
    let maxAssignedVer = 0
    for (const row of req.changes.words ?? []) {
      const existing = this.wordRows.get(row.dictId)
      if (existing && row.editTime < existing.editTime) {
        ;(rejected.words ??= []).push({ ...existing }) // 服务端赢：带回当前行供客户端就地收敛
        continue
      }
      const syncVer = this.nextVer++
      maxAssignedVer = Math.max(maxAssignedVer, syncVer)
      this.wordRows.set(row.dictId, { ...row, syncVer })
    }
    for (const row of req.changes.reviewLogs ?? []) {
      const k = logKey(row)
      if (this.logRows.has(k)) continue // 唯一键命中 = 重复推送，幂等静默成功、不获新号
      const syncVer = this.nextVer++
      maxAssignedVer = Math.max(maxAssignedVer, syncVer)
      this.logRows.set(k, { ...row, syncVer })
    }
    return { maxAssignedVer, rejected, skippedInvalid: 0, serverTimeMs: this.clock.now() }
  }

  /**
   * pull（sync.md §3.2）：两集合各查 `syncVer > since ORDER BY syncVer LIMIT limit`，
   * 内存按 syncVer 全序合并后取前 `limit` 行装回 changes；`nextSince` = 本页纳入的最大 syncVer；
   * **`done` = 合并候选总数 < limit（严格小于——恰好等于 limit 时必须让客户端再翻一页）**；
   * 空页 `nextSince = since`、`done = true`。limit clamp [1,500]。首灌（since=0）跳墓碑行。
   */
  pull(req: SyncPullRequest): SyncPullResponse {
    this.pullCalls++
    const limit = Math.min(500, Math.max(1, Math.trunc(req.limit)))
    const since = req.since
    const byVer = (a: { syncVer: number }, b: { syncVer: number }): number => a.syncVer - b.syncVer
    const w = [...this.wordRows.values()]
      .filter((r) => r.syncVer > since && !(since === 0 && r.isDeleted === 1))
      .sort(byVer)
      .slice(0, limit)
    const l = [...this.logRows.values()].filter((r) => r.syncVer > since).sort(byVer).slice(0, limit)
    const merged = [...w, ...l].sort(byVer)
    const done = merged.length < limit // 严格小于：恰好等于 limit 时必须再翻一页
    const page = merged.slice(0, limit)
    const changes: SyncChanges = {}
    for (const r of page) {
      if ('reviewTime' in r) (changes.reviewLogs ??= []).push({ ...(r as ReviewLogRow) })
      else (changes.words ??= []).push({ ...(r as WordRow) })
    }
    const nextSince = page.length > 0 ? page[page.length - 1].syncVer : since
    return { changes, nextSince, done, serverTimeMs: this.clock.now() }
  }
}

// ══════════════════ 客户端回合（对齐 engine.ts runRound / pullLoop / pushDirty） ══════════════════

/** 本地游标 last_sync_ver（同 engine.ts）。 */
async function getCursor(db: Db): Promise<number> {
  return Number((await getMeta(db, 'last_sync_ver')) ?? '0')
}
function setCursorStmt(db: Db, ver: number) {
  return setMetaStmt(db, 'last_sync_ver', String(Math.trunc(ver)))
}

interface PullPage {
  words: number
  logs: number
  nextSince: number
  done: boolean
}

/**
 * pullLoop：循环 pull → 一页的 words/reviewLogs 应用语句 + 游标推进**合入同一 runBatch 原子提交**
 *（apply 顺序 words → reviewLogs，同 engine.ts）→ `done` 为止。
 */
async function pullLoop(dev: Device, server: FakeServer, limit = PULL_LIMIT): Promise<PullPage[]> {
  const pages: PullPage[] = []
  for (let guard = 0; ; guard++) {
    if (guard > MAX_PAGES) throw new Error(`${dev.name} pullLoop 翻页超上限（疑似 done 永不为真）`)
    const since = await getCursor(dev.db)
    const res = server.pull({ since, limit })
    const c = res.changes
    const applyStmts: BatchItem<'sqlite'>[] = [
      ...(c.words ?? []).map((r) => wordsCollection.applyRemoteStmt(dev.db, r)),
      ...(c.reviewLogs ?? []).map((r) => reviewLogsCollection.applyRemoteStmt(dev.db, r)),
    ]
    await runBatch(dev.db, [...applyStmts, setCursorStmt(dev.db, res.nextSince)])
    pages.push({
      words: (c.words ?? []).length,
      logs: (c.reviewLogs ?? []).length,
      nextSince: res.nextSince,
      done: res.done,
    })
    if (res.done) break
  }
  return pages
}

/** 把两集合脏行扁平化后按 size 切块，再按集合装回 SyncChanges（同 engine.ts chunkChanges）。 */
function chunkChanges(
  all: { words: WordRow[]; reviewLogs: ReviewLogRow[] },
  size: number,
): SyncChanges[] {
  type Tagged = { k: 'words' | 'reviewLogs'; row: unknown }
  const tagged: Tagged[] = [
    ...all.words.map((row) => ({ k: 'words' as const, row })),
    ...all.reviewLogs.map((row) => ({ k: 'reviewLogs' as const, row })),
  ]
  const batches: SyncChanges[] = []
  for (let i = 0; i < tagged.length; i += size) {
    const b: SyncChanges = {}
    for (const { k, row } of tagged.slice(i, i + size)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;((b[k] ??= [] as any) as unknown[]).push(row)
    }
    batches.push(b)
  }
  return batches
}

async function collectAllDirty(dev: Device): Promise<{ words: WordRow[]; reviewLogs: ReviewLogRow[] }> {
  return {
    words: await wordsCollection.collectDirty(dev.db),
    reviewLogs: await reviewLogsCollection.collectDirty(dev.db),
  }
}

interface PushStats {
  /** 是否有过写入（决定是否收口 pull）。 */
  pushed: boolean
  batches: number
  rows: number
  /** 本次推送被服务端拒回的 LWW 行数（LWW 输给服务端当前行）。 */
  rejected: number
}

/**
 * pushDirty：收脏 → 扁平化按 200 行/批切块推送；每批回执按 reconcile 顺序处理——
 * **先应用 `rejected` 行（applyRemoteStmt），再对推送批 clearAcceptedStmts**，合入同一 batch（同 engine.ts）。
 */
async function pushDirty(dev: Device, server: FakeServer): Promise<PushStats> {
  const dirty = await collectAllDirty(dev)
  const rows = dirty.words.length + dirty.reviewLogs.length
  if (rows === 0) return { pushed: false, batches: 0, rows: 0, rejected: 0 }
  let rejected = 0
  const batches = chunkChanges(dirty, PUSH_BATCH)
  for (const batch of batches) {
    const res = server.push({ changes: batch })
    const stmts: BatchItem<'sqlite'>[] = []
    for (const r of res.rejected.words ?? []) stmts.push(wordsCollection.applyRemoteStmt(dev.db, r))
    stmts.push(...wordsCollection.clearAcceptedStmts(dev.db, batch.words ?? []))
    // reviewLogs 是 append-only，无 rejected（幂等静默成功），只清 dirty。
    stmts.push(...reviewLogsCollection.clearAcceptedStmts(dev.db, batch.reviewLogs ?? []))
    await runBatch(dev.db, stmts)
    rejected += (res.rejected.words ?? []).length
  }
  return { pushed: true, batches: batches.length, rows, rejected }
}

/** 一回合 = pullLoop → pushDirty →（有推送则）收口 pullLoop（把自己刚发号的行拉回，幂等无害）。 */
async function syncRound(dev: Device, server: FakeServer, limit = PULL_LIMIT): Promise<PushStats> {
  await pullLoop(dev, server, limit)
  const push = await pushDirty(dev, server)
  if (push.pushed) await pullLoop(dev, server, limit)
  return push
}

// ══════════════════ 种子 / 全库读（测试内可裸 SQL） ══════════════════

function seedDict(dev: Device, dictId: number, term = `w${dictId}`): void {
  dev.sqlite.prepare('INSERT INTO dict (dict_id, term, term_type) VALUES (?,?,?)').run(dictId, term, 1)
}

/** 两端都种同一批 dict 缓存行（词典缓存不入同步协议，各端由词库补缺自行填，cache/dict.md）。 */
function seedDictBoth(devs: Device[], ids: readonly number[]): void {
  for (const dev of devs) for (const id of ids) seedDict(dev, id)
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
  /** 默认 1：种下即待推（本文件的种子代表「该端本地已有的变更」）。 */
  dirty?: number
}

function seedWordRow(dev: Device, o: SeedWord): void {
  dev.sqlite
    .prepare(
      `INSERT INTO user_word
       (dict_id, due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review, join_time, edit_time, is_deleted, dirty)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      o.dirty ?? 1,
    )
}

interface DumpWord {
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
  joinTime: number
  editTime: number
  isDeleted: number
}
interface DumpLog {
  dictId: number
  reviewTime: number
  rating: number
  durationMs: number
  preState: number
  preStability: number
  preDifficulty: number
}
interface DumpState {
  words: DumpWord[]
  logs: DumpLog[]
}

/**
 * 全库业务态快照（业务列 + isDeleted，**排除 dirty 列**——dirty 是本地私有态，收敛静止后另行断言为 0）。
 * 浮点逐位比较：两端同源计算必须逐位一致，不一致就是发现，不许 toBeCloseTo 弱化。
 */
function dumpState(dev: Device): DumpState {
  const words = dev.sqlite
    .prepare(
      `SELECT dict_id AS dictId, due, stability, difficulty, scheduled_days AS scheduledDays,
              learning_steps AS learningSteps, reps, lapses, state, last_review AS lastReview,
              join_time AS joinTime, edit_time AS editTime, is_deleted AS isDeleted
       FROM user_word ORDER BY dict_id`,
    )
    .all() as DumpWord[]
  const logs = dev.sqlite
    .prepare(
      `SELECT dict_id AS dictId, review_time AS reviewTime, rating, duration_ms AS durationMs,
              pre_state AS preState, pre_stability AS preStability, pre_difficulty AS preDifficulty
       FROM user_review_log ORDER BY dict_id, review_time`,
    )
    .all() as DumpLog[]
  return { words, logs }
}

const countOne = (dev: Device, sql: string): number =>
  (dev.sqlite.prepare(sql).get() as { n: number }).n

const dirtyCounts = (dev: Device): { words: number; logs: number } => ({
  words: countOne(dev, 'SELECT count(*) AS n FROM user_word WHERE dirty=1'),
  logs: countOne(dev, 'SELECT count(*) AS n FROM user_review_log WHERE dirty=1'),
})

const logCountOf = (dev: Device, dictId?: number): number =>
  dictId == null
    ? countOne(dev, 'SELECT count(*) AS n FROM user_review_log')
    : (dev.sqlite
        .prepare('SELECT count(*) AS n FROM user_review_log WHERE dict_id=?')
        .get(dictId) as { n: number }).n

const wordIdsOf = (dev: Device): number[] =>
  (dev.sqlite.prepare('SELECT dict_id AS id FROM user_word ORDER BY dict_id').all() as {
    id: number
  }[]).map((r) => r.id)

// ══════════════════ 收敛静止断言 ══════════════════

/** 交替跑回合直到静止（两端均无脏行且游标一致）。 */
async function settle(A: Device, B: Device, server: FakeServer, limit = PULL_LIMIT): Promise<number> {
  for (let i = 1; i <= 4; i++) {
    await syncRound(A, server, limit)
    await syncRound(B, server, limit)
    const quiet =
      dirtyCounts(A).words + dirtyCounts(A).logs === 0 && dirtyCounts(B).words + dirtyCounts(B).logs === 0
    if (quiet && (await getCursor(A.db)) === (await getCursor(B.db))) return i
  }
  throw new Error('4 个来回后仍未收敛静止')
}

/** 收敛静止 + 全套断言：两端全库深等、两端 dirty 计数为 0、日志零丢失（两端行数 = 服务端日志行数）。 */
async function settleAndAssert(
  A: Device,
  B: Device,
  server: FakeServer,
  label: string,
  limit = PULL_LIMIT,
): Promise<void> {
  await settle(A, B, server, limit)
  expect(dirtyCounts(A), `${label} A 端收敛后无脏行`).toEqual({ words: 0, logs: 0 })
  expect(dirtyCounts(B), `${label} B 端收敛后无脏行`).toEqual({ words: 0, logs: 0 })
  expect(await getCursor(A.db), `${label} 两端游标一致`).toBe(await getCursor(B.db))
  const a = dumpState(A)
  const b = dumpState(B)
  expect(b, `${label} 两端全库深等（浮点逐位）`).toEqual(a)
  expect(a.logs.length, `${label} A 日志行数 = 服务端日志行数（零丢失）`).toBe(server.logCount())
  expect(b.logs.length, `${label} B 日志行数 = 服务端日志行数（零丢失）`).toBe(server.logCount())
  expect(a.words.length, `${label} A 词行数 = 服务端词行数`).toBe(server.wordCount())
}

// ══════════════════ 学习驱动（复用 simulation.test.ts 的单日排空 + 确定性评分策略） ══════════════════

const mkSettings = (o: Partial<Settings> = {}): Settings => ({
  newPerDay: 20,
  reviewsPerDay: 200,
  newReviewMix: 'mix',
  // pin joinTime：新词「抽哪些」确定，剩下的随机只在同日复习桶内（本文件不断言顺序，只断言集合与收敛）。
  newCardOrder: 'joinTime',
  meaningSource: 'concise',
  accent: 'us',
  autoPlayAudio: 1,
  readingFontSize: 16,
  readingFontFamily: 'serif',
  ...o,
})

/** 确定性整数 hash → [0,1)：键入 (seed, dictId, reps)，与出卡顺序无关（照抄 simulation.test.ts）。 */
function hash01(seed: number, dictId: number, reps: number): number {
  let x =
    (Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(dictId + 1, 0x85ebca6b) ^ Math.imul(reps + 1, 0xc2b2ae35)) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000
}

type Policy = (dictId: number, reps: number) => RateGrade

const mkPolicy =
  (seed: number, pAgain: number, pHard: number): Policy =>
  (dictId, reps) => {
    const u = hash01(seed, dictId, reps)
    if (u < pAgain) return Rating.Again
    if (u < pAgain + pHard) return Rating.Hard
    return Rating.Good
  }

const ALL_GOOD: Policy = () => Rating.Good

interface Served {
  dictId: number
  kind: QueueKind
}

/** 排空一个会话：每评一卡前进 30s；返回每张卡的出卡记录（含类别，供队列归属断言）。 */
async function drainSession(
  dev: Device,
  session: StudySession,
  clock: Clock,
  policy: Policy,
  label: string,
): Promise<Served[]> {
  const served: Served[] = []
  for (let guard = 0; ; guard++) {
    if (guard > MAX_CARDS_PER_DAY) throw new Error(`${label} 出卡超上限（疑似死循环）`)
    const c = session.nextCard(clock.now())
    if (c.kind === 'stale') throw new Error(`${label} 出卡返回 stale（时钟越界或建队窗口错）`)
    if (c.kind === 'done') return served
    served.push({ dictId: c.dictId, kind: c.cardKind })
    const row = await getWord(dev.db, c.dictId)
    if (!row) throw new Error(`${label} 出到不存在的词 dict=${c.dictId}`)
    const res = await rate(
      dev.db,
      session,
      { dictId: c.dictId, rating: policy(c.dictId, row.reps), durationMs: 5000, snapshotReps: row.reps },
      clock.now(),
    )
    if (res.kind !== 'rated') throw new Error(`${label} dict=${c.dictId} 评分被丢弃(${res.reason})`)
    clock.tick(STEP_MS)
  }
}

/** 跑完一个虚拟天：建队 → 排空。 */
async function runDay(
  dev: Device,
  settings: Settings,
  clock: Clock,
  policy: Policy,
  label: string,
): Promise<Served[]> {
  const session = await buildTodaySession(dev.db, settings, clock.now())
  return drainSession(dev, session, clock, policy, label)
}

/** 今日窗口内的两个记账推导（study.md §每日记账）。 */
async function accounting(dev: Device, now: number): Promise<{ newCount: number; reviewCount: number }> {
  const win = dayWindow(now)
  return {
    newCount: await todayNewCount(dev.db, win.startMs, win.endMs),
    reviewCount: await todayReviewCount(dev.db, win.startMs, win.endMs),
  }
}

// ══════════════════ 场景 ══════════════════

describe('双端同步收敛仿真（sync.md §3 + study.md）', () => {
  let A: Device
  let B: Device
  let server: FakeServer
  let clock: Clock

  beforeEach(() => {
    clock = new Clock(dayStartAt(0) - DAY) // 建库/种子发生在第 0 天之前
    A = makeDevice('A')
    B = makeDevice('B')
    server = new FakeServer(clock)
  })

  const LONG = 240_000

  // ────────────────── S1 接力收敛（基线） ──────────────────

  it(
    'S1 接力收敛：A 学 3 天 → B 空库首灌收敛 + 记账跨端一致 → B 学第 4 天回推 → A 拉回再收敛',
    async () => {
      const POOL = 50
      const ids = Array.from({ length: POOL }, (_, i) => i + 1)
      seedDictBoth([A, B], ids)
      await addWords(A.db, ids, clock.tick())

      const settings = mkSettings({ newPerDay: 10, reviewsPerDay: 100 })
      const policy = mkPolicy(11, 0.1, 0.15)

      // A 学 3 个虚拟天，每天收工同步一回合
      for (let d = 0; d < 3; d++) {
        clock.jump(dayStartAt(d))
        const served = await runDay(A, settings, clock, policy, `S1 A day${d}`)
        // 下限断言：新词额度 10、每张新卡至少走 1m/10m 两步 → 当天出卡数必然 ≥ 20（防「仿真其实没跑」空过）
        expect(served.length, `S1 A day${d} 当天确实排空了队列`).toBeGreaterThanOrEqual(20)
        clock.tick()
        await syncRound(A, server)
      }
      expect(dirtyCounts(A), 'S1 A 收工后脏行已推完').toEqual({ words: 0, logs: 0 })
      expect(server.logCount(), 'S1 三天的日志都已进服务端').toBeGreaterThanOrEqual(60)

      // B 从空库首灌
      expect(wordIdsOf(B), 'S1 B 首灌前是空库').toEqual([])
      clock.tick()
      await syncRound(B, server)
      expect(wordIdsOf(B), 'S1 B 首灌拿到全部词行').toEqual(ids)

      // 记账跨端一致（额度从日志推导，不依赖本地计数器）
      const dayTwoNow = clock.now()
      const accA = await accounting(A, dayTwoNow)
      expect(accA.newCount, 'S1 A 第 3 天新学满额（否则下面的相等断言是空对空）').toBe(10)
      expect(accA.reviewCount, 'S1 A 第 3 天确实复习了旧词').toBeGreaterThan(0)
      expect(await accounting(B, dayTwoNow), 'S1 B 的今日记账推导与 A 相等').toEqual(accA)
      await settleAndAssert(A, B, server, 'S1 首灌后')

      // B 继续学第 4 天并回推，A 拉回后再收敛
      clock.jump(dayStartAt(3))
      const served = await runDay(B, settings, clock, policy, 'S1 B day3')
      expect(served.length, 'S1 B 第 4 天确实学了卡（新词 + 前三天攒下的到期复习）').toBeGreaterThanOrEqual(20)
      clock.tick()
      await settleAndAssert(A, B, server, 'S1 B 学第 4 天后')

      // 第 4 天的记账两端同样一致（A 自己没学，全靠拉回的日志推导）
      expect(await accounting(A, clock.now()), 'S1 A 拉回后第 4 天记账与 B 相等').toEqual(
        await accounting(B, clock.now()),
      )
    },
    LONG,
  )

  // ────────────────── S2 同日接力额度 ──────────────────

  it(
    'S2 同日接力额度：A 上午学 12 个新词 → B 同日建会话额度 = 20−12、A 已学词不进新词队列 → 两端今日新学均为 20',
    async () => {
      const POOL = 30
      const ids = Array.from({ length: POOL }, (_, i) => i + 1)
      seedDictBoth([A, B], ids)
      await addWords(A.db, ids, clock.tick())
      clock.tick()
      await settle(A, B, server)

      const settings = mkSettings({ newPerDay: 20, reviewsPerDay: 50, newReviewMix: 'newFirst' })
      clock.jump(dayStartAt(0))

      // A 上午只学掉部分额度就收工（会话直接丢弃，剩余 8 个额度未用）
      const session = await buildTodaySession(A.db, settings, clock.now())
      expect(session.counts().new, 'S2 A 建会话时新词额度是满的 20').toBe(20)
      const learnedByA = new Set<number>()
      while (learnedByA.size < 12) {
        const c = session.nextCard(clock.now())
        expect(c.kind, 'S2 A 会话应持续出卡').toBe('card')
        if (c.kind !== 'card') break
        const row = (await getWord(A.db, c.dictId))!
        if (row.state === State.New) learnedByA.add(c.dictId)
        const res = await rate(
          A.db,
          session,
          { dictId: c.dictId, rating: Rating.Good, durationMs: 5000, snapshotReps: row.reps },
          clock.now(),
        )
        expect(res.kind, 'S2 A 评分应成功').toBe('rated')
        clock.tick(STEP_MS)
      }
      expect(learnedByA.size).toBe(12)
      expect((await accounting(A, clock.now())).newCount, 'S2 A 今日新学 12').toBe(12)

      // 双端同步后 B 同日建会话
      clock.tick()
      await settle(A, B, server)
      expect((await accounting(B, clock.now())).newCount, 'S2 额度输入（今日新学数）跨端一致').toBe(12)

      const bSession = await buildTodaySession(B.db, settings, clock.now())
      const counts = bSession.counts()
      expect(counts.new, 'S2 B 的新词额度 = 20 − 12').toBe(8)
      // A 已学的 12 个词 state=1、scheduled_days=0 → 在 B 上回到 intraday 最优先段（不占额度，study.md
      //「当日中途重建会话」同款语义），因此计「学」而**不**出现在新词队列。
      expect(counts.learning, 'S2 A 的 12 张分钟步卡在 B 上回到 intraday（计学、不占额度）').toBe(12)
      expect(counts.review, 'S2 无天级到期复习').toBe(0)

      const served = await drainSession(B, bSession, clock, ALL_GOOD, 'S2 B')
      const firstKind = new Map<number, QueueKind>()
      for (const s of served) if (!firstKind.has(s.dictId)) firstKind.set(s.dictId, s.kind)
      const newServed = [...firstKind].filter(([, k]) => k === 'new').map(([id]) => id)
      expect(newServed.length, 'S2 B 只引入 8 个新词').toBe(8)
      expect(
        newServed.filter((id) => learnedByA.has(id)),
        'S2 A 已学的词不再出现在 B 的新词队列',
      ).toEqual([])
      for (const id of learnedByA) {
        expect(firstKind.get(id), `S2 A 已学词 ${id} 在 B 端首次出卡属「学」（intraday）`).toBe('learning')
      }

      // 回同步 → 两端各自推导「今日新学数」均为 20
      clock.tick()
      await settleAndAssert(A, B, server, 'S2 B 学完剩余额度后')
      expect((await accounting(A, clock.now())).newCount, 'S2 A 推导今日新学 = 20').toBe(20)
      expect((await accounting(B, clock.now())).newCount, 'S2 B 推导今日新学 = 20').toBe(20)
    },
    LONG,
  )

  // ────────────────── S3 会话中途别端变更（study.md 防线实测） ──────────────────

  it('S3 会话中途别端变更：A 不重建会话，出到被改的卡按 reps 快照丢弃、被标熟的卡不可调度，队列照常走完', async () => {
    const X = 101
    const Y = 102
    const Z = 103
    seedDictBoth([A, B], [X, Y, Z])
    const base = dayStartAt(0)
    // 三张天级到期复习卡（分日种，桶序确定，避免同桶随机）
    seedWordRow(A, { dictId: X, state: State.Review, due: base - 2 * DAY, scheduledDays: 5, stability: 9, difficulty: 6, reps: 3, lapses: 0, lastReview: base - 9 * DAY, editTime: clock.tick() })
    seedWordRow(A, { dictId: Y, state: State.Review, due: base - DAY, scheduledDays: 5, stability: 8, difficulty: 6, reps: 4, lapses: 0, lastReview: base - 8 * DAY, editTime: clock.tick() })
    seedWordRow(A, { dictId: Z, state: State.Review, due: base - 1000, scheduledDays: 5, stability: 7, difficulty: 6, reps: 5, lapses: 0, lastReview: base - 7 * DAY, editTime: clock.tick() })
    clock.tick()
    await settle(A, B, server)

    clock.jump(base)
    const settings = mkSettings({ newPerDay: 0, reviewsPerDay: 10, newReviewMix: 'reviewFirst' })
    // A 建会话（队列含 X / Y / Z），并记下建会话时刻的 reps 快照
    const session = await buildTodaySession(A.db, settings, clock.now())
    expect(session.counts(), 'S3 A 会话含三张复习卡').toEqual({ new: 0, learning: 0, review: 3 })
    const snapshot = new Map<number, number>()
    for (const id of [X, Y, Z]) snapshot.set(id, (await getWord(A.db, id))!.reps)

    // B 对 X 评分、对 Y 标熟，并推送
    const bRateAt = clock.tick(5 * MIN)
    const bx = await rate(B.db, null, { dictId: X, rating: Rating.Good, durationMs: 3000, snapshotReps: snapshot.get(X)! }, bRateAt)
    expect(bx.kind).toBe('rated')
    await setMastered(B.db, Y, clock.tick())
    await syncRound(B, server)

    // A pull 落地（**不重建会话**）
    await syncRound(A, server)
    expect((await getWord(A.db, X))!.reps, 'S3 A 已拉到 B 的 X 评分结果').toBe(snapshot.get(X)! + 1)
    expect((await getWord(A.db, Y))!.state, 'S3 A 已拉到 B 的 Y 标熟').toBe(4)

    // A 继续出卡：用建会话时的旧快照评分
    const outcome = new Map<number, string>()
    for (let guard = 0; guard < 20; guard++) {
      const c = session.nextCard(clock.now())
      if (c.kind !== 'card') {
        expect(c.kind, 'S3 会话应正常走到完成态').toBe('done')
        break
      }
      const res = await rate(
        A.db,
        session,
        { dictId: c.dictId, rating: Rating.Good, durationMs: 3000, snapshotReps: snapshot.get(c.dictId)! },
        clock.now(),
      )
      outcome.set(c.dictId, res.kind === 'rated' ? 'rated' : `discarded:${res.reason}`)
      clock.tick(STEP_MS)
    }
    expect(outcome.get(X), 'S3 别端改过 reps 的卡 → 幂等丢弃 stale').toBe('discarded:stale')
    expect(outcome.get(Y), 'S3 别端标熟的卡 → 不可调度丢弃').toBe('discarded:unschedulable')
    expect(outcome.get(Z), 'S3 未受影响的卡照常评分，队列继续前进').toBe('rated')
    // 丢弃 = 不写日志不改行（逐词看：X 只有 B 那一条、Y 一条都没有——标熟不是评分不记日志、Z 是 A 正常评的那条）
    expect(logCountOf(A, X), 'S3 X 被丢弃：A 端没追加日志，只有从 B 拉回的那条').toBe(1)
    expect(logCountOf(A, Y), 'S3 Y 被丢弃：标熟不是评分，全程零日志').toBe(0)
    expect(logCountOf(A, Z), 'S3 Z 正常评分写了一条日志').toBe(1)
    expect((await getWord(A.db, X))!.reps, 'S3 被丢弃的 X 行未被改动').toBe(snapshot.get(X)! + 1)
    expect((await getWord(A.db, Y))!.state, 'S3 被丢弃的 Y 行仍是标熟态').toBe(4)

    clock.tick()
    await settleAndAssert(A, B, server, 'S3')
  })

  // ────────────────── S4 离线双写冲突 ──────────────────

  it('S4 离线双写（editTime 有先后）：词行收敛为后写方版本，日志两端并集零丢失', async () => {
    const Z = 201
    seedDictBoth([A, B], [Z])
    const base = dayStartAt(0)
    seedWordRow(A, { dictId: Z, state: State.Review, due: base - 1000, scheduledDays: 8, stability: 9, difficulty: 5, reps: 3, lapses: 0, lastReview: base - 8 * DAY, editTime: clock.tick() })
    clock.tick()
    await settle(A, B, server)
    const baseReps = (await getWord(A.db, Z))!.reps

    clock.jump(base)
    // 两端各自离线评分：A 先、B 后（editTime 严格递增）
    const tA = clock.tick()
    expect((await rate(A.db, null, { dictId: Z, rating: Rating.Good, durationMs: 4000, snapshotReps: baseReps }, tA)).kind).toBe('rated')
    const tB = clock.tick(3 * MIN)
    expect((await rate(B.db, null, { dictId: Z, rating: Rating.Again, durationMs: 4000, snapshotReps: baseReps }, tB)).kind).toBe('rated')
    const bVersion = (await getWord(B.db, Z))!

    // 先 A 后 B 各自 syncRound
    await syncRound(A, server)
    await syncRound(B, server)
    await syncRound(A, server)

    // 词行：后写赢（B 的版本）
    expect(server.wordOf(Z)!.editTime, 'S4 服务端词行 editTime = 后写方').toBe(tB)
    expect(await getWord(A.db, Z), 'S4 A 收敛到 B 的版本').toEqual(bVersion)
    expect(await getWord(B.db, Z), 'S4 B 保持自己的版本').toEqual(bVersion)
    expect(bVersion.state, 'S4 B 评 Again → Relearning（确实是另一条演化分支）').toBe(State.Relearning)

    // 日志：append-only 并集，零丢失
    expect(logCountOf(A, Z), 'S4 A 端 Z 有 A、B 两条日志').toBe(2)
    expect(logCountOf(B, Z), 'S4 B 端 Z 有 A、B 两条日志').toBe(2)
    const times = (dev: Device): number[] =>
      (dev.sqlite.prepare('SELECT review_time AS t FROM user_review_log WHERE dict_id=? ORDER BY review_time').all(Z) as { t: number }[]).map((r) => r.t)
    expect(times(A)).toEqual([tA, tB])
    expect(times(B)).toEqual([tA, tB])

    // ⚠️ 本场景下「词行 reps == 日志行数」必然不成立（词行只保留一端的演化、日志保留两端）——
    // 这是协议的预期行为，不是 bug；simulation.test.ts 的该不变量只适用于单端无冲突场景。
    expect(bVersion.reps, 'S4 词行只前进一次（协议预期，非 bug）').toBe(baseReps + 1)

    await settleAndAssert(A, B, server, 'S4 先后写')
  })

  it('S4-tie editTime 恰好相等：服务端 >= 覆盖（后推端赢）+ 客户端 tie 远端赢，两端仲裁互补最终一致', async () => {
    const W = 202
    seedDictBoth([A, B], [W])
    const base = dayStartAt(0)
    seedWordRow(A, { dictId: W, state: State.Review, due: base - 1000, scheduledDays: 8, stability: 9, difficulty: 5, reps: 3, lapses: 0, lastReview: base - 8 * DAY, editTime: clock.tick() })
    clock.tick()
    await settle(A, B, server)
    const baseReps = (await getWord(A.db, W))!.reps

    clock.jump(base)
    // 故意构造 editTime tie：A 评分、B 标熟，落在同一毫秒（本文件唯一允许同刻写库之处）。
    // 刻意用「评分 vs 标熟」而非两端都评分——两端同刻评分会撞上日志唯一键 (dictId, reviewTime)，
    // 那是 append-only 的另一条边角，不是本用例要钉的 LWW 仲裁。
    const t = clock.tick()
    expect((await rate(A.db, null, { dictId: W, rating: Rating.Good, durationMs: 4000, snapshotReps: baseReps }, t)).kind).toBe('rated')
    await setMastered(B.db, W, t)

    // 真实网络交错：B 的回合 pull 阶段先于 A 的推送（拉到空页），push 阶段后于 A 的推送。
    await pullLoop(B, server)
    await syncRound(A, server)
    expect(server.wordOf(W)!.editTime, 'S4-tie 服务端先收下 A 的行').toBe(t)
    expect(server.wordOf(W)!.state, 'S4-tie 此刻服务端是 A 的评分版本').not.toBe(4)

    await pushDirty(B, server)
    expect(server.wordOf(W)!.state, 'S4-tie 服务端 >= 语义：等值 editTime 仍被后推端覆盖').toBe(4)
    await pullLoop(B, server) // 收口

    await syncRound(A, server)
    expect((await getWord(A.db, W))!.state, 'S4-tie 客户端 tie 远端赢：A 收敛到 B 的标熟版本').toBe(4)

    await settleAndAssert(A, B, server, 'S4-tie')
    expect(logCountOf(A, W), 'S4-tie 只有 A 的一条评分日志').toBe(1)
  })

  it('S4-rejected 落后端推送被拒：rejected 带回服务端行、同 batch 内先应用后 compare-and-clear，就地收敛', async () => {
    // 走这条路要求「落后端的 pull 阶段早于对端推送、push 阶段晚于对端推送」——否则 pull 就把本地行覆盖了，
    // 根本轮不到 rejected。这也是 rejected 在真实回合里唯一的产生方式（engine.ts 恒 pull 在前）。
    const V = 203
    seedDictBoth([A, B], [V])
    const base = dayStartAt(0)
    seedWordRow(A, { dictId: V, state: State.Review, due: base - 1000, scheduledDays: 8, stability: 9, difficulty: 5, reps: 3, lapses: 0, lastReview: base - 8 * DAY, editTime: clock.tick() })
    clock.tick()
    await settle(A, B, server)
    const baseReps = (await getWord(A.db, V))!.reps

    clock.jump(base)
    const tA = clock.tick()
    expect((await rate(A.db, null, { dictId: V, rating: Rating.Good, durationMs: 4000, snapshotReps: baseReps }, tA)).kind).toBe('rated')
    const tB = clock.tick(3 * MIN)
    expect((await rate(B.db, null, { dictId: V, rating: Rating.Again, durationMs: 4000, snapshotReps: baseReps }, tB)).kind).toBe('rated')
    const bVersion = (await getWord(B.db, V))!

    await pullLoop(A, server) // A 的回合 pull 阶段（此刻服务端还没有 B 的行）
    await syncRound(B, server) // B 抢先推送：服务端词行 = B 的版本（editTime tB）
    expect(server.wordOf(V)!.editTime).toBe(tB)

    const push = await pushDirty(A, server) // A 的 push 阶段：词行 editTime tA < tB → 被拒
    expect(push.rejected, 'S4-rejected A 的落后词行确实被服务端拒回 1 行').toBe(1)
    expect(await getWord(A.db, V), 'S4-rejected rejected 行同 batch 内就地应用 → A 已收敛到服务端版本').toEqual(bVersion)
    expect(dirtyCounts(A), 'S4-rejected 被拒词行的 dirty 由 applyRemote 清掉、日志照常被接受，均不再重推').toEqual({ words: 0, logs: 0 })
    await pullLoop(A, server) // 收口
    // 日志是 append-only，不受词行 LWW 拒绝牵连：两端两条都在
    expect(logCountOf(A, V), 'S4-rejected A 端两条日志（自己的 + 拉回 B 的）').toBe(2)

    await settleAndAssert(A, B, server, 'S4-rejected')
    expect(await getWord(B.db, V), 'S4-rejected B 保持自己的版本').toEqual(bVersion)
  })

  // ────────────────── S5 分页与批次边界 ──────────────────

  it('S5 分页与批次边界：小 limit 多页无漏无重、候选恰好等于 limit 时再翻一页、push 200 行/批全部到达', async () => {
    const LIMIT = 7
    const first = Array.from({ length: 20 }, (_, i) => i + 1)
    await addWords(A.db, first, clock.tick())
    await syncRound(A, server, LIMIT)
    expect(server.wordCount()).toBe(20)

    // (a) 20 行 / limit 7 → 3 页（7+7+6），游标单调推进，无漏行无重复
    const pages = await pullLoop(B, server, LIMIT)
    expect(pages.map((p) => p.words), 'S5 分页行数 7+7+6').toEqual([7, 7, 6])
    expect(pages.map((p) => p.done), 'S5 只有末页 done').toEqual([false, false, true])
    const cursors = pages.map((p) => p.nextSince)
    cursors.slice(1).forEach((v, i) => expect(v, `S5 游标单调推进（${cursors.join('→')}）`).toBeGreaterThan(cursors[i]))
    expect(wordIdsOf(B), 'S5 翻页后 B 拿全 20 行、无漏无重').toEqual(first)
    expect(await getCursor(B.db)).toBe(server.maxVer())

    // (b) 候选数**恰好等于 limit** → done=false，下一页为空页（nextSince=since、done=true）、游标不倒退
    const second = Array.from({ length: LIMIT }, (_, i) => 21 + i)
    await addWords(A.db, second, clock.tick())
    await syncRound(A, server, PULL_LIMIT)
    const cursorBefore = await getCursor(B.db)
    const pages2 = await pullLoop(B, server, LIMIT)
    expect(pages2.length, 'S5 恰好等于 limit 时必须再翻一页').toBe(2)
    expect(pages2[0], 'S5 首页满 limit 且 done=false').toMatchObject({ words: LIMIT, done: false })
    expect(pages2[1], 'S5 次页空页：done=true').toMatchObject({ words: 0, logs: 0, done: true })
    expect(pages2[1].nextSince, 'S5 空页 nextSince=since，游标不倒退').toBe(pages2[0].nextSince)
    expect(await getCursor(B.db)).toBeGreaterThan(cursorBefore)
    expect(wordIdsOf(B)).toEqual([...first, ...second])

    // (c) push 侧 >200 行脏行 → 200/批分块后全部到达服务端
    const bulk = Array.from({ length: 250 }, (_, i) => 100 + i)
    await addWords(A.db, bulk, clock.tick())
    const pushesBefore = server.pushCalls
    await syncRound(A, server, PULL_LIMIT)
    expect(server.pushCalls - pushesBefore, 'S5 250 行脏行 → 200+50 两批').toBe(2)
    expect(server.wordCount(), 'S5 250 行全部到达服务端').toBe(20 + LIMIT + 250)

    await settleAndAssert(A, B, server, 'S5', LIMIT)
  })

  // ────────────────── S6 重放幂等 ──────────────────

  it('S6 重放幂等：同一批 push 载荷原样重发 → 服务端业务内容不变、无 rejected、日志不重复，随后照常收敛', async () => {
    const ids = [301, 302, 303]
    seedDictBoth([A, B], ids)
    await addWords(A.db, ids, clock.tick())
    clock.jump(dayStartAt(0))
    // 造出既有词行变更又有日志的脏批
    const session = await buildTodaySession(A.db, mkSettings({ newPerDay: 3, reviewsPerDay: 0 }), clock.now())
    await drainSession(A, session, clock, ALL_GOOD, 'S6 A')

    // 抓住本回合真正发出去的 wire 载荷（模拟网络重试后客户端原样重推）
    const dirty = await collectAllDirty(A)
    const batches = chunkChanges(dirty, PUSH_BATCH)
    expect(dirty.words.length, 'S6 脏批含词行').toBeGreaterThan(0)
    expect(dirty.reviewLogs.length, 'S6 脏批含日志行').toBeGreaterThan(0)
    clock.tick()
    await syncRound(A, server)

    const before = server.contentSnapshot()
    const logsBefore = server.logCount()
    for (const batch of batches) {
      const res = server.push({ changes: batch })
      expect(res.rejected.words ?? [], 'S6 重放不产生 rejected（>= 等值覆盖）').toEqual([])
      expect(res.skippedInvalid ?? 0).toBe(0)
    }
    expect(server.contentSnapshot(), 'S6 重放后服务端业务内容逐字段不变').toEqual(before)
    expect(server.logCount(), 'S6 日志唯一键去重，行数不变').toBe(logsBefore)

    await settleAndAssert(A, B, server, 'S6 重放后')
  })
})
