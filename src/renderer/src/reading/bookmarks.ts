// 书签数据原语（user_book_bookmark 变更流 LWW 集合 + 墓碑，db/05）。
// 与标注同款纪律（墓碑删、createdAt 不刷新），只是字段不同——两者拆两表，故这里不与 annotations 合并。
import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { userBookBookmark } from '@/db/schema'
import type { BookmarkRecord } from './types'

const COLUMNS = {
  id: userBookBookmark.bookmarkId,
  bookHash: userBookBookmark.bookHash,
  cfi: userBookBookmark.cfi,
  title: userBookBookmark.title,
  createdAt: userBookBookmark.createdAt,
}

/** 一本书的全部书签（滤墓碑），按创建序。 */
export async function listBookmarks(db: Db, bookHash: string): Promise<BookmarkRecord[]> {
  return db
    .select(COLUMNS)
    .from(userBookBookmark)
    .where(and(eq(userBookBookmark.bookHash, bookHash), eq(userBookBookmark.isDeleted, 0)))
    .orderBy(asc(userBookBookmark.createdAt))
    .all()
}

/** 加一条书签（整条记录由调用方给全，同 annotations.addAnnotation）。 */
export async function addBookmark(db: Db, b: BookmarkRecord, editTime: number): Promise<void> {
  await db
    .insert(userBookBookmark)
    .values({ ...b, bookmarkId: b.id, editTime, isDeleted: 0, dirty: 1 })
    .run()
}

/** 改名（书签唯一可改的字段）：刷 editTime + dirty，不动 createdAt。 */
export async function renameBookmark(db: Db, id: string, title: string, now: number): Promise<void> {
  await db
    .update(userBookBookmark)
    .set({ title, editTime: now, dirty: 1 })
    .where(and(eq(userBookBookmark.bookmarkId, id), eq(userBookBookmark.isDeleted, 0)))
    .run()
}

/** 删一条书签：置墓碑传播（带 isDeleted=0 幂等护栏）。 */
export async function removeBookmark(db: Db, id: string, now: number): Promise<void> {
  await db
    .update(userBookBookmark)
    .set({ isDeleted: 1, editTime: now, dirty: 1 })
    .where(and(eq(userBookBookmark.bookmarkId, id), eq(userBookBookmark.isDeleted, 0)))
    .run()
}
