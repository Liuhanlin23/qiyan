// reading 同步件（形态 A′，sync.md §3.5）：五件 books / progress / annotations / bookmarks / readingEvents。
// 前四件由 lwwCollection 参数化生成（progress 无墓碑，其余三件有），readingEvents 手写 append-only
//（apply = INSERT OR IGNORE，clear 按自然键 + dirty=1，行不可变无需比对 edit_time）——与 wordbook/collections 同构。
// engine 从这里显式导入五件，接在既有 words→notes→settings→reviewLogs 之后按固定顺序调用。
//
// 注：本文件只管「行怎么进出变更流」。删书墓碑拉到后还要删本机 books/<hash>/ 目录，那是文件侧编排，
// 住 ./library 的 purgeRemovedBookFiles（本模块不碰 fs 桥）。
import { and, eq } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Db } from '@/db/client'
import {
  userBook,
  userBookAnnotation,
  userBookBookmark,
  userBookProgress,
  userReadingEvent,
} from '@/db/schema'
import { lwwCollection, type LwwCollection } from '@/sync/lww'
import type {
  AnnotationRow,
  BookRow,
  BookmarkRow,
  ProgressRow,
  ReadingEventRow,
} from '@/sync/protocol'

/** books：LWW，自然键 bookHash，有墓碑（墓碑 = 删书，跨端传播）。 */
export const books: LwwCollection<BookRow> = lwwCollection<BookRow>({
  table: userBook,
  key: [{ col: userBook.bookHash, prop: 'bookHash', wire: true }],
  payload: [
    { col: userBook.title, prop: 'title', default: '' },
    { col: userBook.author, prop: 'author', default: '' },
    { col: userBook.format, prop: 'format', default: 'epub' },
    { col: userBook.importedAt, prop: 'importedAt', default: 0 },
  ],
  hasTombstone: true,
})

/** progress：LWW，自然键 bookHash，无墓碑（进度不可删，同 settings 集合）。 */
export const progress: LwwCollection<ProgressRow> = lwwCollection<ProgressRow>({
  table: userBookProgress,
  key: [{ col: userBookProgress.bookHash, prop: 'bookHash', wire: true }],
  payload: [
    { col: userBookProgress.location, prop: 'location', default: '' },
    { col: userBookProgress.fraction, prop: 'fraction', default: 0 },
    { col: userBookProgress.lastReadAt, prop: 'lastReadAt', default: 0 },
  ],
  hasTombstone: false,
})

/** annotations：LWW，自然键 annotationId（客户端 UUID），有墓碑。 */
export const annotations: LwwCollection<AnnotationRow> = lwwCollection<AnnotationRow>({
  table: userBookAnnotation,
  key: [{ col: userBookAnnotation.annotationId, prop: 'annotationId', wire: true }],
  payload: [
    { col: userBookAnnotation.bookHash, prop: 'bookHash', default: '' },
    { col: userBookAnnotation.cfi, prop: 'cfi', default: '' },
    { col: userBookAnnotation.text, prop: 'text', default: '' },
    { col: userBookAnnotation.color, prop: 'color', default: 'yellow' },
    { col: userBookAnnotation.style, prop: 'style', default: 'fill' },
    { col: userBookAnnotation.note, prop: 'note', default: '' },
    { col: userBookAnnotation.createdAt, prop: 'createdAt', default: 0 },
  ],
  hasTombstone: true,
})

/** bookmarks：LWW，自然键 bookmarkId（客户端 UUID），有墓碑。 */
export const bookmarks: LwwCollection<BookmarkRow> = lwwCollection<BookmarkRow>({
  table: userBookBookmark,
  key: [{ col: userBookBookmark.bookmarkId, prop: 'bookmarkId', wire: true }],
  payload: [
    { col: userBookBookmark.bookHash, prop: 'bookHash', default: '' },
    { col: userBookBookmark.cfi, prop: 'cfi', default: '' },
    { col: userBookBookmark.title, prop: 'title', default: '' },
    { col: userBookBookmark.createdAt, prop: 'createdAt', default: 0 },
  ],
  hasTombstone: true,
})

// ────────────────── readingEvents：append-only（手写，照 reviewLogs） ──────────────────

/** 自然键谓词 (bookHash, startTime)。 */
function readingEventKey(row: ReadingEventRow) {
  return and(
    eq(userReadingEvent.bookHash, row.bookHash),
    eq(userReadingEvent.startTime, row.startTime),
  )
}

/** readingEvents 三件套：apply 幂等去重（INSERT OR IGNORE）、clear 按自然键 + dirty=1（无 editTime 比对）。 */
export const readingEvents = {
  async collectDirty(db: Db): Promise<ReadingEventRow[]> {
    const rows = await db.select().from(userReadingEvent).where(eq(userReadingEvent.dirty, 1)).all()
    return rows.map(
      (r): ReadingEventRow => ({
        syncVer: 0,
        bookHash: r.bookHash,
        startTime: r.startTime,
        durationMs: r.durationMs,
        fraction: r.fraction,
      }),
    )
  },

  /** 幂等插入：唯一键冲突静默忽略（重复推送/回拉无副作用）；下行的 syncVer 不落地。 */
  applyRemoteStmt(db: Db, row: ReadingEventRow): BatchItem<'sqlite'> {
    return db
      .insert(userReadingEvent)
      .values({
        bookHash: row.bookHash,
        startTime: row.startTime,
        durationMs: row.durationMs,
        fraction: row.fraction,
        dirty: 0,
      })
      .onConflictDoNothing()
  },

  /** push 被接受后清 dirty：行不可变，按 (自然键, dirty=1) 收口即可。 */
  clearAcceptedStmts(db: Db, rows: readonly ReadingEventRow[]): BatchItem<'sqlite'>[] {
    return rows.map((row) =>
      db
        .update(userReadingEvent)
        .set({ dirty: 0 })
        .where(and(readingEventKey(row), eq(userReadingEvent.dirty, 1))),
    )
  },
}
