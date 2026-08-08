// 同步引擎（renderer）：一个无状态回合 = pull 循环 → push 脏行 →（有推送则）收口 pull。
// 任何一步失败直接放弃本回合，下回合从头再来，一切幂等（sync.md §3.4）。九集合
//（words/notes/settings/reviewLogs + books/progress/annotations/bookmarks/readingEvents）
// 按固定顺序显式编排（形态 A′，非注册表）；定时器跑在 renderer（窗口 backgroundThrottling 已关）。
//
// 触发保守化（sync.md §3.4）：仅 启动立即一回合 + 前台 5min 定时 + 手动。无写后防抖、无失败退避：
// 空回合近乎免费（空 push 短路）；失败只记 lastError 等下一跳或手动重试；鉴权失败停手等重新登录。
import { db, runBatch } from '@/db/client'
import type { Db } from '@/db/client'
import { getMeta, setMetaStmt } from '@/db/meta'
import { LOCAL_TABLES } from '@/db/schema'
import { AuthError } from '@/api/request'
import { toast } from '@/lib/toast'
import * as api from '@/api/sync'
import * as clock from './clock'
import type { BatchItem } from 'drizzle-orm/batch'
import type { SyncChanges } from './protocol'
import { words, notes, reviewLogs } from '@/wordbook/collections'
import { settings } from '@/settings/collection'
import { annotations, bookmarks, books, progress, readingEvents } from '@/reading/collections'
import { purgeRemovedBookFiles } from '@/reading/library'
import { setDictUpdatesSinceStmt } from '@/dict/dict'
import { fillMissingDict } from '@/wordbook/service'

const PULL_LIMIT = 500
const PUSH_BATCH = 200 // sync.md §3.4：push 按 200 行/批
const PERIODIC_MS = 5 * 60 * 1_000 // 前台定时兜底另一端变更（sync.md §3.4）

/** 引擎对外暴露的运行状态（诊断用）。 */
export interface SyncStatus {
  active: boolean
  running: boolean
  lastSyncAt: number | null
  lastError: string | null
  pendingDirty: number
  cursor: number
}

export const INACTIVE_STATUS: SyncStatus = {
  active: false,
  running: false,
  lastSyncAt: null,
  lastError: null,
  pendingDirty: 0,
  cursor: 0,
}

/** 把九集合脏行扁平化后按 size 切块，再按集合装回 SyncChanges（保持集合分组，reconcile 可按集合分发）。 */
function chunkChanges(all: Required<SyncChanges>, size: number): SyncChanges[] {
  type Tagged = { k: keyof SyncChanges; row: unknown }
  const tagged: Tagged[] = [
    ...all.words.map((row) => ({ k: 'words' as const, row })),
    ...all.notes.map((row) => ({ k: 'notes' as const, row })),
    ...all.settings.map((row) => ({ k: 'settings' as const, row })),
    ...all.reviewLogs.map((row) => ({ k: 'reviewLogs' as const, row })),
    ...all.books.map((row) => ({ k: 'books' as const, row })),
    ...all.progress.map((row) => ({ k: 'progress' as const, row })),
    ...all.annotations.map((row) => ({ k: 'annotations' as const, row })),
    ...all.bookmarks.map((row) => ({ k: 'bookmarks' as const, row })),
    ...all.readingEvents.map((row) => ({ k: 'readingEvents' as const, row })),
  ]
  const batches: SyncChanges[] = []
  for (let i = 0; i < tagged.length; i += size) {
    const b: SyncChanges = {}
    for (const { k, row } of tagged.slice(i, i + size)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((b[k] ??= [] as any) as unknown[]).push(row)
    }
    batches.push(b)
  }
  return batches
}

/** 九集合行数合计（脏行计数用）。 */
function countRows(all: Required<SyncChanges>): number {
  return Object.values(all).reduce((n, rows) => n + rows.length, 0)
}

