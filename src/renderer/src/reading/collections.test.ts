// 阅读五集合的同步语义单测：两台设备各建一个内存库，走引擎真正用的那套机械件
//（collectDirty 收脏 → applyRemoteStmt 逐行应用），钉住四条**跨端语义**，规则变了这些测试就该失败（规则 7）：
// ① 删书跨端 = user_book 墓碑传播，**阅读数据不连带**（重导入同一本书即全部复活）；
// ② 数据行先于书行到达是**合法状态**（表间无外键；靠 bookHash 内容寻址，不依赖文件/书行同步先行）；
// ③ 本地更晚的脏改动**赢过**远端墓碑（keepLocal）——这正是删书后还要复核本地行才敢删文件的依据；
// ④ readingEvents 是 append-only：同一 (bookHash, startTime) 重放不叠加、不覆盖。
import Database from 'better-sqlite3'
import { drizzle as betterDrizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as proxyDrizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { BatchItem } from 'drizzle-orm/batch'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runBatch as execBatch, runStmt as execStmt } from '../../../main/dbExecutor'
import { runBatch, type Db } from '@/db/client'
import { userReadingEvent } from '@/db/schema'
import * as annotationsData from './annotations'
import * as bookmarksData from './bookmarks'
import * as booksData from './books'
import * as events from './events'
import * as progressData from './progress'
import { annotations, bookmarks, books, progress, readingEvents } from './collections'
import type { AnnotationRecord, BookmarkRecord } from './types'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../drizzle', import.meta.url))

/** 模拟一台设备：进程内 better-sqlite3 + 迁移建库，走与生产同一套数据函数（同 sync/engine.test.ts）。 */
function makeDevice(): Db {
  const sqlite = new Database(':memory:')
  migrate(betterDrizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR })
  return proxyDrizzle(
    async (sql, params, method) => execStmt(sqlite, { sql, params, method }) as { rows: any[] },
    async (queries) => execBatch(sqlite, queries) as { rows: any[] }[],
  )
}

const HASH = 'a'.repeat(32)

const bookInput = { bookHash: HASH, title: '白鲸', author: 'Melville', format: 'epub' }

const annotationInput = (id: string): AnnotationRecord => ({
  id,
  bookHash: HASH,
  cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:8)',
  text: 'Call me Ishmael',
  color: 'yellow',
  style: 'fill',
  note: '',
  createdAt: 1000,
})

const bookmarkInput = (id: string): BookmarkRecord => ({
  id,
  bookHash: HASH,
  cfi: 'epubcfi(/6/4!/4/2/1:0)',
  title: '第一章',
  createdAt: 1000,
})

/** 把一端的脏行当作服务端下发，逐行应用到另一端（引擎 pull 侧的真实动作）。 */
async function sync<Row>(
  from: Db,
  to: Db,
  collection: {
    collectDirty(db: Db): Promise<Row[]>
    applyRemoteStmt(db: Db, row: Row): BatchItem<'sqlite'>
  },
): Promise<Row[]> {
  const rows = await collection.collectDirty(from)
  await runBatch(
    to,
    rows.map((r) => collection.applyRemoteStmt(to, r)),
  )
  return rows
}

describe('删书跨端（books 墓碑）', () => {
  it('A 删书 → B 应用后书架没了，但 B 的标注仍在（阅读数据不连带删）', async () => {
    const A = makeDevice()
    const B = makeDevice()
    // 两端都有这本书 + B 上有一条标注
    await booksData.addBook(A, bookInput, 100)
    await booksData.addBook(B, bookInput, 100)
    await annotationsData.addAnnotation(B, annotationInput('ann-1'), 100)

    await booksData.removeBook(A, HASH, 200) // A 删书 = 置墓碑
    await sync(A, B, books)

    expect(await booksData.listBooks(B)).toHaveLength(0) // 书架条目消失（本地不留死行）
    expect(await booksData.getBook(B, HASH)).toBeNull()
    // 标注一条不少：重新导入同一本书（hash 相同）即全部复活
    expect(await annotationsData.listAnnotations(B, HASH)).toHaveLength(1)
  })

  it('B 本地有更晚的脏改动 → 保留本地行，远端墓碑不生效（keepLocal，故本机书文件也不能删）', async () => {
    const A = makeDevice()
    const B = makeDevice()
    await booksData.addBook(A, bookInput, 100)
    await booksData.addBook(B, bookInput, 100)

    await booksData.removeBook(A, HASH, 200) // A 在 200 删书
    await booksData.renameBook(B, HASH, '白鲸（改名）', 300) // B 在 300 改名，更晚且未推
    await sync(A, B, books)

    const kept = await booksData.getBook(B, HASH)
    expect(kept?.title).toBe('白鲸（改名）') // 本地赢，行还在书架上
    expect(kept?.isDeleted).toBe(0)
  })
})

