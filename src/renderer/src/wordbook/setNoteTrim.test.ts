// 门面 setNote 统一 trim 收口单测（修复执行文档 T12）：核心 intent = 三个保存入口经门面归一化首尾空白，
// 单一收口点落库为 trim 后文本。收口点移走 / 去掉 trim 这测试就该失败（规则 7）。
//
// 门面绑单例 db + 校准钟并组合诸多子模块。此测把 @/db/client 的 db 指向进程内 better-sqlite3（复用 main/dbExecutor，
// 与其余数据层测试同法），校准钟 / 取数层 mock 掉，从而 wordbook.setNote 真落库、再用 notes.getNote 读回验证。
// 两例用不同 dictId 避免 module 级单例库跨例污染（无需 cleanup）。
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/db/client', async () => {
  const Database = (await import('better-sqlite3')).default
  const { drizzle: betterDrizzle } = await import('drizzle-orm/better-sqlite3')
  const { drizzle: proxyDrizzle } = await import('drizzle-orm/sqlite-proxy')
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  const { fileURLToPath } = await import('node:url')
  const { runBatch: execBatch, runStmt: execStmt } = await import('../../../main/dbExecutor')
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrate(betterDrizzle(sqlite), {
    migrationsFolder: fileURLToPath(new URL('../../../../drizzle', import.meta.url)),
  })
  const db = proxyDrizzle(
    async (sql: string, params: unknown[], method: string) =>
      execStmt(sqlite, { sql, params, method } as never) as { rows: unknown[] },
    async (queries: unknown[]) => execBatch(sqlite, queries as never) as { rows: unknown[] }[],
  )
  return { db, runBatch: vi.fn(), currentDbGeneration: () => 1 }
})
vi.mock('@/sync/clock', () => ({ calibratedNowSync: () => 12345, primeClockOffset: vi.fn() }))
vi.mock('@/api/dict', () => ({ fetchDictBatch: vi.fn(), fetchDictUpdates: vi.fn(), fetchDictByTerm: vi.fn() }))
vi.mock('@/api/wordbook', () => ({ fetchCategories: vi.fn(), fetchOfficialBooks: vi.fn(), fetchBookEntries: vi.fn() }))

import { db } from '@/db/client'
import * as notes from './notes'
import * as wordbook from './index'

describe('wordbook.setNote 门面统一 trim（T12）', () => {
  it('setNote(dictId, "  x  ") → 落库为 "x"（首尾空白归一化）', async () => {
    await wordbook.setNote(9, '  x  ')
    expect(await notes.getNote(db, 9)).toBe('x')
  })

  it('内部含空白不动，仅去首尾（"  a b  " → "a b"）', async () => {
    await wordbook.setNote(10, '  a b  ')
    expect(await notes.getNote(db, 10)).toBe('a b')
  })
})
