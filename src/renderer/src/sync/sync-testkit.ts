// 九集合同步仿真基建（sync.md §2 注册表 / §3.2 pull / §3.3 push）：虚拟钟、内存设备、假服务端、
// 全库快照与脏行计数。供 convergence-full.test.ts（协议级双端收敛）与 engine-wiring.test.ts（SyncEngine 接线）共用。
//
// 骨架复制自 convergence.test.ts（按任务书那份文件一行不改），并从两集合扩到全部九集合。
// 本文件**不是**用例文件（无 `.test.ts` 后缀，vitest 的 include 不收录它），只提供基建；
// 断言一律留在两个用例文件里（这里不 import vitest）。
import Database from 'better-sqlite3'
import { drizzle as betterDrizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as proxyDrizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { runBatch as execBatch, runStmt as execStmt } from '../../../main/dbExecutor'
import { getMeta, setMetaStmt } from '@/db/meta'
import type { Db } from '@/db/client'
import type {
  SyncChanges,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from './protocol'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../drizzle', import.meta.url))

/** 与 engine.ts 同值（该文件未导出，此处按 sync.md §3.4 复刻：pull limit clamp[1,500]、push 200 行/批）。 */
export const PULL_LIMIT = 500
export const PUSH_BATCH = 200

export const MIN = 60_000
export const DAY = 24 * 60 * MIN

/** 第 k 个虚拟天的 10:00（Date 组件构造，稳落在当日 [4:00, 次日4:00) 窗口内）。 */
export const dayStartAt = (k: number): number => new Date(2026, 0, 15 + k, 10, 0, 0, 0).getTime()

// ══════════════════ 虚拟钟（两端共用，单调前进） ══════════════════

/** 假服务端取 `serverTimeMs` 的时间源（虚拟钟或 `{ now: () => Date.now() + skew }` 都满足）。 */
export interface TimeSource {
  now(): number
}

export class Clock implements TimeSource {
  private t: number
  constructor(start: number) {
    this.t = start
  }
  now(): number {
    return this.t
  }
  /** 前进 ms（默认 1ms）并返回新值：任何落库写前调用，保证 editTime 可区分、append-only 自然键不撞。 */
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

export interface Device {
  name: string
  db: Db
  sqlite: Database.Database
}

/** 一个建好表的内存库（engine-wiring.test.ts 要把**生产 db 单例**指向它，故单独暴露这一步）。 */
export function migrateNewSqlite(): Database.Database {
  const sqlite = new Database(':memory:')
  migrate(betterDrizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR })
  return sqlite
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** 模拟一台设备：进程内 better-sqlite3 + 迁移建库，走与生产同一套数据函数（照抄 convergence.test.ts）。 */
export function makeDevice(name: string): Device {
  const sqlite = migrateNewSqlite()
  const db = proxyDrizzle(
    async (sql, params, method) => execStmt(sqlite, { sql, params, method }) as { rows: any[] },
    async (queries) => execBatch(sqlite, queries) as { rows: any[] }[],
  )
  return { name, db, sqlite }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ══════════════════ 集合注册表（逐条对照 sync.md §2 的九行表格） ══════════════════

export type CollName = keyof SyncChanges

/** 服务端存的一行：wire 行 + 服务端发的号。 */
export type WireRow = Record<string, unknown> & { syncVer: number }

interface CollSpec {
  name: CollName
  /** 自然键（wire 字段，多列拼串）。 */
  key: (row: WireRow) => string
  kind: 'lww' | 'append'
  /** 有墓碑 → 首灌（since=0）跳 is_deleted=1 的行（sync.md §3.2）。 */
  tombstone: boolean
}

/**
 * 九集合，**顺序 = sync.md §3.3 服务端 push 处理顺序**
 *（words → notes → settings → reviewLogs → books → progress → annotations → bookmarks → readingEvents）。
 * 自然键与「LWW / append-only」「有无墓碑」逐条照 §2 注册表。
 */
export const COLLECTIONS: readonly CollSpec[] = [
  { name: 'words', key: (r) => `${r.dictId}`, kind: 'lww', tombstone: true },
  { name: 'notes', key: (r) => `${r.dictId}`, kind: 'lww', tombstone: true },
  { name: 'settings', key: (r) => `${r.settingKey}`, kind: 'lww', tombstone: false },
  { name: 'reviewLogs', key: (r) => `${r.dictId}:${r.reviewTime}`, kind: 'append', tombstone: false },
  { name: 'books', key: (r) => `${r.bookHash}`, kind: 'lww', tombstone: true },
  { name: 'progress', key: (r) => `${r.bookHash}`, kind: 'lww', tombstone: false },
  { name: 'annotations', key: (r) => `${r.annotationId}`, kind: 'lww', tombstone: true },
  { name: 'bookmarks', key: (r) => `${r.bookmarkId}`, kind: 'lww', tombstone: true },
  {
    name: 'readingEvents',
    key: (r) => `${r.bookHash}:${r.startTime}`,
    kind: 'append',
    tombstone: false,
  },
]

/** 服务端业务内容快照（不含 syncVer）：重放幂等断言用——`>=` 覆盖会重新发号，内容才是不变量。 */
export type ContentSnapshot = Record<CollName, Record<string, unknown>[]>

// ══════════════════ 假服务端（九集合，逐条对齐 sync.md §3.2 / §3.3） ══════════════════

/**
 * 内存假服务端：九集合全实现。单调号池从 1 起、全序无并列；上行行的 syncVer 一律忽略（客户端恒送 0），
 * 下发行必带服务端发的号。
 *
 * **不实现形状守卫**（仿真只产合法行，守卫是服务端 SyncServiceTest 的领地）：`skippedInvalid` 默认恒 0，
 * 需要构造 fail-loudly 场景时由测试显式置 `skippedInvalidPerPush`。
 */
export class FakeServer {
  private readonly store = new Map<CollName, Map<string, WireRow>>()
  private nextVer = 1
  pushCalls = 0
  pullCalls = 0
  /** 调用轨迹（'pull' / 'push' 依次追加）：回合编排的顺序断言用。 */
  readonly calls: ('pull' | 'push')[] = []
  /** 每次 push 回执里的 skippedInvalid（默认 0；E10 fail-loudly 场景显式抬高）。 */
  skippedInvalidPerPush = 0

  constructor(private readonly clock: TimeSource) {
    for (const spec of COLLECTIONS) this.store.set(spec.name, new Map())
  }

  private mapOf(name: CollName): Map<string, WireRow> {
    return this.store.get(name) as Map<string, WireRow>
  }

  /** 某集合的行数。 */
  count(name: CollName): number {
    return this.mapOf(name).size
  }
  /** 某集合按自然键取行（副本）。 */
  rowOf(name: CollName, key: string): WireRow | undefined {
    const r = this.mapOf(name).get(key)
    return r ? { ...r } : undefined
  }
  /** 某集合全部行（副本，按自然键排序）。 */
  rowsOf(name: CollName): WireRow[] {
    return [...this.mapOf(name).entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([, r]) => ({ ...r }))
  }
  /** 已发出的最大号（= 客户端拉完后的游标）。 */
  maxVer(): number {
    return this.nextVer - 1
  }
  /** 九集合行数合计。 */
  totalRows(): number {
    return COLLECTIONS.reduce((n, s) => n + this.count(s.name), 0)
  }

  contentSnapshot(): ContentSnapshot {
    const out = {} as ContentSnapshot
    for (const spec of COLLECTIONS) {
      out[spec.name] = this.rowsOf(spec.name).map((r) => {
        const { syncVer: _drop, ...rest } = r
        return rest
      })
    }
    return out
  }

  /** 直接把行灌进服务端（模拟别的设备早先推过的存量），语义同 push 但不计入调用轨迹。 */
  seed(changes: SyncChanges): void {
    this.ingest(changes)
  }

  /**
   * push（sync.md §3.3）：按固定集合顺序逐行处理。
   * - LWW：无行 → insert 发号；`remote.editTime >= existing.editTime` → 整行覆盖发号（**>= 语义**，
   *   等值也覆盖，重放友好）；严格更小 → 装入 `rejected.<集合>` 带回服务端当前行（含其 syncVer）。
   * - append-only：按自然键幂等——已存在则静默成功、不发新号、不进 rejected。
   */
  push(req: SyncPushRequest): SyncPushResponse {
    this.pushCalls++
    this.calls.push('push')
    const { rejected, maxAssignedVer } = this.ingest(req.changes)
    return {
      maxAssignedVer,
      rejected,
      skippedInvalid: this.skippedInvalidPerPush,
      serverTimeMs: this.clock.now(),
    }
  }

  private ingest(changes: SyncChanges): { rejected: SyncChanges; maxAssignedVer: number } {
    const rejected: SyncChanges = {}
    let maxAssignedVer = 0
    for (const spec of COLLECTIONS) {
      const rows = (changes[spec.name] ?? []) as unknown as WireRow[]
      const map = this.mapOf(spec.name)
      for (const row of rows) {
        const k = spec.key(row)
        const existing = map.get(k)
        if (spec.kind === 'append') {
          if (existing) continue // 唯一键命中 = 重复推送，幂等静默成功、不获新号
        } else if (existing && (row.editTime as number) < (existing.editTime as number)) {
          // 服务端赢：带回当前行供客户端就地收敛
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;((rejected[spec.name] ??= [] as any) as unknown[]).push({ ...existing })
          continue
        }
        const syncVer = this.nextVer++
        maxAssignedVer = Math.max(maxAssignedVer, syncVer)
        map.set(k, { ...row, syncVer })
      }
    }
    return { rejected, maxAssignedVer }
  }

  /**
   * pull（sync.md §3.2）：九集合各查 `syncVer > since ORDER BY syncVer LIMIT limit`，
   * 内存按 syncVer 全序合并后取前 `limit` 行按集合装回 changes；`nextSince` = 本页纳入的最大 syncVer；
   * **`done` = 合并候选总数 < limit（严格小于——恰好等于 limit 时必须让客户端再翻一页）**；
   * 空页 `nextSince = since`、`done = true`。limit clamp [1,500]。
   * 首灌（since=0）只对**有墓碑的五个 LWW 集合**跳墓碑行（settings/progress/两个 append-only 不受影响）。
   */
  pull(req: SyncPullRequest): SyncPullResponse {
    this.pullCalls++
    this.calls.push('pull')
    const limit = Math.min(500, Math.max(1, Math.trunc(req.limit)))
    const since = req.since
    const candidates: { name: CollName; row: WireRow }[] = []
    for (const spec of COLLECTIONS) {
      const rows = [...this.mapOf(spec.name).values()]
        .filter((r) => r.syncVer > since)
        .filter((r) => !(since === 0 && spec.tombstone && r.isDeleted === 1))
        .sort((a, b) => a.syncVer - b.syncVer)
        .slice(0, limit) // 各集合自身的 LIMIT
      for (const row of rows) candidates.push({ name: spec.name, row })
    }
    candidates.sort((a, b) => a.row.syncVer - b.row.syncVer)
    const done = candidates.length < limit // 严格小于：恰好等于 limit 时必须再翻一页
    const page = candidates.slice(0, limit)
    const changes: SyncChanges = {}
    for (const { name, row } of page) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;((changes[name] ??= [] as any) as unknown[]).push({ ...row })
    }
    const nextSince = page.length > 0 ? page[page.length - 1].row.syncVer : since
    return { changes, nextSince, done, serverTimeMs: this.clock.now() }
  }
}

/** 一份 changes 的行数合计（分页 / 批次断言用）。 */
export function countChanges(changes: SyncChanges): number {
  return COLLECTIONS.reduce((n, s) => n + ((changes[s.name] ?? []) as unknown[]).length, 0)
}

// ══════════════════ 本地游标（同 engine.ts） ══════════════════

export async function getCursor(db: Db): Promise<number> {
  return Number((await getMeta(db, 'last_sync_ver')) ?? '0')
}
export function setCursorStmt(db: Db, ver: number) {
  return setMetaStmt(db, 'last_sync_ver', String(Math.trunc(ver)))
}

// ══════════════════ 全库快照 / 脏行计数（九张表，测试内可裸 SQL） ══════════════════

export interface DumpWord {
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
export interface DumpNote {
  dictId: number
  note: string
  editTime: number
  isDeleted: number
}
export interface DumpSetting {
  settingKey: string
  value: string
  editTime: number
}
export interface DumpLog {
  dictId: number
  reviewTime: number
  rating: number
  durationMs: number
  preState: number
  preStability: number
  preDifficulty: number
}
export interface DumpBook {
  bookHash: string
  title: string
  author: string
  format: string
  importedAt: number
  editTime: number
  isDeleted: number
}
export interface DumpProgress {
  bookHash: string
  location: string
  fraction: number
  lastReadAt: number
  editTime: number
}
export interface DumpAnnotation {
  annotationId: string
  bookHash: string
  cfi: string
  text: string
  color: string
  style: string
  note: string
  createdAt: number
  editTime: number
  isDeleted: number
}
export interface DumpBookmark {
  bookmarkId: string
  bookHash: string
  cfi: string
  title: string
  createdAt: number
  editTime: number
  isDeleted: number
}
export interface DumpEvent {
  bookHash: string
  startTime: number
  durationMs: number
  fraction: number
}

export interface DumpState {
  words: DumpWord[]
  notes: DumpNote[]
  settings: DumpSetting[]
  reviewLogs: DumpLog[]
  books: DumpBook[]
  progress: DumpProgress[]
  annotations: DumpAnnotation[]
  bookmarks: DumpBookmark[]
  readingEvents: DumpEvent[]
}

/**
 * 全库业务态快照（业务列 + isDeleted，**排除 dirty 列**——dirty 是本地私有态，收敛静止后另行断言为 0）。
 * 浮点逐位比较：两端同源计算必须逐位一致，不一致就是发现，不许 toBeCloseTo 弱化。
 */
export function dumpState(dev: Device): DumpState {
  const q = <T>(sql: string): T[] => dev.sqlite.prepare(sql).all() as T[]
  return {
    words: q<DumpWord>(
      `SELECT dict_id AS dictId, due, stability, difficulty, scheduled_days AS scheduledDays,
              learning_steps AS learningSteps, reps, lapses, state, last_review AS lastReview,
              join_time AS joinTime, edit_time AS editTime, is_deleted AS isDeleted
       FROM user_word ORDER BY dict_id`,
    ),
    notes: q<DumpNote>(
      `SELECT dict_id AS dictId, note, edit_time AS editTime, is_deleted AS isDeleted
       FROM user_word_note ORDER BY dict_id`,
    ),
    settings: q<DumpSetting>(
      `SELECT setting_key AS settingKey, value, edit_time AS editTime
       FROM user_setting ORDER BY setting_key`,
    ),
    reviewLogs: q<DumpLog>(
      `SELECT dict_id AS dictId, review_time AS reviewTime, rating, duration_ms AS durationMs,
              pre_state AS preState, pre_stability AS preStability, pre_difficulty AS preDifficulty
       FROM user_review_log ORDER BY dict_id, review_time`,
    ),
    books: q<DumpBook>(
      `SELECT book_hash AS bookHash, title, author, format, imported_at AS importedAt,
              edit_time AS editTime, is_deleted AS isDeleted
       FROM user_book ORDER BY book_hash`,
    ),
    progress: q<DumpProgress>(
      `SELECT book_hash AS bookHash, location, fraction, last_read_at AS lastReadAt,
              edit_time AS editTime
       FROM user_book_progress ORDER BY book_hash`,
    ),
    annotations: q<DumpAnnotation>(
      `SELECT annotation_id AS annotationId, book_hash AS bookHash, cfi, text, color, style, note,
              created_at AS createdAt, edit_time AS editTime, is_deleted AS isDeleted
       FROM user_book_annotation ORDER BY annotation_id`,
    ),
    bookmarks: q<DumpBookmark>(
      `SELECT bookmark_id AS bookmarkId, book_hash AS bookHash, cfi, title,
              created_at AS createdAt, edit_time AS editTime, is_deleted AS isDeleted
       FROM user_book_bookmark ORDER BY bookmark_id`,
    ),
    readingEvents: q<DumpEvent>(
      `SELECT book_hash AS bookHash, start_time AS startTime, duration_ms AS durationMs, fraction
       FROM user_reading_event ORDER BY book_hash, start_time`,
    ),
  }
}

/** 九张表的 dirty 行计数（收敛静止 = 全零）。 */
export type DirtyCounts = Record<CollName, number>

const DIRTY_TABLES: Record<CollName, string> = {
  words: 'user_word',
  notes: 'user_word_note',
  settings: 'user_setting',
  reviewLogs: 'user_review_log',
  books: 'user_book',
  progress: 'user_book_progress',
  annotations: 'user_book_annotation',
  bookmarks: 'user_book_bookmark',
  readingEvents: 'user_reading_event',
}

export const countOne = (dev: Device, sql: string): number =>
  (dev.sqlite.prepare(sql).get() as { n: number }).n

export function dirtyCounts(dev: Device): DirtyCounts {
  const out = {} as DirtyCounts
  for (const spec of COLLECTIONS) {
    out[spec.name] = countOne(dev, `SELECT count(*) AS n FROM ${DIRTY_TABLES[spec.name]} WHERE dirty=1`)
  }
  return out
}

/** 全零脏行（断言 `toEqual(NO_DIRTY)`）。 */
export const NO_DIRTY: DirtyCounts = {
  words: 0,
  notes: 0,
  settings: 0,
  reviewLogs: 0,
  books: 0,
  progress: 0,
  annotations: 0,
  bookmarks: 0,
  readingEvents: 0,
}

/** 九张表的行数（含墓碑行；零丢失断言用）。 */
export function tableCounts(dev: Device): DirtyCounts {
  const out = {} as DirtyCounts
  for (const spec of COLLECTIONS) {
    out[spec.name] = countOne(dev, `SELECT count(*) AS n FROM ${DIRTY_TABLES[spec.name]}`)
  }
  return out
}

// ══════════════════ 种子（测试内可裸 SQL） ══════════════════

/** 词典缓存行（不入同步协议，各端由词库补缺自行填，cache/dict.md）。 */
export function seedDict(dev: Device, dictId: number, term = `w${dictId}`): void {
  dev.sqlite.prepare('INSERT INTO dict (dict_id, term, term_type) VALUES (?,?,?)').run(dictId, term, 1)
}

export function seedDictAll(devs: readonly Device[], ids: readonly number[]): void {
  for (const dev of devs) for (const id of ids) seedDict(dev, id)
}

/** 32 位小写 hex 的书身份（形状照 sync.md §3.3 守卫；仿真只产合法行）。 */
export const bookHashOf = (n: number): string => n.toString(16).padStart(32, '0')

/** UUID 形状的标注 / 书签 id（形状照 sync.md §3.3 守卫）。 */
export const uuidOf = (tag: string, n: number): string => {
  const hex = (v: number, len: number): string => v.toString(16).padStart(len, '0').slice(-len)
  const seed = [...tag].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  return `${hex(seed, 8)}-${hex(n, 4)}-4${hex(n, 3)}-8${hex(seed, 3)}-${hex(seed ^ n, 12)}`
}
