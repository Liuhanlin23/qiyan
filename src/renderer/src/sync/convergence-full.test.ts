// 九集合双端收敛仿真（sync.md §3 协议真源）：两三个内存库当设备，配一个逐条按 §3.2/§3.3 语义实现的
// **九集合**假服务端（sync-testkit.ts），共用一个虚拟钟交错写入、多回合同步，断言「各端各自变更、来回同步后真的收敛」。
//
// 与既有两份收敛仿真的关系（都不改、基建**复制**进 sync-testkit.ts 后扩展）：
//   - `sync/convergence.test.ts`：假服务端只有 words + reviewLogs 两集合，重点是调度 × 同步交叉；
//   - `reading/convergence.test.ts`：扩到七集合（words/reviewLogs + 阅读五集合），重点是阅读域语义。
//   两者合起来仍**从未**把 notes / settings 放进任何收敛仿真，号池全序分页也没受过九集合交错的压力。
//   本文件补齐这一层：九集合全上、每个场景都带 notes/settings 压舱，分页在九集合混流下断言无漏无重。
//
// 已接受的局限（写死在这里免得后人误会）：
//   - 回合编排在本文件内**重实现**（syncRound/pullLoop/pushDirty/reconcileStmts），逐步对齐 engine.ts 的
//     runRound（顺序 / 原子性 / 游标推进时机）。SyncEngine 类自身的接线由 `engine-wiring.test.ts` 负责。
//   - **文件侧不在范围**：engine.ts 拉到 books 墓碑后还会调 purgeRemovedBookFiles 删本机目录（fs 桥编排），
//     本文件只测数据行为，pullLoop 刻意不复刻该收尾（同 reading/convergence.test.ts）。
//   - 时钟校准不在范围（各端共用同一只虚拟钟，客户端侧不做 calibrate）。
//   - 服务端形状守卫不在范围（仿真只产合法行，`skippedInvalid` 恒 0）——守卫是 server SyncServiceTest 的领地。
//
// 虚拟钟纪律：全局单调、绝不回拨，任何落库写前先前进 ≥1ms——editTime 可区分、append-only 自然键不撞
//（撞了会被静默吞掉，账目必错）。editTime 相等的 tie 只允许在 tie 专用用例里**故意**构造。
//
// 生产与测试跑同一套数据函数：apply/collect/clear 全部用生产集合模块，本地写全部走生产业务函数
//（addWords / applyRating / setNote / clearNote / updateSettings / addBook / renameBook / removeBook /
//  saveProgress / add·update·removeAnnotation / add·removeBookmark / addReadingEvent），
// 只有「注册表外的未知设置键」没有生产写路径，按 seedWordRow 先例用裸 SQL 种行（测试内可裸 SQL）。
import { beforeEach, describe, expect, it } from 'vitest'
import type { BatchItem } from 'drizzle-orm/batch'
import { runBatch, type Db } from '@/db/client'
import {
  notes as notesCollection,
  reviewLogs as reviewLogsCollection,
  words as wordsCollection,
} from '@/wordbook/collections'
import { settings as settingsCollection } from '@/settings/collection'
import {
  annotations as annotationsCollection,
  bookmarks as bookmarksCollection,
  books as booksCollection,
  progress as progressCollection,
  readingEvents as readingEventsCollection,
} from '@/reading/collections'
import { addWords, applyRating, removeWords } from '@/wordbook/words'
import { clearNote, getNote, listNotes, setNote } from '@/wordbook/notes'
import { getSettings, updateSettings } from '@/settings/settings'
import * as annotationsData from '@/reading/annotations'
import * as bookmarksData from '@/reading/bookmarks'
import * as booksData from '@/reading/books'
import * as eventsData from '@/reading/events'
import * as progressData from '@/reading/progress'
import type { ReviewLogInput, WordRecord } from '@/wordbook/types'
import type { AnnotationRecord, BookmarkRecord } from '@/reading/types'
import type { SyncChanges } from './protocol'
import {
  bookHashOf,
  Clock,
  COLLECTIONS,
  countChanges,
  dayStartAt,
  dirtyCounts,
  dumpState,
  FakeServer,
  getCursor,
  makeDevice,
  MIN,
  NO_DIRTY,
  PULL_LIMIT,
  PUSH_BATCH,
  setCursorStmt,
  tableCounts,
  uuidOf,
  type CollName,
  type Device,
} from './sync-testkit'

/** 单个 pullLoop 的翻页安全上限。 */
const MAX_PAGES = 200

// ══════════════════ 确定性测试数据（禁用 randomUUID / Math.random / 浮点噪声） ══════════════════

/** fraction 一律取二进制可精确表示的值，排除浮点噪声干扰逐位断言。 */
const FRACTIONS = [0.25, 0.5, 0.75] as const

const hashOf = (n: number): string => bookHashOf(n)
const annId = (n: number): string => uuidOf('ann', n)
const bmId = (n: number): string => uuidOf('bm', n)