/**
 * 服务端跳过非法行的 fail-loudly 提示（sync.md §3.3）：跳过后该行 dirty 已被 compare-and-clear 清掉、不再重推，
 * 故一次推送只提示一次，无需去重。计数为 0 时静默。
 */
export function notifySkippedRows(count: number): void {
  if (count <= 0) return
  console.error(`[sync] 服务端跳过 ${count} 条非法本地数据（已停止重推），请带日志反馈此问题`)
  toast.error(`${count} 条本地数据同步异常已跳过，请反馈此问题`)
}

/** 时钟偏差阈值：与 Anki 同取 5 分钟，绝对偏差超此值视为设备时间明显异常。 */
const CLOCK_SKEW_THRESHOLD_MS = 5 * 60 * 1000

/**
 * 时钟偏差提示（fail-loudly）：|offset| 超阈值 → 每次同步回合都 toast，故意不节流不去重，
 * 让用户在每次同步时持续意识到设备时间异常（已自动校正、不影响同步）。offset 为 null（校准被忽略）
 * 或在阈值内时静默。
 */
export function notifyClockSkew(offsetMs: number | null): void {
  if (offsetMs === null || Math.abs(offsetMs) <= CLOCK_SKEW_THRESHOLD_MS) return
  console.warn(`[sync] 设备时间与服务器偏差 ${offsetMs}ms，已自动校正，建议用户检查系统时间设置`)
  toast.warning('设备时间偏差较大，已自动校正，建议检查系统时间设置')
}

/** 本地游标 last_sync_ver：pull 请求 sync_ver 严格大于它的行（sync 私有态，存 meta KV）。 */
async function getCursor(db: Db): Promise<number> {
  return Number((await getMeta(db, 'last_sync_ver')) ?? '0')
}
/** 游标更新语句（供 pull 一页与 applyChanges 合进同一 batch）。 */
function setCursorStmt(db: Db, ver: number) {
  return setMetaStmt(db, 'last_sync_ver', String(Math.trunc(ver)))
}

export class SyncEngine {
  private running = false
  private stopped = false
  private lastError: string | null = null
  private lastSyncAt: number | null = null
  private cursorCache = 0
  private pendingDirtyCache = 0
  private periodicTimer: ReturnType<typeof setInterval> | null = null

  /** 登录后启动：立即跑一回合 + 起前台 5min 定时。 */
  start(): void {
    if (this.stopped) return
    this.periodicTimer = setInterval(() => void this.runRoundSafe(), PERIODIC_MS)
    void this.runRoundSafe()
  }

  /** 登出/换账号：清定时器（脏行留在库文件里，下次登录续推）。关库由 session 负责。 */
  stop(): void {
    this.stopped = true
    if (this.periodicTimer) clearInterval(this.periodicTimer)
  }

  getStatus(): SyncStatus {
    return {
      active: !this.stopped,
      running: this.running,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      pendingDirty: this.pendingDirtyCache,
      cursor: this.cursorCache,
    }
  }

  /** 静默回合：单飞、不抛；失败只记 lastError 等下一跳/手动（无退避）。手动触发也走这里。 */
  async runRoundSafe(): Promise<void> {
    if (this.stopped || this.running) return
    try {
      await this.runRound()
      this.lastError = null
    } catch (e) {
      if (e instanceof AuthError) {
        this.lastError = 'auth' // 未登录/令牌失效：停手，等重新登录后由 start()/手动触发再驱动
        return
      }
      if (this.stopped) return
      this.lastError = e instanceof Error ? e.message : String(e)
    }
  }

  /** 逃生舱（手动/设置页）：尽力推完脏行 → 清库 → 游标 0 重灌（重灌后词库补缺自动重建缓存）。 */
  async forceReset(): Promise<void> {
    if (this.stopped || this.running) return
    this.running = true
    try {
      try {
        await this.pushDirty()
      } catch {
        /* best effort：推不完也照样重灌 */
      }
      await this.wipeAndResetCursor()
      await this.pullLoop()
      this.lastSyncAt = Date.now()
      this.lastError = null
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
    } finally {
      this.running = false
    }
  }