describe('数据行先于书行到达（表间无外键，内容寻址挂靠）', () => {
  it('B 上还没有这本书，A 的标注照样落得下且读得出来', async () => {
    const A = makeDevice()
    const B = makeDevice()
    await annotationsData.addAnnotation(A, annotationInput('ann-1'), 100)

    await sync(A, B, annotations)

    expect(await booksData.getBook(B, HASH)).toBeNull() // 书行还没到
    const landed = await annotationsData.listAnnotations(B, HASH)
    expect(landed).toHaveLength(1)
    expect(landed[0].text).toBe('Call me Ishmael')
  })
})

// 字段映射是 lww.ts 按**字符串 prop** 在存储行/wire 行上取值取出来的——参数表恰是编译器不查的那部分：
// 拼错一个 prop 不会有类型错、不会抛，只会静默丢字段（跨端少一列数据）。故逐字段断言两个方向。
describe('progress 同步件（字段映射）', () => {
  it('A 记进度 → 收脏出的 wire 行逐字段正确 → B 应用后读回来一致', async () => {
    const A = makeDevice()
    const B = makeDevice()
    await progressData.saveProgress(A, { bookHash: HASH, location: 'epubcfi(/6/4!/4/2)', fraction: 0.42 }, 1500)

    const rows = await sync(A, B, progress)

    // progress 无墓碑：wire 行不带 isDeleted。
    expect(rows).toEqual([
      {
        syncVer: 0,
        editTime: 1500,
        bookHash: HASH,
        location: 'epubcfi(/6/4!/4/2)',
        fraction: 0.42,
        lastReadAt: 1500,
      },
    ])
    expect(await progressData.getProgress(B, HASH)).toEqual({
      bookHash: HASH,
      location: 'epubcfi(/6/4!/4/2)',
      fraction: 0.42,
      lastReadAt: 1500,
    })
  })
})

describe('bookmarks 同步件（字段映射）', () => {
  it('A 加书签 → 收脏出的 wire 行逐字段正确 → B 应用后读回来一致', async () => {
    const A = makeDevice()
    const B = makeDevice()
    await bookmarksData.addBookmark(A, bookmarkInput('bm-1'), 1200)

    const rows = await sync(A, B, bookmarks)

    expect(rows).toEqual([
      {
        syncVer: 0,
        editTime: 1200,
        isDeleted: 0,
        bookmarkId: 'bm-1',
        bookHash: HASH,
        cfi: 'epubcfi(/6/4!/4/2/1:0)',
              title: '第一章',
        createdAt: 1000,
      },
    ])
    expect(await bookmarksData.listBookmarks(B, HASH)).toEqual([bookmarkInput('bm-1')])
  })
})

describe('readingEvents（append-only 幂等）', () => {
  it('同一 (bookHash, startTime) 重放两次：不叠加也不覆盖', async () => {
    const A = makeDevice()
    const B = makeDevice()
    await events.addReadingEvent(A, { bookHash: HASH, startTime: 8000, durationMs: 60_000, fraction: 0.4 })

    const rows = await sync(A, B, readingEvents)
    // 同一批重放（网络重试 / 收口 pull 把自己的行拉回来都会发生）
    await runBatch(
      B,
      rows.map((r) => readingEvents.applyRemoteStmt(B, r)),
    )

    const stored = await B.select().from(userReadingEvent).all()
    expect(stored).toHaveLength(1)
    expect(stored[0].durationMs).toBe(60_000)
  })
})