const bookInput = (n: number, title = `书 ${n}`): booksData.BookInput => ({
  bookHash: hashOf(n),
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

/** 评分落库用的词行 / 日志载荷（数值取二进制精确值，FSRS 计算不入本文件的断言面）。 */
const wordRecord = (dictId: number, now: number, reps = 1): WordRecord => ({
  dictId,
  due: now + 86_400_000,
  stability: 2.5,
  difficulty: 5.25,
  scheduledDays: 1,
  learningSteps: 0,
  reps,
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

// ══════════════════ 客户端回合（对齐 engine.ts runRound / pullLoop / pushDirty / reconcileStmts） ══════════════════

/**
 * pull 一页的应用语句，顺序**逐字对齐 engine.ts**：
 * words → notes → settings → reviewLogs → books → progress → annotations → bookmarks → readingEvents。
 * `?? []` 是必要防御：server 可能省略空集合的 key（sync.md §3.1）。
 */
function applyStmts(db: Db, c: SyncChanges): BatchItem<'sqlite'>[] {
  return [
    ...(c.words ?? []).map((r) => wordsCollection.applyRemoteStmt(db, r)),
    ...(c.notes ?? []).map((r) => notesCollection.applyRemoteStmt(db, r)),
    ...(c.settings ?? []).map((r) => settingsCollection.applyRemoteStmt(db, r)),
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
  /** 本页各集合行数（九集合混流分页断言用）。 */
  counts: Record<CollName, number>
  total: number
  changes: SyncChanges
}

const pageCounts = (c: SyncChanges): Record<CollName, number> => {
  const out = {} as Record<CollName, number>
  for (const spec of COLLECTIONS) out[spec.name] = ((c[spec.name] ?? []) as unknown[]).length
  return out
}

/**
 * pullLoop：循环 pull → 一页**所有集合的应用语句 + 游标推进合入同一 runBatch 原子提交** → `done` 为止。
 */
async function pullLoop(dev: Device, server: FakeServer, limit = PULL_LIMIT): Promise<PullPage[]> {
  const pages: PullPage[] = []
  for (let guard = 0; ; guard++) {
    if (guard > MAX_PAGES) throw new Error(`${dev.name} pullLoop 翻页超上限（疑似 done 永不为真）`)
    const since = await getCursor(dev.db)
    const res = server.pull({ since, limit })
    await runBatch(dev.db, [...applyStmts(dev.db, res.changes), setCursorStmt(dev.db, res.nextSince)])
    pages.push({
      since,
      nextSince: res.nextSince,
      done: res.done,
      counts: pageCounts(res.changes),
      total: countChanges(res.changes),
      changes: res.changes,
    })
    if (res.done) break
  }
  return pages
}

/** 收集九集合脏行（固定顺序，形态 A′，同 engine.ts collectAllDirty）。 */
async function collectAllDirty(dev: Device): Promise<Required<SyncChanges>> {
  return {
    words: await wordsCollection.collectDirty(dev.db),
    notes: await notesCollection.collectDirty(dev.db),
    settings: await settingsCollection.collectDirty(dev.db),
    reviewLogs: await reviewLogsCollection.collectDirty(dev.db),
    books: await booksCollection.collectDirty(dev.db),
    progress: await progressCollection.collectDirty(dev.db),
    annotations: await annotationsCollection.collectDirty(dev.db),
    bookmarks: await bookmarksCollection.collectDirty(dev.db),
    readingEvents: await readingEventsCollection.collectDirty(dev.db),
  }
}

/** 把九集合脏行扁平化后按 size 切块，再按集合装回 SyncChanges（同 engine.ts chunkChanges）。 */
function chunkChanges(all: Required<SyncChanges>, size: number): SyncChanges[] {
  type Tagged = { k: CollName; row: unknown }
  const tagged: Tagged[] = COLLECTIONS.flatMap((spec) =>
    (all[spec.name] as unknown[]).map((row) => ({ k: spec.name, row })),
  )
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

/**
 * push 回执对账（sync.md §3.4，顺序照抄 engine.ts reconcileStmts）：每集合**先应用 rejected**
 *（服务端赢、清 dirty/改 editTime），**再对推送批做 compare-and-clear**（被 rejected 覆盖的行快照已不匹配 → 自然跳过）。
 * reviewLogs / readingEvents 是 append-only，无 rejected（幂等静默成功），只清 dirty。
 */
function reconcileStmts(db: Db, pushed: SyncChanges, rejected: SyncChanges): BatchItem<'sqlite'>[] {
  const stmts: BatchItem<'sqlite'>[] = []
  for (const r of rejected.words ?? []) stmts.push(wordsCollection.applyRemoteStmt(db, r))
  stmts.push(...wordsCollection.clearAcceptedStmts(db, pushed.words ?? []))
  for (const r of rejected.notes ?? []) stmts.push(notesCollection.applyRemoteStmt(db, r))
  stmts.push(...notesCollection.clearAcceptedStmts(db, pushed.notes ?? []))
  for (const r of rejected.settings ?? []) stmts.push(settingsCollection.applyRemoteStmt(db, r))
  stmts.push(...settingsCollection.clearAcceptedStmts(db, pushed.settings ?? []))
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

interface PushStats {
  /** 是否有过写入（决定是否收口 pull）。 */
  pushed: boolean
  batches: number
  rows: number
  /** 本次推送被服务端拒回的 LWW 行数（LWW 输给服务端当前行）。 */
  rejected: number
  /** 逐集合的 rejected 行数。 */
  rejectedBy: Record<CollName, number>
}

/** pushDirty：收脏 → 200 行/批切块推送 → 每批 reconcile 合入同一 batch（同 engine.ts）。 */
async function pushDirty(dev: Device, server: FakeServer): Promise<PushStats> {
  const dirty = await collectAllDirty(dev)
  const rows = COLLECTIONS.reduce((n, s) => n + (dirty[s.name] as unknown[]).length, 0)
  const rejectedBy = {} as Record<CollName, number>
  for (const spec of COLLECTIONS) rejectedBy[spec.name] = 0
  if (rows === 0) return { pushed: false, batches: 0, rows: 0, rejected: 0, rejectedBy }
  let rejected = 0
  const batches = chunkChanges(dirty, PUSH_BATCH)
  for (const batch of batches) {
    const res = server.push({ changes: batch })
    await runBatch(dev.db, reconcileStmts(dev.db, batch, res.rejected ?? {}))
    for (const spec of COLLECTIONS) {
      const n = ((res.rejected?.[spec.name] ?? []) as unknown[]).length
      rejectedBy[spec.name] += n
      rejected += n
    }
  }
  return { pushed: true, batches: batches.length, rows, rejected, rejectedBy }
}

interface RoundStats {
  pulls: PullPage[]
  push: PushStats
}

/** 一回合 = pullLoop → pushDirty →（有推送则）收口 pullLoop（把自己刚发号的行拉回，幂等无害）。 */
async function syncRound(dev: Device, server: FakeServer, limit = PULL_LIMIT): Promise<RoundStats> {
  const pulls = await pullLoop(dev, server, limit)
  const push = await pushDirty(dev, server)
  if (push.pushed) pulls.push(...(await pullLoop(dev, server, limit)))
  return { pulls, push }
}

// ══════════════════ 收敛静止断言 ══════════════════

const totalDirty = (dev: Device): number =>
  COLLECTIONS.reduce((n, s) => n + dirtyCounts(dev)[s.name], 0)

/** 交替跑回合直到静止（各端均无脏行且游标一致）。 */
async function settle(devs: Device[], server: FakeServer, limit = PULL_LIMIT): Promise<number> {
  for (let i = 1; i <= 5; i++) {
    for (const dev of devs) await syncRound(dev, server, limit)
    if (devs.every((d) => totalDirty(d) === 0)) {
      const cursors: number[] = []
      for (const d of devs) cursors.push(await getCursor(d.db))
      if (new Set(cursors).size === 1) return i
    }
  }
  throw new Error('5 个来回后仍未收敛静止')
}

/**
 * 收敛静止 + 全套断言：各端**九表业务列深等**（浮点逐位、排除 dirty 列）、各端 dirty 全零、
 * 游标一致且 = 服务端最大号、两个 append-only 集合行数 = 服务端行数（并集零丢失的全局账）。
 *
 * ⚠️ 墓碑行在客户端**不存在**（LWW 墓碑应用 = 物理删本地行，服务端才留墓碑行）：
 * 「墓碑传播成功」的断言是行**消失**，不是 is_deleted=1。
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
    expect(dirtyCounts(dev), `${label} ${dev.name} 端收敛后九表无脏行`).toEqual(NO_DIRTY)
    expect(dumpState(dev), `${label} ${dev.name} 与 ${devs[0].name} 九表深等（浮点逐位）`).toEqual(base)
  }
  const cursors: number[] = []
  for (const d of devs) cursors.push(await getCursor(d.db))
  expect(new Set(cursors).size, `${label} 各端游标一致（${cursors.join('/')}）`).toBe(1)
  expect(cursors[0], `${label} 游标 = 服务端最大号`).toBe(server.maxVer())
  expect(base.reviewLogs.length, `${label} 复习日志行数 = 服务端（并集零丢失）`).toBe(
    server.count('reviewLogs'),
  )
  expect(base.readingEvents.length, `${label} 阅读事件行数 = 服务端（并集零丢失）`).toBe(
    server.count('readingEvents'),
  )
}

/** 全页里收到的 syncVer 列表（分页无漏无重断言用）。 */
const pulledVers = (pages: PullPage[]): number[] =>
  pages.flatMap((p) =>
    COLLECTIONS.flatMap((spec) =>
      ((p.changes[spec.name] ?? []) as { syncVer: number }[]).map((r) => r.syncVer),
    ),
  )

/** 注册表外的未知设置键：无生产写路径，按 seedWordRow 先例裸 SQL 种脏行（sync.md §2「未知键原样存储」）。 */
function seedUnknownSetting(dev: Device, key: string, value: string, editTime: number): void {
  dev.sqlite
    .prepare('INSERT INTO user_setting (setting_key, value, edit_time, dirty) VALUES (?,?,?,1)')
    .run(key, value, editTime)
}

const settingValue = (dev: Device, key: string): string | undefined =>
  (
    dev.sqlite.prepare('SELECT value FROM user_setting WHERE setting_key=?').get(key) as
      | { value: string }
      | undefined
  )?.value

// ══════════════════ 场景 ══════════════════

describe('九集合双端同步收敛仿真（sync.md §2 注册表 + §3 协议）', () => {
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

  /** 在一台设备上产生「九集合全家桶」变更（各集合至少一行）。返回各集合行数。 */
  async function makeAllNine(dev: Device): Promise<void> {
    await addWords(dev.db, [101, 102, 103, 104], clock.tick())
    for (const dictId of [101, 102]) {
      const t = clock.tick()
      await applyRating(dev.db, wordRecord(dictId, t), reviewLogInput(dictId, t), t)
    }
    await setNote(dev.db, 101, '第一条笔记', clock.tick())
    await setNote(dev.db, 102, '第二条笔记', clock.tick())
    await updateSettings(dev.db, { newPerDay: 33 }, clock.tick())
    for (let i = 1; i <= 2; i++) await booksData.addBook(dev.db, bookInput(i), clock.tick())
    await progressData.saveProgress(
      dev.db,
      { bookHash: hashOf(1), location: 'epubcfi(/6/2!/4/2)', fraction: FRACTIONS[0] },
      clock.tick(),
    )
    await annotationsData.addAnnotation(
      dev.db,
      annotationInput(1, hashOf(1), clock.now()),
      clock.tick(),
    )
    await bookmarksData.addBookmark(dev.db, bookmarkInput(1, hashOf(1), clock.now()), clock.tick())
    await eventsData.addReadingEvent(dev.db, {
      bookHash: hashOf(1),
      startTime: clock.tick(MIN),
      durationMs: 60_000,
      fraction: FRACTIONS[0],
    })
  }

  // ────────────────── N1 九集合全家桶接力 ──────────────────

  it('N1 九集合接力：A 产生九集合变更 → B 空库首灌（limit=7 跨集合混合翻页，无漏无重）→ B 各集合回改 → 收敛', async () => {
    const LIMIT = 7
    await makeAllNine(A)
    const sourceCounts = tableCounts(A)
    expect(sourceCounts, 'N1 源端九集合各自有行（否则后面的断言是空对空）').toEqual({
      words: 4,
      notes: 2,
      settings: 1,
      reviewLogs: 2,
      books: 2,
      progress: 1,
      annotations: 1,
      bookmarks: 1,
      readingEvents: 1,
    })

    const aRound = await syncRound(A, server)
    expect(aRound.push.rows, 'N1 九集合脏行合计 15 行').toBe(15)
    expect(server.totalRows(), 'N1 15 行全部到达服务端').toBe(15)
    expect(server.maxVer(), 'N1 号池按 §3.3 固定集合顺序发到 15').toBe(15)

    // B 空库首灌，小 limit 逼出跨集合混合翻页
    expect(tableCounts(B).words, 'N1 B 首灌前是空库').toBe(0)
    const pages = await pullLoop(B, server, LIMIT)
    expect(pages.map((p) => p.total), 'N1 15 行 / limit 7 → 7+7+1 三页').toEqual([7, 7, 1])
    expect(pages.map((p) => p.done), 'N1 只有末页 done（前两页满 limit）').toEqual([false, false, true])
    // 混合翻页的实证：至少两页各自横跨 ≥2 个集合（页边界落在集合中间）
    const spanning = pages.filter((p) => COLLECTIONS.filter((s) => p.counts[s.name] > 0).length >= 2)
    expect(spanning.length, 'N1 页边界确实落在集合中间（跨集合混合翻页）').toBeGreaterThanOrEqual(2)
    // 无漏无重：收到的 syncVer 恰是 1..15 各一次
    const vers = pulledVers(pages)
    expect(vers.length, 'N1 收到行数 = 服务端行数（无重复）').toBe(15)
    expect([...vers].sort((a, b) => a - b), 'N1 syncVer 1..15 逐个到齐（无漏行）').toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    )
    const cursors = pages.map((p) => p.nextSince)
    cursors.slice(1).forEach((v, i) =>
      expect(v, `N1 游标单调推进（${cursors.join('→')}）`).toBeGreaterThan(cursors[i]),
    )
    expect(await getCursor(B.db), 'N1 首灌后 B 游标 = 服务端最大号').toBe(server.maxVer())
    expect(tableCounts(B), 'N1 B 九表行数与源端一致').toEqual(sourceCounts)
    await settleAndAssert([A, B], server, 'N1 首灌后', LIMIT)

    // B 逐集合回改（九集合全覆盖）
    const t = clock.tick()
    await applyRating(B.db, wordRecord(103, t, 1), reviewLogInput(103, t), t) // words + reviewLogs
    await setNote(B.db, 103, 'B 写的笔记', clock.tick()) // notes
    await updateSettings(B.db, { accent: 'uk' }, clock.tick()) // settings
    await booksData.renameBook(B.db, hashOf(1), '书 1（B 改名）', clock.tick()) // books
    await progressData.saveProgress(
      B.db,
      { bookHash: hashOf(2), location: 'epubcfi(/6/4!/4/8)', fraction: FRACTIONS[1] },
      clock.tick(),
    ) // progress
    await annotationsData.addAnnotation(
      B.db,
      annotationInput(2, hashOf(2), clock.now()),
      clock.tick(),
    ) // annotations
    await bookmarksData.addBookmark(B.db, bookmarkInput(2, hashOf(2), clock.now()), clock.tick()) // bookmarks
    await eventsData.addReadingEvent(B.db, {
      bookHash: hashOf(2),
      startTime: clock.tick(MIN),
      durationMs: 45_000,
      fraction: FRACTIONS[1],
    }) // readingEvents

    await settleAndAssert([A, B], server, 'N1 B 回改后', LIMIT)

    // A 拉回后逐条读得出来（深等之外再给一层业务读路径断言）
    expect(await getNote(A.db, 103), 'N1 A 拉回 B 的笔记').toBe('B 写的笔记')
    expect((await getSettings(A.db)).accent, 'N1 A 拉回 B 的设置').toBe('uk')
    expect((await getSettings(A.db)).newPerDay, 'N1 A 自己那条设置没被冲掉（键级独立）').toBe(33)
    expect((await booksData.getBook(A.db, hashOf(1)))?.title, 'N1 A 拉回改名').toBe('书 1（B 改名）')
    expect((await progressData.getProgress(A.db, hashOf(2)))?.fraction, 'N1 A 拉回进度').toBe(
      FRACTIONS[1],
    )
    expect(await annotationsData.listAnnotations(A.db, hashOf(2)), 'N1 A 拉回标注').toHaveLength(1)
    expect(await bookmarksData.listBookmarks(A.db, hashOf(2)), 'N1 A 拉回书签').toHaveLength(1)
    expect(tableCounts(A).readingEvents, 'N1 阅读事件并集 2 段').toBe(2)
    expect(tableCounts(A).reviewLogs, 'N1 复习日志并集 3 条').toBe(3)
  })

  // ────────────────── N2 删书墓碑不连带 ──────────────────

  it('N2 删书墓碑不连带：books 行物理删而 progress/标注/书签/事件原样保留；同 hash 重导复活后旧数据直接可见', async () => {
    const X = hashOf(1)
    await makeAllNine(A)
    // 给 X 再补一条事件与一条书签，删书后的「不连带」断言才有分量
    await eventsData.addReadingEvent(A.db, {
      bookHash: X,
      startTime: clock.tick(MIN),
      durationMs: 30_000,
      fraction: FRACTIONS[1],
    })
    await bookmarksData.addBookmark(A.db, bookmarkInput(3, X, clock.now()), clock.tick())
    await settleAndAssert([A, B], server, 'N2 建账后')

    const before = tableCounts(B)
    const progressBefore = await progressData.getProgress(B.db, X)
    const annotationsBefore = await annotationsData.listAnnotations(B.db, X)
    const bookmarksBefore = await bookmarksData.listBookmarks(B.db, X)
    const eventsBefore = dumpState(B).readingEvents

    // A 删书 → 墓碑传播到 B
    await booksData.removeBook(A.db, X, clock.tick())
    await settleAndAssert([A, B], server, 'N2 删书后')

    expect(await booksData.getBook(B.db, X), 'N2 B 端 X 书行物理删（不是 is_deleted=1 的死行）').toBeNull()
    expect(
      tableCounts(B),
      'N2 除 books 外九表行数一行不少（阅读数据不连带删，sync.md §2 阅读五集合约定）',
    ).toEqual({ ...before, books: before.books - 1 })
    expect(await progressData.getProgress(B.db, X), 'N2 X 的进度行原样保留').toEqual(progressBefore)
    expect(await annotationsData.listAnnotations(B.db, X), 'N2 X 的标注原样保留').toEqual(
      annotationsBefore,
    )
    expect(await bookmarksData.listBookmarks(B.db, X), 'N2 X 的书签原样保留').toEqual(bookmarksBefore)
    expect(dumpState(B).readingEvents, 'N2 X 的阅读事件原样保留').toEqual(eventsBefore)
    expect(server.rowOf('books', X)?.isDeleted, 'N2 服务端保留墓碑行').toBe(1)

    // A 重导入同一 hash（本地墓碑已被 compare-and-clear 物理删 → 走普通 insert + 新 editTime）
    await booksData.addBook(A.db, bookInput(1, '重新导入的书 1'), clock.tick())
    await settleAndAssert([A, B], server, 'N2 重导复活后')
    expect((await booksData.getBook(B.db, X))?.isDeleted, 'N2 B 端书行复活').toBe(0)
    expect((await booksData.getBook(B.db, X))?.title, 'N2 复活带的是新元数据').toBe('重新导入的书 1')
    expect(server.rowOf('books', X)?.isDeleted, 'N2 服务端墓碑被复活写按 LWW 覆盖').toBe(0)
    // 旧阅读数据一直没动过，复活后立刻可见
    expect(await progressData.getProgress(B.db, X), 'N2 复活即拿回旧进度').toEqual(progressBefore)
    expect(await annotationsData.listAnnotations(B.db, X), 'N2 复活即拿回旧标注').toEqual(
      annotationsBefore,
    )
    expect(await bookmarksData.listBookmarks(B.db, X), 'N2 复活即拿回旧书签').toEqual(bookmarksBefore)
  })

  // ────────────────── N3 progress 无墓碑 LWW ──────────────────

  it('N3 progress 无墓碑 LWW：两端离线读同一本书 → 后写方整行在两端胜出（往返两轮，仲裁方向不粘滞）', async () => {
    const H = hashOf(1)
    await booksData.addBook(A.db, bookInput(1), clock.tick())
    await updateSettings(A.db, { readingFontSize: 20 }, clock.tick()) // 压舱：settings 同批参与
    await settleAndAssert([A, B], server, 'N3 建书后')

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
    expect((await progressData.getProgress(A.db, H))?.fraction, 'N3 同步前 A 本地是自己的 0.25').toBe(
      FRACTIONS[0],
    )
    await settleAndAssert([A, B], server, 'N3 第一轮交错后')
    expect(bVersion, 'N3 B 版本整行（location/fraction/lastReadAt）').toEqual({
      bookHash: H,
      location: 'epubcfi(/6/6!/4/10)',
      fraction: FRACTIONS[1],
      lastReadAt: tB,
    })
    expect(await progressData.getProgress(A.db, H), 'N3 A 收敛为 B 版本（后写赢，整行覆盖）').toEqual(
      bVersion,
    )
    expect(server.rowOf('progress', H)?.editTime, 'N3 服务端 progress 行 editTime = 后写方').toBe(tB)

    // 反向再来一轮：A 后写 → 仲裁方向不粘滞
    const tA2 = clock.tick(5 * MIN)
    await progressData.saveProgress(
      A.db,
      { bookHash: H, location: 'epubcfi(/6/8!/4/4)', fraction: FRACTIONS[2] },
      tA2,
    )
    const aVersion = await progressData.getProgress(A.db, H)
    await settleAndAssert([A, B], server, 'N3 第二轮交错后')
    expect(await progressData.getProgress(B.db, H), 'N3 B 收敛为 A 版本（方向反转，无粘滞）').toEqual(
      aVersion,
    )
  })

  it('N3-tie progress editTime 恰好相等：服务端 >= 覆盖（后推端赢）+ 客户端 tie 远端赢，两端仲裁互补最终一致', async () => {
    const H = hashOf(1)
    await booksData.addBook(A.db, bookInput(1), clock.tick())
    await settleAndAssert([A, B], server, 'N3-tie 建书后')

    // 故意构造 editTime tie（本文件唯一允许同刻写库之处）
    const t = clock.tick()
    await progressData.saveProgress(
      A.db,
      { bookHash: H, location: 'A 的位置', fraction: FRACTIONS[0] },
      t,
    )
    await progressData.saveProgress(
      B.db,
      { bookHash: H, location: 'B 的位置', fraction: FRACTIONS[2] },
      t,
    )

    // 真实网络交错：B 的回合 pull 阶段先于 A 的推送，push 阶段后于 A 的推送
    await pullLoop(B, server)
    await syncRound(A, server)
    expect(server.rowOf('progress', H)?.location, 'N3-tie 服务端先收下 A 的行').toBe('A 的位置')

    await pushDirty(B, server)
    expect(server.rowOf('progress', H)?.location, 'N3-tie 服务端 >= 语义：等值 editTime 仍被后推端覆盖').toBe(
      'B 的位置',
    )
    await pullLoop(B, server) // 收口

    await syncRound(A, server)
    expect((await progressData.getProgress(A.db, H))?.location, 'N3-tie 客户端 tie 远端赢：A 收敛到 B 版本').toBe(
      'B 的位置',
    )
    await settleAndAssert([A, B], server, 'N3-tie')
  })

  // ────────────────── N4 标注 UUID 键 ──────────────────

  it('N4 标注 UUID 键：两端各创建 → 并集都存活；同条双端改 → 后写整行赢；A 删 → B 端物理删', async () => {
    const H = hashOf(1)
    await booksData.addBook(A.db, bookInput(1), clock.tick())
    await setNote(A.db, 201, '压舱笔记', clock.tick()) // 压舱：notes 同批参与
    await settleAndAssert([A, B], server, 'N4 建书后')

    // ① 两端各自离线创建标注（不同 UUID）→ 并集都存活
    const createdAt1 = clock.now()
    await annotationsData.addAnnotation(A.db, annotationInput(1, H, createdAt1), clock.tick())
    await annotationsData.addAnnotation(B.db, annotationInput(2, H, clock.now()), clock.tick())
    await settleAndAssert([A, B], server, 'N4 并集后')
    expect(
      (await annotationsData.listAnnotations(A.db, H)).map((a) => a.id).sort(),
      'N4 UUID 键天然不冲突 → 两端并集',
    ).toEqual([annId(1), annId(2)].sort())
    expect(tableCounts(A).annotations, 'N4 标注行数 = 两端创建数之和').toBe(2)

    // ② 同一条标注两端离线改（A 改 color、B 改 note）→ 后写赢（LWW 整行覆盖）
    const tA = clock.tick()
    await annotationsData.updateAnnotation(A.db, annId(1), { color: 'green' }, tA)
    const tB = clock.tick(5 * MIN)
    await annotationsData.updateAnnotation(B.db, annId(1), { note: 'B 写的笔记' }, tB)
    expect(
      (await annotationsData.listAnnotations(A.db, H)).find((a) => a.id === annId(1))?.color,
      'N4 同步前 A 本地确实是 green（否则下面的断言空转）',
    ).toBe('green')
    await settleAndAssert([A, B], server, 'N4 同条双改后')
    const converged = (await annotationsData.listAnnotations(A.db, H)).find((a) => a.id === annId(1))!
    expect(converged.note, 'N4 收敛为后写方（B）整行').toBe('B 写的笔记')
    // ⚠️ A 的改色丢失是 LWW **整行覆盖**的协议预期（无字段级 merge）——断言它，不是 bug。
    expect(converged.color, 'N4 A 的改色被 B 整行覆盖冲掉（协议预期，非 bug）').toBe('yellow')
    expect(converged.createdAt, 'N4 createdAt 编辑不刷新，随行整覆盖').toBe(createdAt1)

    // ③ A 删标注 → B 端物理删
    await annotationsData.removeAnnotation(A.db, annId(1), clock.tick())
    await settleAndAssert([A, B], server, 'N4 删标注后')
    expect(tableCounts(B).annotations, 'N4 标注行数 = 创建数 2 − 删除数 1').toBe(1)
    expect(
      (await annotationsData.listAnnotations(B.db, H)).map((a) => a.id),
      'N4 B 端只剩另一条',
    ).toEqual([annId(2)])
    expect(server.rowOf('annotations', annId(1))?.isDeleted, 'N4 服务端保留墓碑行').toBe(1)
  })

  // ────────────────── N5 settings 键级 LWW 走完整协议 ──────────────────

  it('N5 settings 键级 LWW：并发改不同键都存活、同键后写赢、注册表外未知键原样往返不丢', async () => {
    // ① 两端并发改**不同**键 → 都存活（键级独立，不互相整行覆盖）
    await updateSettings(A.db, { newPerDay: 33 }, clock.tick())
    await updateSettings(B.db, { accent: 'uk' }, clock.tick())
    await settleAndAssert([A, B], server, 'N5 并发改不同键后')
    for (const dev of [A, B]) {
      expect(await getSettings(dev.db), `N5 ${dev.name} 两键都在（键级独立）`).toMatchObject({
        newPerDay: 33,
        accent: 'uk',
      })
    }
    expect(tableCounts(A).settings, 'N5 只产生两行（未改的键不落库，默认值不入流）').toBe(2)

    // ② 两端并发改**同一**键 → 后写赢
    const tA = clock.tick()
    await updateSettings(A.db, { newPerDay: 11 }, tA)
    const tB = clock.tick(5 * MIN)
    await updateSettings(B.db, { newPerDay: 77 }, tB)
    await settleAndAssert([A, B], server, 'N5 并发改同键后')
    for (const dev of [A, B]) {
      expect((await getSettings(dev.db)).newPerDay, `N5 ${dev.name} 同键后写赢`).toBe(77)
    }
    expect(server.rowOf('settings', 'wordbook.newPerDay')?.editTime, 'N5 服务端该键 editTime = 后写方').toBe(
      tB,
    )

    // ③ 注册表外未知键：原样存储、照常参与同步、UI 不解释（sync.md §2 settings 集合约定）
    seedUnknownSetting(A, 'foo.barBaz', JSON.stringify('未来版本的设置'), clock.tick())
    await settleAndAssert([A, B], server, 'N5 未知键往返后')
    expect(settingValue(A, 'foo.barBaz'), 'N5 未知键在 A 端原样保留').toBe('"未来版本的设置"')
    expect(settingValue(B, 'foo.barBaz'), 'N5 未知键原样同步到 B（不丢、不被解释）').toBe(
      '"未来版本的设置"',
    )
    expect(server.rowOf('settings', 'foo.barBaz')?.value, 'N5 服务端把未知键当普通 opaque 值收下').toBe(
      '"未来版本的设置"',
    )
    // 未知键不干扰已知键的装配（读路径忽略未知键）
    expect(await getSettings(B.db), 'N5 已知键装配不受未知键影响').toMatchObject({
      newPerDay: 77,
      accent: 'uk',
    })
  })

  // ────────────────── N6 notes 墓碑与复活 ──────────────────

  it('N6 notes 墓碑与复活：A 写 → B 删（clearNote 墓碑）→ A 物理删 → A 重写复活 → 每步九表深等', async () => {
    await addWords(A.db, [301, 302], clock.tick()) // 压舱：words 同批参与
    await setNote(A.db, 301, 'A 的原始笔记', clock.tick())
    await setNote(A.db, 302, '对照笔记（全程不动）', clock.tick())
    await settleAndAssert([A, B], server, 'N6 A 写笔记后')
    expect(await getNote(B.db, 301), 'N6 B 拉到笔记').toBe('A 的原始笔记')

    // B 删（clearNote = 置墓碑传播）
    await clearNote(B.db, 301, clock.tick())
    expect(
      (B.sqlite.prepare('SELECT is_deleted AS d FROM user_word_note WHERE dict_id=301').get() as {
        d: number
      }).d,
      'N6 B 本地先是墓碑行（未推送前）',
    ).toBe(1)
    await settleAndAssert([A, B], server, 'N6 B 删笔记后')
    expect(await getNote(A.db, 301), 'N6 A 收敛：笔记消失').toBeNull()
    expect(
      tableCounts(A).notes,
      'N6 两端墓碑应用 = 物理删（只剩对照笔记一行，客户端不留死行）',
    ).toBe(1)
    expect(server.rowOf('notes', '301')?.isDeleted, 'N6 服务端保留墓碑行').toBe(1)
    expect(await getNote(A.db, 302), 'N6 对照笔记不受影响').toBe('对照笔记（全程不动）')

    // A 重写（setNote 复活）
    await setNote(A.db, 301, 'A 重写的笔记', clock.tick())
    await settleAndAssert([A, B], server, 'N6 A 重写复活后')
    expect(await getNote(B.db, 301), 'N6 B 端笔记复活').toBe('A 重写的笔记')
    expect(server.rowOf('notes', '301')?.isDeleted, 'N6 服务端墓碑被复活写按 LWW 覆盖').toBe(0)
    expect((await listNotes(B.db)).map((n) => n.dictId), 'N6 B 端两条笔记都在').toEqual([301, 302])
  })

  // ────────────────── N7 readingEvents append-only ──────────────────

  it('N7 readingEvents append-only：两端片段并集零丢失；同一批载荷原样重推 → 行数/内容/号池不变、无 rejected', async () => {
    for (let i = 1; i <= 2; i++) await booksData.addBook(A.db, bookInput(i), clock.tick())
    await settleAndAssert([A, B], server, 'N7 建书后')

    const addEvent = async (dev: Device, n: number, frac: number): Promise<void> => {
      await eventsData.addReadingEvent(dev.db, {
        bookHash: hashOf(n),
        startTime: clock.tick(MIN),
        durationMs: 30_000,
        fraction: frac,
      })
    }
    for (const [dev, plan] of [
      [A, [1, 2, 1]],
      [B, [2, 1, 2]],
    ] as const) {
      for (const [i, n] of plan.entries()) await addEvent(dev, n, FRACTIONS[i % 3])
    }
    // 顺手让本批同时含 LWW 脏行（重放幂等要在混合载荷下成立）
    await progressData.saveProgress(
      A.db,
      { bookHash: hashOf(1), location: 'epubcfi(/6/2!/4/6)', fraction: FRACTIONS[2] },
      clock.tick(),
    )

    // 抓住 A 本回合真正发出去的 wire 载荷（模拟网络重试后客户端原样重推）
    const dirty = await collectAllDirty(A)
    const replayBatches = chunkChanges(dirty, PUSH_BATCH).map((b) =>
      JSON.parse(JSON.stringify(b)) as SyncChanges,
    )
    expect(
      replayBatches.reduce((n, b) => n + (b.readingEvents ?? []).length, 0),
      'N7 抓到的载荷确实含事件行',
    ).toBe(3)

    await settleAndAssert([A, B], server, 'N7 并集后')
    expect(tableCounts(A).readingEvents, 'N7 两端各持 6 段并集（零丢失）').toBe(6)
    expect(server.count('readingEvents'), 'N7 服务端同样 6 段').toBe(6)

    // 重放幂等：同一批载荷原样重发
    const contentBefore = server.contentSnapshot()
    const rowsBefore = server.count('readingEvents')
    const verBefore = server.maxVer()
    for (const batch of replayBatches) {
      const res = server.push({ changes: batch })
      expect(res.rejected.readingEvents ?? [], 'N7 append-only 永不进 rejected').toEqual([])
      expect(res.rejected.progress ?? [], 'N7 LWW 等值 editTime 重放也不进 rejected（>= 语义）').toEqual(
        [],
      )
      expect(res.skippedInvalid ?? 0, 'N7 仿真只产合法行').toBe(0)
    }
    expect(server.count('readingEvents'), 'N7 重放后事件行数不变（唯一键幂等）').toBe(rowsBefore)
    expect(server.contentSnapshot().readingEvents, 'N7 事件内容快照逐字段不变').toEqual(
      contentBefore.readingEvents,
    )
    expect(server.maxVer(), 'N7 重复的 append-only 行不获得新号').toBeGreaterThanOrEqual(verBefore)
    await settleAndAssert([A, B], server, 'N7 重放后')
    expect(tableCounts(A).readingEvents, 'N7 重放不产生重复行').toBe(6)
  })

  // ────────────────── N8 rejected 走阅读集合 ──────────────────

  it('N8 rejected 走阅读集合：B 的落后脏行被拒 → 同 batch 先 apply 后 compare-and-clear → 就地收敛、不反复重推', async () => {
    const H = hashOf(1)
    await booksData.addBook(A.db, bookInput(1, '原书名'), clock.tick())
    await progressData.saveProgress(
      A.db,
      { bookHash: H, location: '起点', fraction: FRACTIONS[0] },
      clock.tick(),
    )
    await annotationsData.addAnnotation(A.db, annotationInput(1, H, clock.now()), clock.tick())
    await settleAndAssert([A, B], server, 'N8 建账后')

    // 两端离线各改同三行：B 早（tB）、A 晚（tA）
    const tB = clock.tick()
    await booksData.renameBook(B.db, H, 'B 改的书名', tB)
    await progressData.saveProgress(B.db, { bookHash: H, location: 'B 的位置', fraction: FRACTIONS[1] }, tB)
    await annotationsData.updateAnnotation(B.db, annId(1), { note: 'B 的笔记' }, tB)
    const tA = clock.tick(5 * MIN)
    await booksData.renameBook(A.db, H, 'A 改的书名', tA)
    await progressData.saveProgress(A.db, { bookHash: H, location: 'A 的位置', fraction: FRACTIONS[2] }, tA)
    await annotationsData.updateAnnotation(A.db, annId(1), { note: 'A 的笔记' }, tA)

    // 走到 rejected 的唯一路径：B 的 pull 阶段早于 A 的推送、push 阶段晚于 A 的推送
    await pullLoop(B, server)
    await syncRound(A, server)
    expect(server.rowOf('books', H)?.editTime, 'N8 服务端已是 A 的版本').toBe(tA)

    const push = await pushDirty(B, server)
    expect(push.rejectedBy.books, 'N8 books 落后行被拒回').toBe(1)
    expect(push.rejectedBy.progress, 'N8 progress 落后行被拒回').toBe(1)
    expect(push.rejectedBy.annotations, 'N8 annotations 落后行被拒回').toBe(1)
    expect(push.rejected, 'N8 三行全部被拒').toBe(3)

    // rejected 行同 batch 内就地应用 → B 已收敛到服务端版本；被拒行的 dirty 由 applyRemote 清掉
    expect((await booksData.getBook(B.db, H))?.title, 'N8 B 就地收敛到服务端书名').toBe('A 改的书名')
    expect((await progressData.getProgress(B.db, H))?.location, 'N8 B 就地收敛到服务端进度').toBe(
      'A 的位置',
    )
    expect(
      (await annotationsData.listAnnotations(B.db, H))[0].note,
      'N8 B 就地收敛到服务端标注',
    ).toBe('A 的笔记')
    expect(dirtyCounts(B), 'N8 被拒行的 dirty 已清零（不再重推）').toEqual(NO_DIRTY)

    // 第二回合 push 行数为 0：不反复重推
    const push2 = await pushDirty(B, server)
    expect(push2.rows, 'N8 第二回合无脏行可推').toBe(0)
    expect(push2.pushed, 'N8 空 push 短路（不发请求）').toBe(false)

    await pullLoop(B, server) // 收口
    await settleAndAssert([A, B], server, 'N8')
  })

  // ────────────────── N9 首灌跳墓碑 ──────────────────

  it('N9 首灌跳墓碑：C 新设备只拿存活行，五个有墓碑集合零死行；settings/progress/两 append-only 不受影响；后续增量照常收墓碑', async () => {
    const C = makeDevice('C')
    const X = hashOf(1) // 存活的书
    const Y = hashOf(2) // 待删的书

    await makeAllNine(A) // words 101-104 / notes 101,102 / settings / books 1,2 / progress 1 / ann 1 / bm 1 / event 1
    await annotationsData.addAnnotation(A.db, annotationInput(2, Y, clock.now()), clock.tick())
    await bookmarksData.addBookmark(A.db, bookmarkInput(2, Y, clock.now()), clock.tick())
    await progressData.saveProgress(
      A.db,
      { bookHash: Y, location: 'Y 的位置', fraction: FRACTIONS[1] },
      clock.tick(),
    )
    await settleAndAssert([A, B], server, 'N9 建账后')

    // A 删词、删笔记、删书、删标注、删书签（五个有墓碑集合各一条）
    await removeWords(A.db, [104], clock.tick())
    await clearNote(A.db, 102, clock.tick())
    await booksData.removeBook(A.db, Y, clock.tick())
    await annotationsData.removeAnnotation(A.db, annId(2), clock.tick())
    await bookmarksData.removeBookmark(A.db, bmId(2), clock.tick())
    await settleAndAssert([A, B], server, 'N9 删除后')
    for (const coll of ['words', 'notes', 'books', 'annotations', 'bookmarks'] as const) {
      expect(
        server.rowsOf(coll).filter((r) => r.isDeleted === 1).length,
        `N9 服务端 ${coll} 留有墓碑行`,
      ).toBe(1)
    }

    // C 首灌（since=0）
    const pages = await pullLoop(C, server)
    const firstLoadRows = pages.flatMap((p) =>
      COLLECTIONS.flatMap((spec) => (p.changes[spec.name] ?? []) as { isDeleted?: number }[]),
    )
    expect(firstLoadRows.length, 'N9 C 首灌确实收到了行').toBeGreaterThan(0)
    expect(
      firstLoadRows.filter((r) => r.isDeleted === 1),
      'N9 首灌不下发任何墓碑行（sync.md §3.2）',
    ).toEqual([])
    // 五个有墓碑集合：C 库里无死行，行数 = 存活行数（与已收敛的 A 一致）
    expect(tableCounts(C), 'N9 C 九表行数与已收敛的 A 完全一致（无死行、无遗漏）').toEqual(tableCounts(A))
    expect(
      C.sqlite.prepare('SELECT count(*) AS n FROM user_word WHERE is_deleted=1').get(),
      'N9 C 的 user_word 无死行',
    ).toEqual({ n: 0 })
    // settings / progress / 两个 append-only 不受首灌跳墓碑影响（无墓碑概念）
    expect(tableCounts(C).settings, 'N9 settings 照常全量到达').toBe(tableCounts(A).settings)
    expect(tableCounts(C).progress, 'N9 progress 照常全量到达（含被删书 Y 的进度）').toBe(2)
    expect(await progressData.getProgress(C.db, Y), 'N9 被删书的进度照常到达（幽灵数据合法）').not.toBeNull()
    expect(tableCounts(C).reviewLogs, 'N9 reviewLogs 照常全量到达').toBe(tableCounts(A).reviewLogs)
    expect(tableCounts(C).readingEvents, 'N9 readingEvents 照常全量到达').toBe(
      tableCounts(A).readingEvents,
    )
    expect(dumpState(C), 'N9 C 首灌后与 A 九表深等').toEqual(dumpState(A))

    // 首灌**只跳墓碑、不跳号**：游标 = 本页纳入的最大 syncVer（sync.md §3.2），停在最后一条**存活**行的号上，
    // 低于那 5 条墓碑的号。于是紧接着的一次增量会把这 5 条墓碑原样补送一遍——对新库是幂等 no-op
    //（删不存在的行），不是 bug；钉住它免得后人把「首灌跳墓碑」误读成「墓碑永不到达新设备」。
    const liveMax = Math.max(
      ...COLLECTIONS.flatMap((s) =>
        server.rowsOf(s.name).filter((r) => r.isDeleted !== 1).map((r) => r.syncVer as number),
      ),
    )
    expect(await getCursor(C.db), 'N9 首灌游标 = 最后一条存活行的号（跳过的墓碑号未被跨过）').toBe(liveMax)
    const countsAfterFirstLoad = tableCounts(C)
    const catchUp = await pullLoop(C, server)
    const catchUpRows = catchUp.flatMap((p) =>
      COLLECTIONS.flatMap((spec) => (p.changes[spec.name] ?? []) as { isDeleted?: number }[]),
    )
    expect(catchUpRows.length, 'N9 紧接着的增量补送那 5 条被首灌跳过的墓碑').toBe(5)
    expect(
      catchUpRows.every((r) => r.isDeleted === 1),
      'N9 补送的全是墓碑行',
    ).toBe(true)
    expect(tableCounts(C), 'N9 补送的墓碑对新库是幂等 no-op（九表行数一行不变）').toEqual(
      countsAfterFirstLoad,
    )
    expect(await getCursor(C.db), 'N9 补送后游标追平服务端最大号').toBe(server.maxVer())

    // C 的后续增量（since > 0）能收到**新**墓碑
    await annotationsData.removeAnnotation(A.db, annId(1), clock.tick())
    await syncRound(A, server)
    const inc = await pullLoop(C, server)
    const tombstones = inc.flatMap((p) => (p.changes.annotations ?? []).filter((r) => r.isDeleted === 1))
    expect(tombstones.map((r) => r.annotationId), 'N9 老游标照常收到新墓碑').toEqual([annId(1)])
    expect(tableCounts(C).annotations, 'N9 C 应用墓碑 = 物理删本地行').toBe(0)

    await settleAndAssert([A, B, C], server, 'N9 三端')
  })
})