  private async runRound(): Promise<void> {
    this.running = true
    try {
      await this.pullLoop()
      const pushed = await this.pushDirty()
      if (pushed) await this.pullLoop() // 收口：拉回自己刚发号的行（幂等，无害）
      this.lastSyncAt = Date.now()
    } finally {
      this.running = false
    }
  }

  private async pullLoop(): Promise<void> {
    const startSince = await getCursor(db)
    let appliedWords = false
    for (;;) {
      const since = await getCursor(db)
      const res = await api.pull({ since, limit: PULL_LIMIT })
      // 网络 await 期间可能登出/换账号（stopEngine 置 stopped、db 单例已指向新库）：停手不写换后账号的库。
      if (this.stopped) return
      notifyClockSkew(await clock.calibrate(db, res.serverTimeMs))
      const c = res.changes
      // pull 应用按固定顺序（words → … → readingEvents）合入同一 batch（原子，sync.md §3.2）。
      // ?? [] 是必要防御：server 可能省略空集合的 key（sync.md §3.1）。
      const applyStmts: BatchItem<'sqlite'>[] = [
        ...(c.words ?? []).map((r) => words.applyRemoteStmt(db, r)),
        ...(c.notes ?? []).map((r) => notes.applyRemoteStmt(db, r)),
        ...(c.settings ?? []).map((r) => settings.applyRemoteStmt(db, r)),
        ...(c.reviewLogs ?? []).map((r) => reviewLogs.applyRemoteStmt(db, r)),
        ...(c.books ?? []).map((r) => books.applyRemoteStmt(db, r)),
        ...(c.progress ?? []).map((r) => progress.applyRemoteStmt(db, r)),
        ...(c.annotations ?? []).map((r) => annotations.applyRemoteStmt(db, r)),
        ...(c.bookmarks ?? []).map((r) => bookmarks.applyRemoteStmt(db, r)),
        ...(c.readingEvents ?? []).map((r) => readingEvents.applyRemoteStmt(db, r)),
      ]
      const tail: BatchItem<'sqlite'>[] = [setCursorStmt(db, res.nextSince)]
      // 首灌完成锚点：首个从 0 起的全量 pull 循环 done 时，用本次 serverTimeMs 置词典增量水位线初值
      //（cache/dict.md §3；同锚点亦触发词库补缺，见下）。
      if (startSince === 0 && res.done) tail.push(setDictUpdatesSinceStmt(db, res.serverTimeMs))
      await runBatch(db, [...applyStmts, ...tail])
      this.cursorCache = res.nextSince
      if ((c.words ?? []).length > 0) appliedWords = true
      // 别端删书：行已随墓碑删掉，本机书文件也得跟着删（文件不在 batch 里，只能事后收尾）。
      const removedBooks = (c.books ?? []).filter((r) => r.isDeleted === 1).map((r) => r.bookHash)
      if (removedBooks.length > 0) await purgeRemovedBookFiles(removedBooks)
      if (res.done) break
    }
    // 补缺钩子：本轮 pull 应用过 words 行 → 后台词库补缺（不阻塞；世代号护栏在 service 内）。
    // 挂在 pullLoop 内而非 runRound：覆盖常规回合、首灌、forceReset 直调 pullLoop 三条路径。
    if (appliedWords) void fillMissingDict(db)
  }

  /** 收集九集合脏行（固定顺序，形态 A′）。 */
  private async collectAllDirty(): Promise<Required<SyncChanges>> {
    return {
      words: await words.collectDirty(db),
      notes: await notes.collectDirty(db),
      settings: await settings.collectDirty(db),
      reviewLogs: await reviewLogs.collectDirty(db),
      books: await books.collectDirty(db),
      progress: await progress.collectDirty(db),
      annotations: await annotations.collectDirty(db),
      bookmarks: await bookmarks.collectDirty(db),
      readingEvents: await readingEvents.collectDirty(db),
    }
  }

