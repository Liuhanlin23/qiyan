// 书架元数据原语的单测：钉住三条同步语义，业务语义变了这些测试就该失败（规则 7）。
// ① 删书是**置墓碑**不是物理删——物理删则删除传不到别端；
// ② 本地墓碑还在时复活**不刷新 importedAt**——它是「加入书架序」，删了又重导不该把老书顶到最前；
// ③ 重复删有幂等护栏——不再推高 editTime，否则 LWW 下会压过别端并发写。
//
// 生产与测试跑同一套数据函数，只是执行器不同：生产经 IPC 到 main 的 better-sqlite3，
// 测试把 sqlite-proxy 回调指向进程内 better-sqlite3（复用 main/dbExecutor）。
import Database from 'better-sqlite3'
import { drizzle as betterDrizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as proxyDrizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { runBatch as execBatch, runStmt as execStmt } from '../../../main/dbExecutor'
import type { Db } from '@/db/client'
import { userBook } from '@/db/schema'
import * as books from './books'

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
const input = (bookHash: string, title: string) => ({ bookHash, title, author: '', format: 'epub' })

let db: Db
beforeEach(() => {
  db = makeDb()
})

describe('user_book 数据原语', () => {
  it('加入书架后可列出与按 hash 取到', async () => {
    await books.addBook(db, input(HASH_A, 'The Old Man and the Sea'), 1000)
    expect(await books.listBooks(db)).toEqual([
      // fraction/lastReadAt 来自 left join 的 user_book_progress，没读过就是 null（排序退回 importedAt）。
      { bookHash: HASH_A, title: 'The Old Man and the Sea', author: '', format: 'epub', importedAt: 1000, isDeleted: 0, fraction: null, lastReadAt: null },
    ])
    expect((await books.getBook(db, HASH_A))?.title).toBe('The Old Man and the Sea')
    expect(await books.getBook(db, HASH_B)).toBeNull()
  })

  it('书架按加入序倒序（最近加入在前）', async () => {
    await books.addBook(db, input(HASH_A, 'A'), 1000)
    await books.addBook(db, input(HASH_B, 'B'), 2000)
    expect((await books.listBooks(db)).map((b) => b.title)).toEqual(['B', 'A'])
  })

  it('删书置墓碑而非物理删：书架看不到，但按 hash 仍取得到墓碑行（供复活判定）', async () => {
    await books.addBook(db, input(HASH_A, 'A'), 1000)
    await books.removeBook(db, HASH_A, 2000)
    expect(await books.listBooks(db)).toEqual([])
    expect(await books.getBook(db, HASH_A)).toMatchObject({ bookHash: HASH_A, isDeleted: 1 })
  })

  // 限定在「本地墓碑还在」的窗口内：墓碑一经推送被接受（LWW 物理删）本地就没行了，
  // 此后重导入走 insert 分支、importedAt 即为当次时间——这条不是「重导入永不改序」的通用保证。
  it('墓碑还在时复活：回到书架且元数据被改写，但 importedAt 不刷新（加入书架序稳定）', async () => {
    await books.addBook(db, input(HASH_A, '旧书名'), 1000)
    await books.removeBook(db, HASH_A, 2000)
    await books.addBook(db, { ...input(HASH_A, '新书名'), author: '海明威' }, 3000)
    expect(await books.listBooks(db)).toEqual([
      { bookHash: HASH_A, title: '新书名', author: '海明威', format: 'epub', importedAt: 1000, isDeleted: 0, fraction: null, lastReadAt: null },
    ])
  })

  it('重复删有幂等护栏：第二次删不再推高 editTime（否则 LWW 下会压过别端并发写）', async () => {
    await books.addBook(db, input(HASH_A, 'A'), 1000)
    await books.removeBook(db, HASH_A, 2000)
    await books.removeBook(db, HASH_A, 9000)
    expect(await editTimeOf(HASH_A)).toBe(2000)
  })

  it('改书名刷新 editTime 但不动 importedAt；墓碑行改不动', async () => {
    await books.addBook(db, input(HASH_A, '旧书名'), 1000)
    await books.renameBook(db, HASH_A, '新书名', 2000)
    expect(await books.getBook(db, HASH_A)).toMatchObject({ title: '新书名', importedAt: 1000 })
    expect(await editTimeOf(HASH_A)).toBe(2000)

    await books.removeBook(db, HASH_A, 3000)
    await books.renameBook(db, HASH_A, '墓碑上改名', 4000)
    expect(await books.getBook(db, HASH_A)).toMatchObject({ title: '新书名', isDeleted: 1 })
  })

  it('写路径一律置 dirty=1（push 攒批靠它扫脏行）', async () => {
    await books.addBook(db, input(HASH_A, 'A'), 1000)
    expect(await dirtyOf(HASH_A)).toBe(1)
  })

  // 断言用的取列助手（原语面上不暴露 editTime/dirty——它们是同步机制字段，不是业务读物）。
  async function editTimeOf(bookHash: string): Promise<number | undefined> {
    const row = await db
      .select({ editTime: userBook.editTime })
      .from(userBook)
      .where(eq(userBook.bookHash, bookHash))
      .get()
    return row?.editTime
  }
  async function dirtyOf(bookHash: string): Promise<number | undefined> {
    const row = await db
      .select({ dirty: userBook.dirty })
      .from(userBook)
      .where(eq(userBook.bookHash, bookHash))
      .get()
    return row?.dirty
  }
})
