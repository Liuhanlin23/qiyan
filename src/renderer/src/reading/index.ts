// 阅读域（reading）门面 —— 页面/组件的唯一入口。两件事：
// ① 对 `vendor/foliate-js` 阅读引擎的收口（见 vendor/foliate-js/VENDOR.md），不深入 vendor 内部模块；
// ② 数据侧绑定库单例 db + 用校准钟同步取 editTime，组合 books/annotations/bookmarks/progress 等纯函数原语
//（同 wordbook 门面惯例）。写一律走变更流（dirty 累积，由引擎下一跳/手动 push，sync.md §3.4 无写后触发）。
import { db } from '@/db/client'
import { calibratedNowSync } from '@/sync/clock'
import * as annotations from './annotations'
import * as bookmarks from './bookmarks'
import * as books from './books'
import * as progress from './progress'
import * as tracking from './tracking'
import type { AnnotationRecord, BookRecord, BookmarkRecord, ProgressRecord } from './types'

export { createFoliateEngine } from './engine/foliateEngine'
export type {
  FoliateEngine,
  FoliateLocation,
  FoliateLoadDetail,
  OverlayStyle,
  EngineAnnotation,
  EngineSelection,
  EngineAnnotationHit,
  HandlePoint,
  RangeHandles,
  TocNode,
  TtsSentence,
  AppearanceParams,
  PaginationMap,
} from './engine/foliateEngine'
// CFI 归章与比较（标注/书签按章分组、组内按真位置排序）——vendor epubcfi 的收口。
export { compareCfi, findTocItemByCfi, isCfiInSection } from './engine/cfi'
export type { CfiRange } from './engine/cfi'
// 划词取词（查词专用，docs/feature/reading/lookup.md §取词）：清洗在引擎侧算好并随选区回抛，
// 页面只判可查性（空 → 隐藏入口 / 超长 → 降级到翻译）与文案。
// `cleanLookupTerm` 也供点中已有高亮时取词用（那条路径没有活选区，直接清洗标注文字）。
export { cleanLookupTerm, judgeLookupTerm, LOOKUP_MAX_WORDS } from './engine/lookupTerm'
export type { LookupTermVerdict } from './engine/lookupTerm'
export type {
  BookRecord,
  ShelfBook,
  AnnotationRecord,
  BookmarkRecord,
  ProgressRecord,
  ReadingEventRecord,
  HighlightColor,
  HighlightStyle,
} from './types'
export type { AnnotationPatch } from './annotations'
export type { ReadingTracker } from './tracking'

// ── 书架（user_book，db/05）──
// 增删走 library 的编排（书文件与表行必须同进同出），不单独暴露裸原语。

export { importBook, openBookFile, deleteBook, listShelf, purgeRemovedBookFiles } from './library'
export type { ImportResult } from './library'
/** 取一本（含墓碑行）：开书按 hash 取元数据；导入流程据 isDeleted 区分「已在书架」与「可复活」。 */
export const getBook = (bookHash: string): Promise<BookRecord | null> => books.getBook(db, bookHash)

// ── 标注（user_book_annotation，db/05）──
// id 由调用方生成（crypto.randomUUID）；改色/改线型/写笔记走 update，删除置墓碑。

export const listAnnotations = (bookHash: string): Promise<AnnotationRecord[]> =>
  annotations.listAnnotations(db, bookHash)
/**
 * 造一条新标注（盖 id 与 createdAt，**不落库**）：页面要先把它挂上屏、再异步落库，
 * 而 id（自然键 UUID）与校准时钟都归数据侧管，故由门面在此一并盖好。
 */
export const newAnnotation = (a: Omit<AnnotationRecord, 'id' | 'createdAt'>): AnnotationRecord => ({
  ...a,
  id: crypto.randomUUID(),
  createdAt: calibratedNowSync(),
})
export const addAnnotation = (a: AnnotationRecord): Promise<void> =>
  annotations.addAnnotation(db, a, calibratedNowSync())
export const updateAnnotation = (id: string, patch: annotations.AnnotationPatch): Promise<void> =>
  annotations.updateAnnotation(db, id, patch, calibratedNowSync())
export const removeAnnotation = (id: string): Promise<void> =>
  annotations.removeAnnotation(db, id, calibratedNowSync())

// ── 书签（user_book_bookmark，db/05）──

export const listBookmarks = (bookHash: string): Promise<BookmarkRecord[]> =>
  bookmarks.listBookmarks(db, bookHash)
/** 造一条新书签（同 newAnnotation：盖 id + createdAt，不落库）。 */
export const newBookmark = (b: Omit<BookmarkRecord, 'id' | 'createdAt'>): BookmarkRecord => ({
  ...b,
  id: crypto.randomUUID(),
  createdAt: calibratedNowSync(),
})
export const addBookmark = (b: BookmarkRecord): Promise<void> =>
  bookmarks.addBookmark(db, b, calibratedNowSync())
export const renameBookmark = (id: string, title: string): Promise<void> =>
  bookmarks.renameBookmark(db, id, title, calibratedNowSync())
export const removeBookmark = (id: string): Promise<void> =>
  bookmarks.removeBookmark(db, id, calibratedNowSync())

// ── 阅读进度（user_book_progress，db/05）──

/** 取上次读到哪（无进度行返回 null）。 */
export const getProgress = (bookHash: string): Promise<ProgressRecord | null> =>
  progress.getProgress(db, bookHash)
/** 记进度（每书一行 upsert）。调用方负责去抖与关书前 flush。 */
export const saveProgress = (bookHash: string, location: string, fraction: number): Promise<void> =>
  progress.saveProgress(db, { bookHash, location, fraction }, calibratedNowSync())

// ── 阅读事件（user_reading_event，db/05）──

/**
 * 造一本书的阅读计时器（无 UI，只采集）：页面喂位置变化与「停了」，它按片段落 append-only 事件。
 * 空闲截断与秒↔毫秒换算都在域内，页面只管四个触发点。关书务必 `stop()` 结算。
 */
export const createReadingTracker = (bookHash: string): tracking.ReadingTracker =>
  tracking.createReadingTracker(db, bookHash, calibratedNowSync)