  /** 收集九集合脏行分批 push；返回是否有过写入（决定是否收口 pull）。 */
  private async pushDirty(): Promise<boolean> {
    const dirty = await this.collectAllDirty()
    const total = countRows(dirty)
    this.pendingDirtyCache = total
    if (total === 0) return false

    let skippedInvalid = 0
    for (const batch of chunkChanges(dirty, PUSH_BATCH)) {
      const res = await api.push({ changes: batch })
      if (this.stopped) return false // 换账号护栏（同 pullLoop）
      notifyClockSkew(await clock.calibrate(db, res.serverTimeMs))
      await runBatch(db, this.reconcileStmts(batch, res.rejected ?? {}))
      skippedInvalid += res.skippedInvalid ?? 0
    }
    notifySkippedRows(skippedInvalid) // 有非法行被服务端跳过 → 大声提示用户反馈（sync.md §3.3）
    this.pendingDirtyCache = countRows(await this.collectAllDirty())
    return true
  }

  /**
   * push 回执对账（sync.md §3.4）：每集合先应用 rejected（服务端赢、清 dirty/改 editTime），
   * 再对推送批做 compare-and-clear（被 rejected 覆盖的行快照已不匹配 → 自然跳过）。固定顺序、显式分发。
   */
  private reconcileStmts(pushed: SyncChanges, rejected: SyncChanges): BatchItem<'sqlite'>[] {
    const stmts: BatchItem<'sqlite'>[] = []
    for (const r of rejected.words ?? []) stmts.push(words.applyRemoteStmt(db, r))
    stmts.push(...words.clearAcceptedStmts(db, pushed.words ?? []))
    for (const r of rejected.notes ?? []) stmts.push(notes.applyRemoteStmt(db, r))
    stmts.push(...notes.clearAcceptedStmts(db, pushed.notes ?? []))
    for (const r of rejected.settings ?? []) stmts.push(settings.applyRemoteStmt(db, r))
    stmts.push(...settings.clearAcceptedStmts(db, pushed.settings ?? []))
    // reviewLogs / readingEvents 是 append-only，无 rejected（幂等静默成功），只清 dirty。
    stmts.push(...reviewLogs.clearAcceptedStmts(db, pushed.reviewLogs ?? []))
    // rejected 里的 books 墓碑行同样会删掉本地行，但文件收尾不在这里做：这些行的 sync_ver 必然高于本地游标
    //（服务端行比我们推的更新才会拒），紧接着的收口 pull 会把同一行再下发一次，purge 在那时统一发生。
    for (const r of rejected.books ?? []) stmts.push(books.applyRemoteStmt(db, r))
    stmts.push(...books.clearAcceptedStmts(db, pushed.books ?? []))
    for (const r of rejected.progress ?? []) stmts.push(progress.applyRemoteStmt(db, r))
    stmts.push(...progress.clearAcceptedStmts(db, pushed.progress ?? []))
    for (const r of rejected.annotations ?? []) stmts.push(annotations.applyRemoteStmt(db, r))
    stmts.push(...annotations.clearAcceptedStmts(db, pushed.annotations ?? []))
    for (const r of rejected.bookmarks ?? []) stmts.push(bookmarks.applyRemoteStmt(db, r))
    stmts.push(...bookmarks.clearAcceptedStmts(db, pushed.bookmarks ?? []))
    stmts.push(...readingEvents.clearAcceptedStmts(db, pushed.readingEvents ?? []))
    return stmts
  }

  private async wipeAndResetCursor(): Promise<void> {
    await runBatch(db, [...LOCAL_TABLES.map((t) => db.delete(t)), setCursorStmt(db, 0)])
    this.cursorCache = 0
  }
}
