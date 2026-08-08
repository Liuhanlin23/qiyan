// 标注 / 书签 / 进度原语的单测：钉住四条**语义**，业务规则变了这些测试就该失败（规则 7）。
// ① 删除是置墓碑不是物理删——物理删则删除传不到别端；读路径必须滤墓碑；
// ② 编辑标注**不刷新 createdAt**——列表显示的是「什么时候标的」，改笔记不该把它顶新；
// ③ 编辑不复活墓碑行——迟到的编辑落在已删的行上，不能让它诈尸；
// ④ 书架排序「最近阅读优先、没读过退回加入序」——两种时间混排，只看某一种都会排错。
//
// 建库方式同 books.test.ts：真 drizzle migrate 一个内存库，数据函数与生产同一套。
import Database from 'better-sqlite3'
import { drizzle as betterDrizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as proxyDrizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { runBatch as execBatch, runStmt as execStmt } from '../../../main/dbExecutor'
import type { Db } from '@/db/client'
import { userBookAnnotation, userBookBookmark, userBookProgress } from '@/db/schema'
import * as annotations from './annotations'
import * as bookmarks from './bookmarks'
import * as books from './books'
import * as progress from './progress'
import type { AnnotationRecord, BookmarkRecord } from './types'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../drizzle', import.meta.url))

function makeDb(): Db {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrate(betterDrizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR })
  return proxyDrizzle(
    async (sql, params, method) => execStmt(sqlite, { sql, params, method }) as { rows: any[] },
    async (queries) => execBatch(sqlite, queries) as { rows: any[] }[],
  )
}

const HASH_A = 'a'.repeat(32)
const HASH_B = 'b'.repeat(32)

// createdAt 随记录一起给（页面先上屏再落库，故 id/createdAt 在门面就已盖好）。
const annotationInput = (id: string, over: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  id,
  bookHash: HASH_A,
  cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:8)',
  text: 'a sentence',
  color: 'yellow',
  style: 'fill',
  note: '',
  createdAt: 1000,
  ...over,
})

const bookmarkInput = (id: string, over: Partial<BookmarkRecord> = {}): BookmarkRecord => ({
  id,
  bookHash: HASH_A,
  cfi: 'epubcfi(/6/4!/4/2/1:0)',
  title: '第一章',
  createdAt: 1000,
  ...over,
})

let db: Db
beforeEach(() => {
  db = makeDb()
})

describe('标注原语', () => {
  it('落笔后按书取得到；别的书取不到', async () => {
    await annotations.addAnnotation(db, annotationInput('a1'), 1000)
    await annotations.addAnnotation(db, annotationInput('a2', { bookHash: HASH_B }), 1000)
    const list = await annotations.listAnnotations(db, HASH_A)
    expect(list.map((a) => a.id)).toEqual(['a1'])
    expect(list[0]).toMatchObject({ text: 'a sentence', color: 'yellow', style: 'fill', createdAt: 1000 })
  })

  it('改色 / 写笔记不刷新 createdAt（列表显示的是创建日期）', async () => {
    await annotations.addAnnotation(db, annotationInput('a1'), 1000)
    await annotations.updateAnnotation(db, 'a1', { color: 'blue', note: '想法' }, 5000)
    const [row] = await annotations.listAnnotations(db, HASH_A)
    expect(row).toMatchObject({ color: 'blue', note: '想法', createdAt: 1000 })
    // editTime 才是被刷新的那个（LWW 仲裁用）。
    const raw = await db
      .select({ editTime: userBookAnnotation.editTime, dirty: userBookAnnotation.dirty })
      .from(userBookAnnotation)
      .where(eq(userBookAnnotation.annotationId, 'a1'))
      .get()
    expect(raw).toEqual({ editTime: 5000, dirty: 1 })
  })

  it('删标注置墓碑而非物理删：列表看不到，行还在（供跨端传播）', async () => {
    await annotations.addAnnotation(db, annotationInput('a1'), 1000)
    await annotations.removeAnnotation(db, 'a1', 2000)
    expect(await annotations.listAnnotations(db, HASH_A)).toEqual([])
    const raw = await db
      .select({ isDeleted: userBookAnnotation.isDeleted, editTime: userBookAnnotation.editTime })
      .from(userBookAnnotation)
      .where(eq(userBookAnnotation.annotationId, 'a1'))
      .get()
    expect(raw).toEqual({ isDeleted: 1, editTime: 2000 })
  })

  it('对已删的标注再编辑不会让它复活', async () => {
    await annotations.addAnnotation(db, annotationInput('a1'), 1000)
    await annotations.removeAnnotation(db, 'a1', 2000)
    await annotations.updateAnnotation(db, 'a1', { note: '迟到的编辑' }, 3000)
    expect(await annotations.listAnnotations(db, HASH_A)).toEqual([])
  })

  it('重复删有幂等护栏：不再推高 editTime（否则 LWW 下会压过别端并发写）', async () => {
    await annotations.addAnnotation(db, annotationInput('a1'), 1000)
    await annotations.removeAnnotation(db, 'a1', 2000)
    await annotations.removeAnnotation(db, 'a1', 9000)
    const raw = await db
      .select({ editTime: userBookAnnotation.editTime })
      .from(userBookAnnotation)
      .where(eq(userBookAnnotation.annotationId, 'a1'))
      .get()
    expect(raw?.editTime).toBe(2000)
  })
})

