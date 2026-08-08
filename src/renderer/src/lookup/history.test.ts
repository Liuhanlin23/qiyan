// 查词历史单测（docs/feature/lookup/lookup.md §4）：同词重查置顶（不是新增行）、上限 200 删最旧、
// 一键清空、与「清空词典缓存」互不相干。业务语义变了这些测试就该失败（规则 7）。
//
// 生产与测试跑同一套数据函数，只是执行器不同：sqlite-proxy 回调指向进程内 better-sqlite3（复用 main/dbExecutor）。
import Database from 'better-sqlite3'
import { drizzle as betterDrizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as proxyDrizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { runBatch as execBatch, runStmt as execStmt } from '../../../main/dbExecutor'
import { type Db } from '@/db/client'
import * as dict from '@/dict/dict'
import * as history from './history'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../drizzle', import.meta.url))

function makeDb(): Db {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrate(betterDrizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR })
  return proxyDrizzle(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (sql, params, method) => execStmt(sqlite, { sql, params, method }) as { rows: any[] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (queries) => execBatch(sqlite, queries) as { rows: any[] }[],
  )
}

describe('lookup 查词历史（同词置顶 / 上限裁剪 / 清空 / 与词典缓存独立）', () => {
  let db: Db
  beforeEach(() => {
    db = makeDb()
  })

  it('同词重查 = 更新 looked_up_at 置顶，不新增行', async () => {
    await history.recordLookup(db, 'hello', '', 1000)
    await history.recordLookup(db, 'world', '', 2000)
    await history.recordLookup(db, 'hello', '', 3000) // 重查置顶
    const rows = await history.listHistory(db)
    expect(rows.map((r) => r.term)).toEqual(['hello', 'world']) // 倒序 + 无重复行
    expect(rows[0].lookedUpAt).toBe(3000)
  })

  it('超过 200 条删除最旧（新记录立足，最旧行出局）', async () => {
    for (let i = 1; i <= 200; i++) await history.recordLookup(db, `w${i}`, '', i)
    await history.recordLookup(db, 'newest', '', 999)
    const rows = await history.listHistory(db)
    expect(rows).toHaveLength(200)
    expect(rows[0].term).toBe('newest') // 新记录在列
    expect(rows.some((r) => r.term === 'w1')).toBe(false) // 最旧的 w1 被裁掉
  })

  it('落库首条简义快照，重查刷新为最新（空态列表靠它免二次读穿）', async () => {
    await history.recordLookup(db, 'hello', '你好；喂', 1000)
    expect((await history.listHistory(db))[0].explain).toBe('你好；喂')
    await history.recordLookup(db, 'hello', '打招呼', 2000) // 重查刷新快照
    const rows = await history.listHistory(db)
    expect(rows).toHaveLength(1) // 仍是同一行
    expect(rows[0].explain).toBe('打招呼')
  })

  it('一键清空后列表为空', async () => {
    await history.recordLookup(db, 'hello', '', 1000)
    await history.clearHistory(db)
    expect(await history.listHistory(db)).toEqual([])
  })

  it('清空词典缓存不清历史（lookup.md §4：两者独立）', async () => {
    await history.recordLookup(db, 'hello', '', 1000)
    await dict.clearDictCache(db)
    expect(await history.listHistory(db)).toHaveLength(1)
  })
})
