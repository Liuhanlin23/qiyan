// 阅读域五集合的双端（三端）同步收敛仿真（sync.md §3 协议真源 + db/05 阅读五表定义真源）：
// 两三个内存库当设备，配一个逐条按 sync.md §3.2/§3.3 语义实现的假服务端，共用一个虚拟钟交错读书、多回合同步，
// 断言「两台设备各自读书、来回同步后真的收敛」——collections.test.ts（单步映射/墓碑）覆盖不到的一层：
// 机械件全对但编排/仲裁/分页接不上时才会在这里炸。
//
// 与上一批 sync/convergence.test.ts 的关系：FakeServer / syncRound / dumpState 基建**复制**过来后扩展
//（不 import 任何 *.test.ts——会连带执行其用例）。扩展点有二：
//   ① 假服务端从 2 个集合（words / reviewLogs）扩到 7 个（+ books / progress / annotations / bookmarks / readingEvents）；
//   ② 补上「首灌跳墓碑」（sync.md §3.2）与**多集合混流分页**——上一批号池全序分页只受过两集合压力。
//
// 已接受的局限（写死在这里免得后人误会）：
//   - 回合编排在本文件内**重实现**（syncRound/pullLoop/pushDirty），因为 SyncEngine 绑死了 db 单例与 api 模块。
//     它验证的是「机械件 + 规格化编排」，SyncEngine 类自身的接线不在本测试范围。
//   - **文件侧不在范围**：engine.ts 拉到 books 墓碑后还会调 purgeRemovedBookFiles 删本机 books/<hash>/ 目录，
//     那是 fs 桥编排（library.ts），本文件只测数据行为，故 pullLoop 里刻意不复刻该收尾。
//   - 时钟校准不在范围（两端共用同一只虚拟钟，客户端侧不做 calibrate）。
//
// 虚拟钟纪律（同上一批）：全局单调、绝不回拨，任何落库写前先前进 ≥1ms——editTime 可区分、
// append-only 自然键 (bookHash, startTime) 不撞（撞了会被静默吞掉，事件账目必错）。
//
// 生产与测试跑同一套数据函数：sqlite-proxy 回调指向进程内 better-sqlite3；本地写一律走生产数据原语
//（addBook / renameBook / removeBook / saveProgress / add·update·removeAnnotation / add·rename·removeBookmark /
//  addReadingEvent / addWords / applyRating），不用裸 SQL 种行。
import Database from 'better-sqlite3'
import { drizzle as betterDrizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as proxyDrizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import type { BatchItem } from 'drizzle-orm/batch'
import { runBatch as execBatch, runStmt as execStmt } from '../../../main/dbExecutor'
import { runBatch, type Db } from '@/db/client'
import { getMeta, setMetaStmt } from '@/db/meta'
import { words as wordsCollection, reviewLogs as reviewLogsCollection } from '@/wordbook/collections'
import { addWords, applyRating } from '@/wordbook/words'
import type { ReviewLogInput, WordRecord } from '@/wordbook/types'
import type {
  AnnotationRow,
  BookRow,
  BookmarkRow,
  ProgressRow,
  ReadingEventRow,
  ReviewLogRow,
  SyncChanges,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  WordRow,
} from '@/sync/protocol'
import * as annotationsData from './annotations'
import * as bookmarksData from './bookmarks'
import * as booksData from './books'
import * as eventsData from './events'
import * as progressData from './progress'
import {
  annotations as annotationsCollection,
  bookmarks as bookmarksCollection,
  books as booksCollection,
  progress as progressCollection,
  readingEvents as readingEventsCollection,
} from './collections'
import type { AnnotationRecord, BookmarkRecord } from './types'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../drizzle', import.meta.url))

/** 与 engine.ts 同值（该文件未导出，此处按 sync.md §3.4 复刻：pull limit clamp[1,500]、push 200 行/批）。 */
const PULL_LIMIT = 500
const PUSH_BATCH = 200
/** 单个 pullLoop 的翻页安全上限。 */
const MAX_PAGES = 200

const MIN = 60_000

/** 第 k 个虚拟天的 10:00（Date 组件构造，与上一批同款基准）。 */
const dayStartAt = (k: number): number => new Date(2026, 1, 10 + k, 10, 0, 0, 0).getTime()

// ══════════════════ 虚拟钟（各端共用，单调前进） ══════════════════

class Clock {
  private t: number
  constructor(start: number) {
    this.t = start
  }
  now(): number {
    return this.t
  }
  /** 前进 ms（默认 1ms）并返回新值：任何落库写前调用，保证 editTime 可区分、事件自然键不撞。 */
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

// ══════════════════ 确定性测试数据（禁用 randomUUID / Math.random） ══════════════════

/** 书身份：32 位小写 hex（服务端形状守卫 `^[0-9a-f]{32}$`，sync.md §3.3）。 */
const bookHash = (n: number): string => n.toString(16).padStart(2, '0').repeat(16)
/** 标注 UUID：计数器构造的 UUID 形状串（服务端守卫要求标准 8-4-4-4-12 形状）。 */
const annId = (n: number): string => `0000a000-0000-4000-8000-${String(n).padStart(12, '0')}`
/** 书签 UUID（与标注错开前缀，两集合键天然不撞）。 */
const bmId = (n: number): string => `0000b000-0000-4000-8000-${String(n).padStart(12, '0')}`

const bookInput = (n: number, title = `书 ${n}`): booksData.BookInput => ({
  bookHash: bookHash(n),
  title,
  author: `作者 ${n}`,
  format: 'epub',
})

const annotationInput = (
  n: number,
  hash: string,
  createdAt: number,
  patch: Partial<AnnotationRecord> = {},
): AnnotationRecord => ({
  id: annId(n),
  bookHash: hash,
  cfi: `epubcfi(/6/${n * 2}!/4/2,/1:0,/1:16)`,
  text: `原文片段 ${n}`,
  color: 'yellow',
  style: 'fill',
  note: '',
  createdAt,
  ...patch,
})

const bookmarkInput = (n: number, hash: string, createdAt: number): BookmarkRecord => ({
  id: bmId(n),
  bookHash: hash,
  cfi: `epubcfi(/6/${n * 2}!/4/2/1:0)`,
  title: `第 ${n} 章`,
  createdAt,
})

/** fraction 一律取二进制可精确表示的值（0.25 / 0.5 / 0.75），排除浮点噪声干扰逐位断言。 */
const FRACTIONS = [0.25, 0.5, 0.75] as const

/** R6 用的词行 / 日志载荷（数值同样取二进制精确值）。 */
const wordRecord = (dictId: number, now: number): WordRecord => ({
  dictId,
  due: now + 86_400_000,
  stability: 2.5,
  difficulty: 5.25,
  scheduledDays: 1,
  learningSteps: 0,
  reps: 1,
  lapses: 0,
  state: 2,
  lastReview: now,
})
const reviewLogInput = (dictId: number, reviewTime: number): ReviewLogInput => ({
  dictId,
  reviewTime,
  rating: 3,
  durationMs: 4000,
  preState: 0,
  preStability: 0,
  preDifficulty: 0,
})

// ══════════════════ 假服务端（逐条对齐 sync.md §3.2 / §3.3） ══════════════════

/** 本仿真涉及的七个集合（notes / settings 不在本批范围）。 */
type CollName =
  | 'words'
  | 'reviewLogs'
  | 'books'
  | 'progress'
  | 'annotations'
  | 'bookmarks'
  | 'readingEvents'

/** 服务端内存行 = wire 行 + 服务端发的号（LWW 行另带 editTime / [isDeleted]）。 */
type AnyRow = { syncVer: number } & Record<string, unknown>

interface CollSpec {
  name: CollName
  kind: 'lww' | 'append'
  /** 有墓碑的 LWW 集合才参与「首灌跳墓碑」（sync.md §3.2）；progress 同 settings 无墓碑。 */
  hasTombstone: boolean
  /** 自然键（sync.md §2 集合注册表）。 */
  keyOf: (r: AnyRow) => string
}

/**
 * sync.md §3.3 的固定处理顺序（去掉本仿真不涉及的 notes / settings）：
 * words → reviewLogs → books → progress → annotations → bookmarks → readingEvents。
 * push 逐集合按此序处理 ⇒ 号池分配顺序确定；pull 的跨集合全序合并也按此表遍历。
 */
const COLLECTIONS: readonly CollSpec[] = [
  { name: 'words', kind: 'lww', hasTombstone: true, keyOf: (r) => `${r.dictId}` },
  {
    name: 'reviewLogs',
    kind: 'append',
    hasTombstone: false,
    keyOf: (r) => `${r.dictId}:${r.reviewTime}`,
  },
  { name: 'books', kind: 'lww', hasTombstone: true, keyOf: (r) => `${r.bookHash}` },
  { name: 'progress', kind: 'lww', hasTombstone: false, keyOf: (r) => `${r.bookHash}` },
  { name: 'annotations', kind: 'lww', hasTombstone: true, keyOf: (r) => `${r.annotationId}` },
  { name: 'bookmarks', kind: 'lww', hasTombstone: true, keyOf: (r) => `${r.bookmarkId}` },
  {
    name: 'readingEvents',
    kind: 'append',
    hasTombstone: false,
    keyOf: (r) => `${r.bookHash}:${r.startTime}`,
  },
]

type RowBag = Record<CollName, AnyRow[] | undefined>
/** 取 changes 里某集合的数组（缺则建）——七集合异构行，内部统一按 AnyRow 搬运。 */
const bucketOf = (c: SyncChanges, name: CollName): AnyRow[] => {
  const bag = c as unknown as RowBag
  return (bag[name] ??= [])
}
const rowsOf = (c: SyncChanges, name: CollName): AnyRow[] => (c as unknown as RowBag)[name] ?? []
const totalRows = (c: SyncChanges): number =>
  COLLECTIONS.reduce((n, spec) => n + rowsOf(c, spec.name).length, 0)
/** 深拷一份 wire 载荷（重放幂等用：重发的必须是当时那批字节，不能是同一批对象引用）。 */
const clonePayload = (c: SyncChanges): SyncChanges => {
  const out: SyncChanges = {}
  for (const spec of COLLECTIONS) {
    const rows = rowsOf(c, spec.name)
    if (rows.length > 0) bucketOf(out, spec.name).push(...rows.map((r) => ({ ...r })))
  }
  return out
}

/** 服务端业务内容快照（不含 syncVer）：重放幂等断言用——`>=` 覆盖会重新发号，内容才是不变量。 */
type ContentSnapshot = Record<CollName, Omit<AnyRow, 'syncVer'>[]>

/**
 * 内存假服务端：七集合共享同一单调号池（从 1 起、全序无并列）。
 * 上行行的 syncVer 一律忽略（客户端恒送 0），下发行必带服务端发的号。
 * 本仿真只产合法行，`skippedInvalid` 恒 0（形状守卫不在本批范围）。
 */
class FakeServer {
  private readonly store = new Map<CollName, Map<string, AnyRow>>()
  private nextVer = 1
  pushCalls = 0
  pullCalls = 0
  /** 每次 push 的 wire 载荷留档（R5 重放幂等用）。 */
  readonly pushLog: SyncChanges[] = []

  constructor(private readonly clock: Clock) {
    for (const spec of COLLECTIONS) this.store.set(spec.name, new Map())
  }

  private mapOf(name: CollName): Map<string, AnyRow> {
    return this.store.get(name)!
  }
  count(name: CollName): number {
    return this.mapOf(name).size
  }
  rowOf(name: CollName, key: string): AnyRow | undefined {
    const r = this.mapOf(name).get(key)
    return r ? { ...r } : undefined
  }
  maxVer(): number {
    return this.nextVer - 1
  }

  contentSnapshot(): ContentSnapshot {
    const out = {} as ContentSnapshot
    for (const spec of COLLECTIONS) {
      out[spec.name] = [...this.mapOf(spec.name).entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, r]) => {
          const { syncVer: _drop, ...rest } = r
          return rest
        })
    }
    return out
  }

  /**
   * push（sync.md §3.3）：单事务、按 COLLECTIONS 固定顺序逐行处理。
   * - **LWW 行**：按自然键查现有行——无行 insert 发号；`remote.editTime >= existing.editTime` 整行覆盖发号
   *   （**>= 语义**：等值也覆盖，重放友好）；严格更小 → 进 `rejected` 并带回服务端当前行（含其 syncVer），
   *   供客户端就地收敛。墓碑行照 LWW 常规走（删除也是一次 LWW 写，服务端零特殊逻辑，见 db/05）。
   * - **append-only 行**：按唯一键幂等插入；命中唯一键 = 重复推送，幂等静默成功、不发新号、不进 rejected。
   */
  push(req: SyncPushRequest): SyncPushResponse {
    this.pushCalls++
    this.pushLog.push(clonePayload(req.changes))
    const rejected: SyncChanges = {}
    let maxAssignedVer = 0
    for (const spec of COLLECTIONS) {
      const store = this.mapOf(spec.name)
      for (const row of rowsOf(req.changes, spec.name)) {
        const key = spec.keyOf(row)
        const existing = store.get(key)
        if (spec.kind === 'append') {
          if (existing) continue // 唯一键命中 = 重复推送，幂等静默成功、不获新号
          const syncVer = this.nextVer++
          maxAssignedVer = Math.max(maxAssignedVer, syncVer)
          store.set(key, { ...row, syncVer })
          continue
        }
        if (existing && (row.editTime as number) < (existing.editTime as number)) {
          bucketOf(rejected, spec.name).push({ ...existing }) // 服务端赢：带回当前行
          continue
        }
        const syncVer = this.nextVer++
        maxAssignedVer = Math.max(maxAssignedVer, syncVer)
        store.set(key, { ...row, syncVer })
      }
    }
    return { maxAssignedVer, rejected, skippedInvalid: 0, serverTimeMs: this.clock.now() }
  }

  /**
   * pull（sync.md §3.2）：七集合各查 `syncVer > since ORDER BY syncVer LIMIT limit`，
   * 内存按 syncVer 全序合并后取前 `limit` 行按集合装回 changes；`nextSince` = 本页纳入的最大 syncVer；
   * **`done` = 合并候选总数 < limit（严格小于——任一集合恰好被自身 LIMIT 截断时总数 = limit，必须再翻页）**；
   * 空页 `nextSince = since`、`done = true`。limit clamp [1,500]。
   *
   * **首灌跳墓碑**：`since = 0` 时有墓碑的 LWW 集合（words / books / annotations / bookmarks）
   * 只下发 `is_deleted = 0` 的行（新库不需要死行）；progress / reviewLogs / readingEvents 无墓碑概念不受影响。
   * **仅 since=0 生效**——老游标照常收到墓碑（R7 对照组即此）。过滤发生在各集合自身 LIMIT **之前**（同 server SQL 的 WHERE）。
   */
  pull(req: SyncPullRequest): SyncPullResponse {
    this.pullCalls++
    const limit = Math.min(500, Math.max(1, Math.trunc(req.limit)))
    const since = req.since
    const candidates: { name: CollName; row: AnyRow }[] = []
    for (const spec of COLLECTIONS) {
      const rows = [...this.mapOf(spec.name).values()]
        .filter((r) => r.syncVer > since)
        .filter((r) => !(since === 0 && spec.hasTombstone && r.isDeleted === 1))
        .sort((a, b) => a.syncVer - b.syncVer)
        .slice(0, limit)
      for (const row of rows) candidates.push({ name: spec.name, row })
    }
    const done = candidates.length < limit // 严格小于：恰好等于 limit 时必须再翻一页
    const page = candidates.sort((a, b) => a.row.syncVer - b.row.syncVer).slice(0, limit)
    const changes: SyncChanges = {}
    for (const { name, row } of page) bucketOf(changes, name).push({ ...row })
    const nextSince = page.length > 0 ? page[page.length - 1].row.syncVer : since
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

/**
 * pull 一页的应用语句，顺序对齐 engine.ts（words → notes → settings → reviewLogs → books → progress →
 * annotations → bookmarks → readingEvents，本仿真去掉 notes / settings 两件）。`?? []` 是必要防御：
 * server 可能省略空集合的 key（sync.md §3.1）。
 */
function applyStmts(db: Db, c: SyncChanges): BatchItem<'sqlite'>[] {
  return [
    ...(c.words ?? []).map((r) => wordsCollection.applyRemoteStmt(db, r)),
    ...(c.reviewLogs ?? []).map((r) => reviewLogsCollection.applyRemoteStmt(db, r)),
    ...(c.books ?? []).map((r) => booksCollection.applyRemoteStmt(db, r)),
    ...(c.progress ?? []).map((r) => progressCollection.applyRemoteStmt(db, r)),
    ...(c.annotations ?? []).map((r) => annotationsCollection.applyRemoteStmt(db, r)),
    ...(c.bookmarks ?? []).map((r) => bookmarksCollection.applyRemoteStmt(db, r)),
    ...(c.readingEvents ?? []).map((r) => readingEventsCollection.applyRemoteStmt(db, r)),
  ]
}

interface PullPage {
  since: number
  nextSince: number
  done: boolean
  /** 本页各集合行数（多集合混流分页断言用）。 */
  counts: Record<CollName, number>
  total: number
  changes: SyncChanges
}

/**
 * pullLoop：循环 pull → 一页所有集合的应用语句 + 游标推进**合入同一 runBatch 原子提交**→ `done` 为止。
 * 刻意不复刻 engine.ts 的 purgeRemovedBookFiles 收尾（文件侧不在本批范围，见文件头）。
 */
async function pullLoop(dev: Device, server: FakeServer, limit = PULL_LIMIT): Promise<PullPage[]> {
  const pages: PullPage[] = []
  for (let guard = 0; ; guard++) {
    if (guard > MAX_PAGES) throw new Error(`${dev.name} pullLoop 翻页超上限（疑似 done 永不为真）`)
    const since = await getCursor(dev.db)
    const res = server.pull({ since, limit })
    await runBatch(dev.db, [...applyStmts(dev.db, res.changes), setCursorStmt(dev.db, res.nextSince)])
    const counts = {} as Record<CollName, number>
    for (const spec of COLLECTIONS) counts[spec.name] = rowsOf(res.changes, spec.name).length
    pages.push({
      since,
      nextSince: res.nextSince,
      done: res.done,
      counts,
      total: totalRows(res.changes),
      changes: res.changes,
    })
    if (res.done) break
  }
  return pages
}

interface DirtySet {
  words: WordRow[]
  reviewLogs: ReviewLogRow[]
  books: BookRow[]
  progress: ProgressRow[]
  annotations: AnnotationRow[]
  bookmarks: BookmarkRow[]
  readingEvents: ReadingEventRow[]
}

/** 收集七集合脏行（固定顺序，形态 A′，同 engine.ts collectAllDirty）。 */
async function collectAllDirty(dev: Device): Promise<DirtySet> {
  return {
    words: await wordsCollection.collectDirty(dev.db),
    reviewLogs: await reviewLogsCollection.collectDirty(dev.db),
    books: await booksCollection.collectDirty(dev.db),
    progress: await progressCollection.collectDirty(dev.db),
    annotations: await annotationsCollection.collectDirty(dev.db),
    bookmarks: await bookmarksCollection.collectDirty(dev.db),
    readingEvents: await readingEventsCollection.collectDirty(dev.db),
  }
}

/** 把七集合脏行扁平化后按 size 切块，再按集合装回 SyncChanges（同 engine.ts chunkChanges）。 */
function chunkChanges(all: DirtySet, size: number): SyncChanges[] {
  type Tagged = { k: CollName; row: AnyRow }
  const tag = (k: CollName, rows: readonly unknown[]): Tagged[] =>
    rows.map((row) => ({ k, row: row as AnyRow }))
  const tagged: Tagged[] = [
    ...tag('words', all.words),
    ...tag('reviewLogs', all.reviewLogs),
    ...tag('books', all.books),
    ...tag('progress', all.progress),
    ...tag('annotations', all.annotations),
    ...tag('bookmarks', all.bookmarks),
    ...tag('readingEvents', all.readingEvents),
  ]
  const batches: SyncChanges[] = []
  for (let i = 0; i < tagged.length; i += size) {
    const b: SyncChanges = {}
    for (const { k, row } of tagged.slice(i, i + size)) bucketOf(b, k).push(row)
    batches.push(b)
  }
  return batches
}

/**
 * push 回执对账（sync.md §3.4，顺序照抄 engine.ts reconcileStmts）：每集合**先应用 rejected**
 *（服务端赢、清 dirty），**再对推送批做 compare-and-clear**（被 rejected 覆盖的行快照已不匹配 → 自然跳过）。
 * reviewLogs / readingEvents 是 append-only，无 rejected（幂等静默成功），只清 dirty。
 */
function reconcileStmts(db: Db, pushed: SyncChanges, rejected: SyncChanges): BatchItem<'sqlite'>[] {
  const stmts: BatchItem<'sqlite'>[] = []
  for (const r of rejected.words ?? []) stmts.push(wordsCollection.applyRemoteStmt(db, r))
  stmts.push(...wordsCollection.clearAcceptedStmts(db, pushed.words ?? []))
  stmts.push(...reviewLogsCollection.clearAcceptedStmts(db, pushed.reviewLogs ?? []))
  for (const r of rejected.books ?? []) stmts.push(booksCollection.applyRemoteStmt(db, r))
  stmts.push(...booksCollection.clearAcceptedStmts(db, pushed.books ?? []))
  for (const r of rejected.progress ?? []) stmts.push(progressCollection.applyRemoteStmt(db, r))
  stmts.push(...progressCollection.clearAcceptedStmts(db, pushed.progress ?? []))
  for (const r of rejected.annotations ?? []) stmts.push(annotationsCollection.applyRemoteStmt(db, r))
  stmts.push(...annotationsCollection.clearAcceptedStmts(db, pushed.annotations ?? []))
  for (const r of rejected.bookmarks ?? []) stmts.push(bookmarksCollection.applyRemoteStmt(db, r))
  stmts.push(...bookmarksCollection.clearAcceptedStmts(db, pushed.bookmarks ?? []))
  stmts.push(...readingEventsCollection.clearAcceptedStmts(db, pushed.readingEvents ?? []))
  return stmts
}

/** pushDirty：收脏 → 200 行/批切块推送 → 每批 reconcile 合入同一 batch。返回是否有过写入。 */
async function pushDirty(dev: Device, server: FakeServer): Promise<number> {
  const dirty = await collectAllDirty(dev)
  const batches = chunkChanges(dirty, PUSH_BATCH)
  let sent = 0
  for (const batch of batches) {
    const res = server.push({ changes: batch })
    await runBatch(dev.db, reconcileStmts(dev.db, batch, res.rejected ?? {}))
    sent += totalRows(batch)
  }
  return sent
}

interface RoundStats {
  pulls: PullPage[]
  pushedRows: number
}

/** 一回合 = pullLoop → pushDirty →（有推送则）收口 pullLoop（把自己刚发号的行拉回，幂等无害）。 */
async function syncRound(dev: Device, server: FakeServer, limit = PULL_LIMIT): Promise<RoundStats> {
  const pulls = await pullLoop(dev, server, limit)
  const pushedRows = await pushDirty(dev, server)
  if (pushedRows > 0) pulls.push(...(await pullLoop(dev, server, limit)))
  return { pulls, pushedRows }
}

// ══════════════════ 全库读 / 收敛静止断言（测试内可裸 SQL） ══════════════════

/**
 * 全库业务态快照（业务列 + isDeleted，**排除 dirty 列**——dirty 是本地私有态，收敛静止后另行断言为 0）。
 * 浮点逐位比较：两端同源、行原样搬运，必须逐位一致，不一致就是发现，不许 toBeCloseTo 弱化。
 *
 * ⚠️ 墓碑行在客户端**不存在**（LWW 墓碑应用 = 物理删本地行，服务端才留墓碑行）：
 * 「墓碑传播成功」的断言是行**消失**，不是 is_deleted=1。
 */
function dumpState(dev: Device) {
  const q = <T>(sql: string): T[] => dev.sqlite.prepare(sql).all() as T[]
  return {
    words: q(
      `SELECT dict_id AS dictId, due, stability, difficulty, scheduled_days AS scheduledDays,
              learning_steps AS learningSteps, reps, lapses, state, last_review AS lastReview,
              join_time AS joinTime, edit_time AS editTime, is_deleted AS isDeleted
       FROM user_word ORDER BY dict_id`,
    ),
    reviewLogs: q(
      `SELECT dict_id AS dictId, review_time AS reviewTime, rating, duration_ms AS durationMs,
              pre_state AS preState, pre_stability AS preStability, pre_difficulty AS preDifficulty
       FROM user_review_log ORDER BY dict_id, review_time`,
    ),
    books: q(
      `SELECT book_hash AS bookHash, title, author, format, imported_at AS importedAt,
              edit_time AS editTime, is_deleted AS isDeleted
       FROM user_book ORDER BY book_hash`,
    ),
    progress: q(
      `SELECT book_hash AS bookHash, location, fraction, last_read_at AS lastReadAt, edit_time AS editTime
       FROM user_book_progress ORDER BY book_hash`,
    ),
    annotations: q(
      `SELECT annotation_id AS annotationId, book_hash AS bookHash, cfi, text, color, style, note,
              created_at AS createdAt, edit_time AS editTime, is_deleted AS isDeleted
       FROM user_book_annotation ORDER BY annotation_id`,
    ),
    bookmarks: q(
      `SELECT bookmark_id AS bookmarkId, book_hash AS bookHash, cfi, title,
              created_at AS createdAt, edit_time AS editTime, is_deleted AS isDeleted
       FROM user_book_bookmark ORDER BY bookmark_id`,
    ),
    readingEvents: q(
      `SELECT book_hash AS bookHash, start_time AS startTime, duration_ms AS durationMs, fraction
       FROM user_reading_event ORDER BY book_hash, start_time`,
    ),
  }
}

const TABLES: Record<CollName, string> = {
  words: 'user_word',
  reviewLogs: 'user_review_log',
  books: 'user_book',
  progress: 'user_book_progress',
  annotations: 'user_book_annotation',
  bookmarks: 'user_book_bookmark',
  readingEvents: 'user_reading_event',
}

const countOne = (dev: Device, sql: string): number =>
  (dev.sqlite.prepare(sql).get() as { n: number }).n

const rowCount = (dev: Device, name: CollName): number =>
  countOne(dev, `SELECT count(*) AS n FROM ${TABLES[name]}`)

/** 各表行数（逐表断言「阅读数据不连带删」用）。 */
const rowCounts = (dev: Device): Record<CollName, number> => {
  const out = {} as Record<CollName, number>
  for (const spec of COLLECTIONS) out[spec.name] = rowCount(dev, spec.name)
  return out
}

/** 七表脏行合计。 */
const totalDirty = (dev: Device): number =>
  COLLECTIONS.reduce(
    (n, spec) => n + countOne(dev, `SELECT count(*) AS n FROM ${TABLES[spec.name]} WHERE dirty=1`),
    0,
  )

/** 交替跑回合直到静止（各端均无脏行且游标一致）。 */
async function settle(devs: Device[], server: FakeServer, limit = PULL_LIMIT): Promise<number> {
  for (let i = 1; i <= 4; i++) {
    for (const dev of devs) await syncRound(dev, server, limit)
    if (devs.every((d) => totalDirty(d) === 0)) {
      const cursors: number[] = []
      for (const d of devs) cursors.push(await getCursor(d.db))
      if (new Set(cursors).size === 1) return i
    }
  }
  throw new Error('4 个来回后仍未收敛静止')
}

/**
 * 收敛静止 + 全套断言：各端全库深等（七表业务列逐位）、各端 dirty 计数 0、游标一致、
 * append-only 两表行数 = 服务端行数（并集零丢失的全局账）。
 */
async function settleAndAssert(
  devs: Device[],
  server: FakeServer,
  label: string,
  limit = PULL_LIMIT,
): Promise<void> {
  await settle(devs, server, limit)
  const base = dumpState(devs[0])
  for (const dev of devs) {
    expect(totalDirty(dev), `${label} ${dev.name} 端收敛后无脏行`).toBe(0)
    expect(dumpState(dev), `${label} ${dev.name} 与 ${devs[0].name} 全库深等（浮点逐位）`).toEqual(base)
  }
  const cursors: number[] = []
  for (const d of devs) cursors.push(await getCursor(d.db))
  expect(new Set(cursors).size, `${label} 各端游标一致（${cursors.join('/')}）`).toBe(1)
  expect(base.readingEvents.length, `${label} 阅读事件行数 = 服务端（并集零丢失）`).toBe(
    server.count('readingEvents'),
  )
  expect(base.reviewLogs.length, `${label} 复习日志行数 = 服务端（并集零丢失）`).toBe(
    server.count('reviewLogs'),
  )
}

// ══════════════════ 场景 ══════════════════

describe('阅读域五集合双端同步收敛仿真（sync.md §3 + db/05）', () => {
  let A: Device
  let B: Device
  let server: FakeServer
  let clock: Clock

  beforeEach(() => {
    clock = new Clock(dayStartAt(0))
    A = makeDevice('A')
    B = makeDevice('B')
    server = new FakeServer(clock)
  })

  // ────────────────── R1 书架接力（基线） ──────────────────

  it('R1 书架接力：A 加书+进度+读段 → B 空库首灌收敛 → B 改名/续读/加标注回推 → A 拉回再收敛', async () => {
    // A 加 3 本书 + 各存进度 + 各读一段
    for (let i = 1; i <= 3; i++) await booksData.addBook(A.db, bookInput(i), clock.tick())
    for (let i = 1; i <= 3; i++) {
      await progressData.saveProgress(
        A.db,
        { bookHash: bookHash(i), location: `epubcfi(/6/${i * 2}!/4/2)`, fraction: FRACTIONS[0] },
        clock.tick(),
      )
    }
    for (let i = 1; i <= 3; i++) {
      await eventsData.addReadingEvent(A.db, {
        bookHash: bookHash(i),
        startTime: clock.tick(MIN),
        durationMs: 60_000,
        fraction: FRACTIONS[0],
      })
    }
    await syncRound(A, server)
    expect(totalDirty(A), 'R1 A 收工后脏行已推完').toBe(0)

    // B 空库首灌
    expect(rowCounts(B).books, 'R1 B 首灌前是空库').toBe(0)
    await syncRound(B, server)
    const shelf = await booksData.listBooks(B.db)
    expect(shelf.map((b) => b.bookHash).sort(), 'R1 B 首灌拿到 3 本书').toEqual(
      [1, 2, 3].map(bookHash).sort(),
    )
    expect(shelf.find((b) => b.bookHash === bookHash(2))?.title, 'R1 书名随行到达').toBe('书 2')
    expect(await progressData.getProgress(B.db, bookHash(1)), 'R1 进度逐字段到达').toEqual(
      await progressData.getProgress(A.db, bookHash(1)),
    )
    expect(rowCount(B, 'readingEvents'), 'R1 三段阅读事件全部到达').toBe(3)
    await settleAndAssert([A, B], server, 'R1 首灌后')

    // B 改书名、续读进度、加标注 + 书签 → 回推
    await booksData.renameBook(B.db, bookHash(1), '书 1（B 改名）', clock.tick())
    await progressData.saveProgress(
      B.db,
      { bookHash: bookHash(2), location: 'epubcfi(/6/4!/4/8)', fraction: FRACTIONS[1] },
      clock.tick(),
    )
    await annotationsData.addAnnotation(
      B.db,
      annotationInput(1, bookHash(2), clock.now()),
      clock.tick(),
    )
    await bookmarksData.addBookmark(B.db, bookmarkInput(1, bookHash(2), clock.now()), clock.tick())
    await settleAndAssert([A, B], server, 'R1 B 回推后')

    // A 拉回后逐条读得出来
    expect((await booksData.getBook(A.db, bookHash(1)))?.title, 'R1 A 拉回改名').toBe('书 1（B 改名）')
    expect((await progressData.getProgress(A.db, bookHash(2)))?.fraction, 'R1 A 拉回续读进度').toBe(
      FRACTIONS[1],
    )
    expect(await annotationsData.listAnnotations(A.db, bookHash(2)), 'R1 A 拉回标注').toHaveLength(1)
    expect(await bookmarksData.listBookmarks(A.db, bookHash(2)), 'R1 A 拉回书签').toHaveLength(1)
  })

  // ────────────────── R2 删书墓碑的精确边界（db/05 核心拍板） ──────────────────

  it('R2 删书墓碑边界：user_book 行物理删，progress/annotations/bookmarks/events 全部原样保留；重导入即复活', async () => {
    const X = bookHash(1)
    const Z = bookHash(2)
    // A 建两本书的全套数据（删 X 时 Z 作对照，证明只删该书的书行）
    await booksData.addBook(A.db, bookInput(1, '白鲸'), clock.tick())
    await booksData.addBook(A.db, bookInput(2, 'моби'), clock.tick())
    for (const [i, h] of [X, Z].entries()) {
      await progressData.saveProgress(
        A.db,
        { bookHash: h, location: `epubcfi(/6/${i + 2}!/4/2)`, fraction: FRACTIONS[i] },
        clock.tick(),
      )
    }
    await annotationsData.addAnnotation(A.db, annotationInput(1, X, clock.now()), clock.tick())
    await bookmarksData.addBookmark(A.db, bookmarkInput(1, X, clock.now()), clock.tick())
    for (let i = 0; i < 2; i++) {
      await eventsData.addReadingEvent(A.db, {
        bookHash: X,
        startTime: clock.tick(MIN),
        durationMs: 45_000,
        fraction: FRACTIONS[0],
      })
    }
    await settleAndAssert([A, B], server, 'R2 建账后')
    const before = rowCounts(A)
    const progressBefore = await progressData.getProgress(A.db, X)
    const annotationsBefore = await annotationsData.listAnnotations(A.db, X)
    const bookmarksBefore = await bookmarksData.listBookmarks(A.db, X)

    // B 删书 → 墓碑传播到 A
    await booksData.removeBook(B.db, X, clock.tick())
    await settleAndAssert([A, B], server, 'R2 删书后')

    // ① user_book 的 X 行**物理删**（客户端墓碑应用不留死行）
    expect(await booksData.getBook(A.db, X), 'R2 A 端 X 书行消失（不是 is_deleted=1 的死行）').toBeNull()
    expect(rowCount(A, 'books'), 'R2 A 端只剩对照书 Z 一行').toBe(1)
    expect(
      countOne(A, 'SELECT count(*) AS n FROM user_book WHERE is_deleted=1'),
      'R2 客户端不留墓碑死行',
    ).toBe(0)
    expect((await booksData.getBook(A.db, Z))?.title, 'R2 对照书 Z 不受影响').toBe('моби')

    // ② 阅读数据**一律不连带删**（逐表断言行数不变）
    expect(rowCounts(A), 'R2 除 books 外逐表行数不变（阅读数据不连带删，db/05）').toEqual({
      ...before,
      books: before.books - 1,
    })
    expect(await progressData.getProgress(A.db, X), 'R2 X 的进度行原样保留').toEqual(progressBefore)
    expect(await annotationsData.listAnnotations(A.db, X), 'R2 X 的标注原样保留').toEqual(
      annotationsBefore,
    )
    expect(await bookmarksData.listBookmarks(A.db, X), 'R2 X 的书签原样保留').toEqual(bookmarksBefore)

    // ③ A 重导入同一本书（同 hash）→ 书行复活、旧阅读数据立刻拿回
    //    本地墓碑已被物理删，故「复活」实际是普通 insert + 新 editTime、新 importedAt（books.ts 已注明该边界）。
    await booksData.addBook(A.db, bookInput(1, '白鲸'), clock.tick())
    const revived = await booksData.getBook(A.db, X)
    expect(revived?.isDeleted, 'R2 复活后是活行').toBe(0)
    expect(await progressData.getProgress(A.db, X), 'R2 复活即拿回旧进度').toEqual(progressBefore)
    expect(await annotationsData.listAnnotations(A.db, X), 'R2 复活即拿回旧标注').toEqual(
      annotationsBefore,
    )
    expect(await bookmarksData.listBookmarks(A.db, X), 'R2 复活即拿回旧书签').toEqual(bookmarksBefore)

    // ④ 复活写 editTime 更新 → LWW 赢过服务端墓碑 → B 端书行同样复活
    await settleAndAssert([A, B], server, 'R2 复活后')
    expect((await booksData.getBook(B.db, X))?.isDeleted, 'R2 B 端书行同样复活').toBe(0)
    expect((await booksData.listBooks(B.db)).map((b) => b.bookHash).sort(), 'R2 B 书架两本都在').toEqual(
      [X, Z].sort(),
    )
    expect(server.rowOf('books', X)?.isDeleted, 'R2 服务端墓碑被复活写覆盖').toBe(0)
  })

  // ────────────────── R3 进度交错（无墓碑 LWW） ──────────────────

  it('R3 进度交错：后写方赢（整行），往返两轮验证仲裁方向不粘滞', async () => {
    const H = bookHash(1)
    await booksData.addBook(A.db, bookInput(1), clock.tick())
    await settleAndAssert([A, B], server, 'R3 建书后')

    // 双端离线各记一次进度：A 早（0.25）、B 晚（0.5）
    const tA = clock.tick()
    await progressData.saveProgress(
      A.db,
      { bookHash: H, location: 'epubcfi(/6/2!/4/2)', fraction: FRACTIONS[0] },
      tA,
    )
    const tB = clock.tick(5 * MIN)
    await progressData.saveProgress(
      B.db,
      { bookHash: H, location: 'epubcfi(/6/6!/4/10)', fraction: FRACTIONS[1] },
      tB,
    )
    const bVersion = await progressData.getProgress(B.db, H)
    // 前置守卫：同步前 A 本地确实是自己的 0.25，否则「收敛为 B 版本」会变成空转
    expect((await progressData.getProgress(A.db, H))?.fraction, 'R3 同步前 A 本地是 0.25').toBe(
      FRACTIONS[0],
    )
    await settleAndAssert([A, B], server, 'R3 第一轮交错后')

    expect(bVersion, 'R3 B 版本整行（location/fraction/lastReadAt）').toEqual({
      bookHash: H,
      location: 'epubcfi(/6/6!/4/10)',
      fraction: FRACTIONS[1],
      lastReadAt: tB,
    })
    expect(await progressData.getProgress(A.db, H), 'R3 A 收敛为 B 版本（后写赢，整行覆盖）').toEqual(
      bVersion,
    )
    expect(await progressData.getProgress(B.db, H), 'R3 B 保持自己的版本').toEqual(bVersion)
    expect(server.rowOf('progress', H)?.editTime, 'R3 服务端进度行 editTime = 后写方').toBe(tB)

    // 反向再来一轮：A 后写 0.75 → 仲裁方向不粘滞
    const tA2 = clock.tick(5 * MIN)
    await progressData.saveProgress(
      A.db,
      { bookHash: H, location: 'epubcfi(/6/8!/4/4)', fraction: FRACTIONS[2] },
      tA2,
    )
    const aVersion = await progressData.getProgress(A.db, H)
    await settleAndAssert([A, B], server, 'R3 第二轮交错后')
    expect(aVersion, 'R3 A 版本整行').toEqual({
      bookHash: H,
      location: 'epubcfi(/6/8!/4/4)',
      fraction: FRACTIONS[2],
      lastReadAt: tA2,
    })
    expect(await progressData.getProgress(B.db, H), 'R3 B 收敛为 A 版本（方向反转，无粘滞）').toEqual(
      aVersion,
    )
  })

  // ────────────────── R4 标注独立键与整行覆盖 ──────────────────

  it('R4 标注：独立 UUID 天然并集；同条双端编辑 → LWW 整行覆盖（字段级修改丢失是协议预期）；删除 → 行消失', async () => {
    const H = bookHash(1)
    await booksData.addBook(A.db, bookInput(1), clock.tick())
    await settleAndAssert([A, B], server, 'R4 建书后')

    // ① 双端离线各创建一条标注（UUID 不同）→ 收敛后两端持有并集
    const createdAt1 = clock.now()
    await annotationsData.addAnnotation(A.db, annotationInput(1, H, createdAt1), clock.tick())
    await annotationsData.addAnnotation(B.db, annotationInput(2, H, clock.now()), clock.tick())
    await settleAndAssert([A, B], server, 'R4 并集后')
    expect(
      (await annotationsData.listAnnotations(A.db, H)).map((a) => a.id),
      'R4 键天然不冲突 → 两端并集',
    ).toEqual([annId(1), annId(2)])

    // ② 同一条标注双端离线编辑：A 先改 color、B 后改 note
    const tA = clock.tick()
    await annotationsData.updateAnnotation(A.db, annId(1), { color: 'green' }, tA)
    const tB = clock.tick(5 * MIN)
    await annotationsData.updateAnnotation(B.db, annId(1), { note: 'B 写的笔记' }, tB)
    // 前置守卫：确认「改色」在 A 本地真的落库了，否则下面「改色丢失」的断言会变成空转
    expect(
      (await annotationsData.listAnnotations(A.db, H)).find((a) => a.id === annId(1))?.color,
      'R4 同步前 A 本地确实是 green',
    ).toBe('green')
    await settleAndAssert([A, B], server, 'R4 同条双改后')

    const converged = (await annotationsData.listAnnotations(A.db, H)).find((a) => a.id === annId(1))!
    expect(converged.note, 'R4 收敛为 B 整行：note 是 B 写的').toBe('B 写的笔记')
    // ⚠️ A 的改色丢失是 **LWW 整行覆盖的协议预期**（无字段级 merge，sync.md §1）——断言它，不是 bug。
    expect(converged.color, 'R4 A 的改色被 B 整行覆盖冲掉（协议预期，非 bug）').toBe('yellow')
    expect(converged.createdAt, 'R4 createdAt 编辑不刷新，随行整覆盖').toBe(createdAt1)

    // ③ B 删标注 → 墓碑传播 → A 端行**物理删**
    await annotationsData.removeAnnotation(B.db, annId(1), clock.tick())
    await settleAndAssert([A, B], server, 'R4 删标注后')
    expect(rowCount(A, 'annotations'), 'R4 A 端墓碑应用 = 物理删（不留死行）').toBe(1)
    expect(
      (await annotationsData.listAnnotations(A.db, H)).map((a) => a.id),
      'R4 只剩另一条标注',
    ).toEqual([annId(2)])
    expect(server.rowOf('annotations', annId(1))?.isDeleted, 'R4 服务端保留墓碑行').toBe(1)
  })

  it('R4-bm 书签同构缩减版：双端改名后写赢、删除墓碑传播后本地行消失', async () => {
    const H = bookHash(1)
    await booksData.addBook(A.db, bookInput(1), clock.tick())
    await bookmarksData.addBookmark(A.db, bookmarkInput(1, H, clock.now()), clock.tick())
    await settleAndAssert([A, B], server, 'R4-bm 建书签后')

    const tA = clock.tick()
    await bookmarksData.renameBookmark(A.db, bmId(1), 'A 改的标题', tA)
    const tB = clock.tick(5 * MIN)
    await bookmarksData.renameBookmark(B.db, bmId(1), 'B 改的标题', tB)
    expect(
      (await bookmarksData.listBookmarks(A.db, H))[0].title,
      'R4-bm 同步前 A 本地是自己改的标题',
    ).toBe('A 改的标题')
    await settleAndAssert([A, B], server, 'R4-bm 双端改名后')
    expect((await bookmarksData.listBookmarks(A.db, H))[0].title, 'R4-bm 后写方赢').toBe('B 改的标题')

    await bookmarksData.removeBookmark(B.db, bmId(1), clock.tick())
    await settleAndAssert([A, B], server, 'R4-bm 删书签后')
    expect(rowCount(A, 'bookmarks'), 'R4-bm A 端书签行物理删').toBe(0)
    expect(server.rowOf('bookmarks', bmId(1))?.isDeleted, 'R4-bm 服务端保留墓碑行').toBe(1)
  })

  // ────────────────── R5 阅读事件并集（统计账） ──────────────────

  it('R5 阅读事件：两端片段并集零丢失、行数 = 服务端；同一批 push 载荷重发 → 服务端行数与号池不变', async () => {
    for (let i = 1; i <= 2; i++) await booksData.addBook(A.db, bookInput(i), clock.tick())
    await settleAndAssert([A, B], server, 'R5 建书后')

    // 两端各自积累片段：同书不同 startTime、不同书交错（共用虚拟钟 ⇒ startTime 全局不撞）
    const push = async (dev: Device, n: number, frac: number): Promise<void> => {
      await eventsData.addReadingEvent(dev.db, {
        bookHash: bookHash(n),
        startTime: clock.tick(MIN),
        durationMs: 30_000,
        fraction: frac,
      })
    }
    for (const [dev, plan] of [
      [A, [1, 2, 1, 2, 1]],
      [B, [2, 1, 2, 1, 2]],
    ] as const) {
      for (const [i, n] of plan.entries()) await push(dev, n, FRACTIONS[i % 3])
    }
    expect(rowCount(A, 'readingEvents'), 'R5 A 本地 5 段').toBe(5)
    expect(rowCount(B, 'readingEvents'), 'R5 B 本地 5 段').toBe(5)

    await settleAndAssert([A, B], server, 'R5 收敛后')
    expect(rowCount(A, 'readingEvents'), 'R5 收敛后两端各持 10 段并集（零丢失）').toBe(10)
    expect(server.count('readingEvents'), 'R5 服务端同样 10 段').toBe(10)

    // 幂等：把同一批 push 载荷原样重发一次（模拟网络重试后客户端重推）
    const replay = server.pushLog.slice().filter((p) => (p.readingEvents ?? []).length > 0)
    expect(replay.length, 'R5 确实抓到了含事件的推送载荷').toBeGreaterThan(0)
    const rowsBefore = server.count('readingEvents')
    const verBefore = server.maxVer()
    for (const payload of replay) {
      const res = server.push({ changes: { readingEvents: payload.readingEvents } })
      expect(res.rejected.readingEvents ?? [], 'R5 append-only 永不进 rejected').toEqual([])
    }
    expect(server.count('readingEvents'), 'R5 重放后服务端行数不变（唯一键幂等）').toBe(rowsBefore)
    expect(server.maxVer(), 'R5 重复行不获得新号').toBe(verBefore)
    await settleAndAssert([A, B], server, 'R5 重放后')
  })

  // ────────────────── R6 多集合混流分页（号池全序分页第一次受多集合交错压力） ──────────────────

  it('R6 混流分页：一口气产生跨七集合 20 行 → 对端 limit=5 首灌翻页无漏无重、游标单调、候选恰好等于 limit 时再翻一页', async () => {
    const LIMIT = 5
    // 一口气产生跨七个集合的变更（中途不同步），合计 20 行：
    // words 3 + reviewLogs 2 + books 3 + progress 3 + annotations 3 + bookmarks 3 + readingEvents 3
    await addWords(A.db, [101, 102, 103], clock.tick())
    for (const dictId of [101, 102]) {
      const t = clock.tick()
      await applyRating(A.db, wordRecord(dictId, t), reviewLogInput(dictId, t), t)
    }
    for (let i = 1; i <= 3; i++) await booksData.addBook(A.db, bookInput(i), clock.tick())
    for (let i = 1; i <= 3; i++) {
      await progressData.saveProgress(
        A.db,
        { bookHash: bookHash(i), location: `epubcfi(/6/${i * 2}!/4/2)`, fraction: FRACTIONS[i - 1] },
        clock.tick(),
      )
    }
    for (let i = 1; i <= 3; i++) {
      await annotationsData.addAnnotation(
        A.db,
        annotationInput(i, bookHash(i), clock.now()),
        clock.tick(),
      )
    }
    for (let i = 1; i <= 3; i++) {
      await bookmarksData.addBookmark(A.db, bookmarkInput(i, bookHash(i), clock.now()), clock.tick())
    }
    for (let i = 1; i <= 3; i++) {
      await eventsData.addReadingEvent(A.db, {
        bookHash: bookHash(i),
        startTime: clock.tick(MIN),
        durationMs: 90_000,
        fraction: FRACTIONS[i - 1],
      })
    }
    const sourceCounts = rowCounts(A)
    expect(sourceCounts, 'R6 源端七集合各自的行数').toEqual({
      words: 3,
      reviewLogs: 2,
      books: 3,
      progress: 3,
      annotations: 3,
      bookmarks: 3,
      readingEvents: 3,
    })

    const aRound = await syncRound(A, server)
    expect(aRound.pushedRows, 'R6 七集合脏行合计 20 行').toBe(20)
    expect(server.pushCalls, 'R6 20 行 < 200/批 → 单批推完（§3.4）').toBe(1)
    expect(server.maxVer(), 'R6 服务端号池按 §3.3 固定集合顺序发到 20').toBe(20)

    // 对端用小 limit 首灌
    const stats = await syncRound(B, server, LIMIT)
    const pages = stats.pulls
    expect(pages.length, 'R6 20 行 / limit 5 → 4 个数据页 + 1 个空页收尾').toBe(5)
    // 页内构成横跨集合边界：这正是号池全序分页受多集合交错的压力点
    expect(
      pages.map((p) => p.counts),
      'R6 各页按 syncVer 全序切分，页边界落在集合中间',
    ).toEqual([
      { words: 3, reviewLogs: 2, books: 0, progress: 0, annotations: 0, bookmarks: 0, readingEvents: 0 },
      { words: 0, reviewLogs: 0, books: 3, progress: 2, annotations: 0, bookmarks: 0, readingEvents: 0 },
      { words: 0, reviewLogs: 0, books: 0, progress: 1, annotations: 3, bookmarks: 1, readingEvents: 0 },
      { words: 0, reviewLogs: 0, books: 0, progress: 0, annotations: 0, bookmarks: 2, readingEvents: 3 },
      { words: 0, reviewLogs: 0, books: 0, progress: 0, annotations: 0, bookmarks: 0, readingEvents: 0 },
    ])
    // 候选数**恰好等于 limit** 的第 4 页 → done=false（严格小于才收工）→ 第 5 页空页收尾
    expect(
      pages.map((p) => p.done),
      'R6 末满页 done=false（候选恰好 = limit 必须再翻一页），空页才 done=true',
    ).toEqual([false, false, false, false, true])
    expect(pages[4], 'R6 空页：零行、nextSince = since（游标不倒退）').toMatchObject({
      total: 0,
      nextSince: pages[3].nextSince,
    })
    // 游标单调：数据页严格递增，空页持平
    const cursors = pages.map((p) => p.nextSince)
    expect(cursors, 'R6 游标单调推进（4 个数据页 + 空页持平）').toEqual([5, 10, 15, 20, 20])

    // 翻页无漏行、无重复：收到的 syncVer 恰是 1..20 各一次
    const seen: number[] = []
    for (const p of pages) for (const spec of COLLECTIONS) {
      for (const r of rowsOf(p.changes, spec.name)) seen.push(r.syncVer)
    }
    expect(seen.length, 'R6 收到行数 = 服务端行数（无重复）').toBe(20)
    expect(
      [...seen].sort((a, b) => a - b),
      'R6 syncVer 1..20 逐个到齐（无漏行）',
    ).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))

    expect(rowCounts(B), 'R6 各集合行数与源端一致').toEqual(sourceCounts)
    await settleAndAssert([A, B], server, 'R6', LIMIT)
  })

  // ────────────────── R7 首灌跳墓碑 ──────────────────

  it('R7 首灌跳墓碑：新设备只拿存活书行，被删书的 progress/annotations 照常到达（幽灵数据合法）；老游标设备照常收到墓碑', async () => {
    const X = bookHash(1) // 存活
    const Y = bookHash(2) // 待删
    const C = makeDevice('C') // 对照组：删书前已同步过的老设备（游标 > 0）

    await booksData.addBook(A.db, bookInput(1, '存活的书'), clock.tick())
    await booksData.addBook(A.db, bookInput(2, '将被删的书'), clock.tick())
    for (const [i, h] of [X, Y].entries()) {
      await progressData.saveProgress(
        A.db,
        { bookHash: h, location: `epubcfi(/6/${i + 2}!/4/2)`, fraction: FRACTIONS[i] },
        clock.tick(),
      )
      await annotationsData.addAnnotation(
        A.db,
        annotationInput(i + 1, h, clock.now()),
        clock.tick(),
      )
    }
    await syncRound(A, server)
    // C 在删书**之前**同步过一轮 ⇒ 游标 > 0
    await syncRound(C, server)
    expect(await getCursor(C.db), 'R7 C 是老设备（游标 > 0）').toBeGreaterThan(0)
    expect(await booksData.getBook(C.db, Y), 'R7 C 删书前已有 Y 书行').not.toBeNull()

    // A 删掉 Y
    await booksData.removeBook(A.db, Y, clock.tick())
    await syncRound(A, server)
    expect(server.rowOf('books', Y)?.isDeleted, 'R7 服务端 Y 是墓碑行').toBe(1)

    // ① 新设备 B：since = 0 首灌 → 跳墓碑
    const bStats = await syncRound(B, server)
    const firstLoadRows = bStats.pulls.flatMap((p) =>
      COLLECTIONS.flatMap((spec) => rowsOf(p.changes, spec.name)),
    )
    expect(firstLoadRows.length, 'R7 B 首灌确实收到了行').toBeGreaterThan(0)
    expect(
      firstLoadRows.filter((r) => r.isDeleted === 1),
      'R7 首灌不下发任何墓碑行（§3.2）',
    ).toEqual([])
    expect((await booksData.listBooks(B.db)).map((b) => b.bookHash), 'R7 B 书架只有存活书').toEqual([X])
    expect(await booksData.getBook(B.db, Y), 'R7 B 没有被删书的书行').toBeNull()
    // ② 被删书的 progress / annotations 照常到达 ——「有阅读数据无书行」是合法状态（db/05）
    expect(await progressData.getProgress(B.db, Y), 'R7 被删书的进度照常到达（progress 无墓碑）').not.toBeNull()
    expect(
      await annotationsData.listAnnotations(B.db, Y),
      'R7 被删书的标注照常到达（annotations 墓碑独立于 books）',
    ).toHaveLength(1)
    expect(rowCount(B, 'progress'), 'R7 B 两本书的进度都在').toBe(2)
    expect(rowCount(B, 'annotations'), 'R7 B 两本书的标注都在').toBe(2)

    // ③ 对照组 C（游标 > 0）：照常收到墓碑并删行
    const cStats = await syncRound(C, server)
    const tombstones = cStats.pulls.flatMap((p) => (p.changes.books ?? []).filter((r) => r.isDeleted === 1))
    expect(tombstones.map((r) => r.bookHash), 'R7 老游标照常收到墓碑').toEqual([Y])
    expect(await booksData.getBook(C.db, Y), 'R7 C 应用墓碑 = 物理删本地行').toBeNull()
    expect(await progressData.getProgress(C.db, Y), 'R7 C 的阅读数据同样不连带删').not.toBeNull()

    // 三端最终收敛到同一状态
    await settleAndAssert([A, B, C], server, 'R7')
    expect(rowCount(A, 'books'), 'R7 三端都只剩存活书一行').toBe(1)
  })
})