describe('书签原语', () => {
  it('加书签后按书取得到；改名不刷新 createdAt', async () => {
    await bookmarks.addBookmark(db, bookmarkInput('b1'), 1000)
    await bookmarks.renameBookmark(db, 'b1', '开篇', 5000)
    const [row] = await bookmarks.listBookmarks(db, HASH_A)
    expect(row).toMatchObject({ title: '开篇', createdAt: 1000 })
  })

  it('删书签置墓碑：列表看不到，行还在', async () => {
    await bookmarks.addBookmark(db, bookmarkInput('b1'), 1000)
    await bookmarks.removeBookmark(db, 'b1', 2000)
    expect(await bookmarks.listBookmarks(db, HASH_A)).toEqual([])
    const raw = await db
      .select({ isDeleted: userBookBookmark.isDeleted })
      .from(userBookBookmark)
      .where(eq(userBookBookmark.bookmarkId, 'b1'))
      .get()
    expect(raw).toEqual({ isDeleted: 1 })
  })
})

describe('进度原语', () => {
  it('没读过返回 null；记一次即可取回', async () => {
    expect(await progress.getProgress(db, HASH_A)).toBeNull()
    await progress.saveProgress(db, { bookHash: HASH_A, location: 'epubcfi(/6/4!/4/2)', fraction: 0.3 }, 1000)
    expect(await progress.getProgress(db, HASH_A)).toEqual({
      bookHash: HASH_A,
      location: 'epubcfi(/6/4!/4/2)',
      fraction: 0.3,
      lastReadAt: 1000,
    })
    // 同步控制列（对齐标注/书架的断言）：漏置 dirty 这行就永远收不进变更流、进度只留在本机，
    // 而读路径一切正常，光看代码看不出来。lastReadAt 与 editTime 写入时同值但分属两个用途。
    const raw = await db
      .select({ editTime: userBookProgress.editTime, dirty: userBookProgress.dirty })
      .from(userBookProgress)
      .where(eq(userBookProgress.bookHash, HASH_A))
      .get()
    expect(raw).toEqual({ editTime: 1000, dirty: 1 })
  })

  it('每书一行：再记只覆盖不新增', async () => {
    await progress.saveProgress(db, { bookHash: HASH_A, location: 'x', fraction: 0.3 }, 1000)
    await progress.saveProgress(db, { bookHash: HASH_A, location: 'y', fraction: 0.6 }, 2000)
    expect(await progress.getProgress(db, HASH_A)).toMatchObject({ location: 'y', fraction: 0.6, lastReadAt: 2000 })
  })
})

describe('书架接进度', () => {
  const book = (bookHash: string, title: string) => ({ bookHash, title, author: '', format: 'epub' })

  it('「最近阅读」优先，没读过的按加入序混排', async () => {
    // A 先加入但读得早，B 后加入没读过，C 最早加入却刚读过 → C（3000）> B（2000 加入）> A（1500 读）。
    await books.addBook(db, book(HASH_A, 'A'), 1000)
    await books.addBook(db, book(HASH_B, 'B'), 2000)
    await books.addBook(db, book('c'.repeat(32), 'C'), 500)
    await progress.saveProgress(db, { bookHash: HASH_A, location: 'x', fraction: 0.1 }, 1500)
    await progress.saveProgress(db, { bookHash: 'c'.repeat(32), location: 'y', fraction: 0.8 }, 3000)
    const list = await books.listBooks(db)
    expect(list.map((b) => b.title)).toEqual(['C', 'B', 'A'])
    expect(list.map((b) => b.fraction)).toEqual([0.8, null, 0.1])
  })
})
