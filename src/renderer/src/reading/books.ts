// 书架元数据数据原语（user_book 变更流 LWW 集合 + 墓碑，db/05）。
// 纯函数：db 与校准时间由门面传入，不 import 引擎 / 门面 / 平台桥（directory-convention §三「域模块内部纪律」）。
// 删除一律置墓碑（is_deleted=1）传播，不做物理 DELETE——物理删则删除传不到别端。
// 本机书文件的增删由 platform 的 booksBridge 负责，与本表解耦：文件在不在是运行时 stat 的事，不落状态列。
import { and, desc, eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { userBook, userBookProgress } from '@/db/schema'
import type { BookRecord } from './types'

// 书架一行 = user_book ⟕ user_book_progress（没读过的书无进度行，两列给 null）。
const COLUMNS = {
  bookHash: userBook.bookHash,
  title: userBook.title,
  author: userBook.author,
  format: userBook.format,
  importedAt: userBook.importedAt,
  isDeleted: userBook.isDeleted,
  fraction: userBookProgress.fraction,
  lastReadAt: userBookProgress.lastReadAt,
}

/**
 * 书架列表（滤墓碑），「最近阅读」优先：读过的按 lastReadAt 倒序，没读过的退回加入序 importedAt。
 * 两者混排用 coalesce —— 刚导入还没读的书自然排在「刚读过」的书之间的正确位置。
 */
export async function listBooks(db: Db): Promise<BookRecord[]> {
  return db
    .select(COLUMNS)
    .from(userBook)
    .leftJoin(userBookProgress, eq(userBookProgress.bookHash, userBook.bookHash))
    .where(eq(userBook.isDeleted, 0))
    .orderBy(desc(sql`coalesce(${userBookProgress.lastReadAt}, ${userBook.importedAt})`))
    .all()
}

/** 取一本（**含墓碑行**，无行返回 null）：导入流程靠 isDeleted 区分「已在书架」与「可复活」。 */
export async function getBook(db: Db, bookHash: string): Promise<BookRecord | null> {
  const row = await db
    .select(COLUMNS)
    .from(userBook)
    .leftJoin(userBookProgress, eq(userBookProgress.bookHash, userBook.bookHash))
    .where(eq(userBook.bookHash, bookHash))
    .get()
  return row ?? null
}

/** 导入时写入的元数据（bookHash 由文件内容决定，title/author 由 EPUB 元数据整形而来）。 */
export type BookInput = Pick<BookRecord, 'bookHash' | 'title' | 'author' | 'format'>

/**
 * 加入书架：新书 insert，已有行（含墓碑）改写元数据并复活。
 * importedAt 只在首次 insert 时打，**复活不刷新**——它是「加入书架序」，删了又重导不该把老书顶到最前。
 *
 * 注意这条只在**本地墓碑还在**的窗口内成立：墓碑一经 push 被接受（LWW 物理删）或拉到远端墓碑，
 * 本地就不剩行了，此后重导入走的是「无行」分支，importedAt = 当次时间。跨端一致性不受影响
 * （importedAt 只驱动书架排序），但别把它当成「重导入永不改序」的通用保证。
 */
export async function addBook(db: Db, book: BookInput, now: number): Promise<void> {
  const { title, author, format } = book
  await db
    .insert(userBook)
    .values({ ...book, importedAt: now, editTime: now, isDeleted: 0, dirty: 1 })
    .onConflictDoUpdate({
      target: userBook.bookHash,
      set: { title, author, format, editTime: now, isDeleted: 0, dirty: 1 },
    })
    .run()
}

/** 改书名（只动本表，不碰文件；editTime 刷新，importedAt 不动）。无活行则无操作。 */
export async function renameBook(db: Db, bookHash: string, title: string, now: number): Promise<void> {
  await db
    .update(userBook)
    .set({ title, editTime: now, dirty: 1 })
    .where(and(eq(userBook.bookHash, bookHash), eq(userBook.isDeleted, 0)))
    .run()
}

/**
 * 删书：置墓碑传播（阅读数据不连带删；本机文件由调用方另删）。
 * where 带 isDeleted=0 幂等护栏（同 wordbook/notes.clearNote）：重复删不再推高 editTime、压过别端并发写。
 */
export async function removeBook(db: Db, bookHash: string, now: number): Promise<void> {
  await db
    .update(userBook)
    .set({ isDeleted: 1, editTime: now, dirty: 1 })
    .where(and(eq(userBook.bookHash, bookHash), eq(userBook.isDeleted, 0)))
    .run()
}
