// dict 词典缓存单测：聚焦「为什么这些行为重要」——纯读只增缓存（列对列覆盖 / 大小写敏感 / 全删）、
// 读穿回填、词库增量键集翻页水位线纪律（仅整轮 done 才推、中途失败下轮整轮重来）。业务语义变了这些测试就该失败（规则 7）。
//
// 生产与测试跑同一套数据函数，只是执行器不同：测试把 sqlite-proxy 回调指向进程内 better-sqlite3（复用 main/dbExecutor）。
import Database from 'better-sqlite3'
import { drizzle as betterDrizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as proxyDrizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runBatch as execBatch, runStmt as execStmt } from '../../../main/dbExecutor'

// 世代号护栏：partial-mock '@/db/client' 只覆写 currentDbGeneration（保留真 runBatch/db），供 service 测试控制账号切换。
const hoisted = vi.hoisted(() => ({ gen: { value: 1 } }))
vi.mock('@/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/client')>()
  return { ...actual, currentDbGeneration: () => hoisted.gen.value }
})
// 取数层 mock：service 读穿/增量测试注入网络响应，不打真 HTTP。
vi.mock('@/api/dict', () => ({
  fetchDictBatch: vi.fn(),
  fetchDictUpdates: vi.fn(),
  fetchDictByTerm: vi.fn(),
}))

import { type Db } from '@/db/client'
import { getDictRefreshDay, setDictRefreshDay } from './dict'
import * as api from '@/api/dict'
import * as dict from './dict'
import * as service from './service'
import type { LocalDictRow } from './types'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../drizzle', import.meta.url))

interface TestDb {
  db: Db
  sqlite: Database.Database
}

function makeDb(): TestDb {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrate(betterDrizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR })
  const db = proxyDrizzle(
    async (sql, params, method) => execStmt(sqlite, { sql, params, method }) as { rows: any[] },
    async (queries) => execBatch(sqlite, queries) as { rows: any[] }[],
  )
  return { db, sqlite }
}

beforeEach(() => {
  vi.resetAllMocks()
  hoisted.gen.value = 1
})

function localDict(dictId: number, term = `w${dictId}`): LocalDictRow {
  return {
    dictId, term, termType: 1, ukPhonetic: null, usPhonetic: null, ukAudioUrl: null,
    usAudioUrl: null, audioUrl: null, ec: null, collins: null, syno: null, relWord: null,
    phrs: null, individual: null, exampleSentence: null,
  }
}

const dictIds = (h: TestDb) => (h.sqlite.prepare('SELECT dict_id AS id FROM dict ORDER BY dict_id').all() as Array<{ id: number }>).map((r) => r.id)

// ══════════════════ 词典缓存：纯读只增（dict.md §2/§5） ══════════════════

describe('dict 纯读只增缓存', () => {
  let h: TestDb
  beforeEach(() => { h = makeDb() })

  it('upsert 列对列覆盖（无缓存元数据列）；纯读命中不改行', async () => {
    await dict.upsertDicts(h.db, [localDict(1, 'a')])
    await dict.upsertDicts(h.db, [localDict(1, 'b')]) // 覆盖
    expect((await dict.getByDictId(h.db, 1))?.term).toBe('b')
    expect(await dict.getByTerm(h.db, 'b')).toMatchObject({ dictId: 1 })
    expect(await dict.getByTerm(h.db, 'B')).toBeNull() // 码点精确、大小写敏感
    expect(await dict.getByDictId(h.db, 999)).toBeNull()
  })

  it('clearDictCache 全删；cachedDictCount 诊断', async () => {
    await dict.upsertDicts(h.db, [localDict(1), localDict(2)])
    expect(await dict.cachedDictCount(h.db)).toBe(2)
    await dict.clearDictCache(h.db)
    expect(await dict.cachedDictCount(h.db)).toBe(0)
  })
})

// ══════════════════ service：增量键集翻页、读穿回填（api mock） ══════════════════

describe('service.refreshDictUpdates（键集翻页 + 水位线纪律）', () => {
  let h: TestDb
  beforeEach(() => { h = makeDb() })

  it('连续翻页直到 done，仅整轮 done 才推水位线；请求带 (since, afterId)', async () => {
    vi.mocked(api.fetchDictUpdates)
      .mockResolvedValueOnce({ rows: [localDict(1), localDict(2)], nextSince: 100, nextAfterId: 2, done: false })
      .mockResolvedValueOnce({ rows: [localDict(3)], nextSince: 9999, nextAfterId: 0, done: true })
    expect(await service.refreshDictUpdates(h.db)).toBe(true)
    expect(dictIds(h)).toEqual([1, 2, 3])
    expect(await dict.getDictUpdatesSince(h.db)).toBe(9999)
    expect(vi.mocked(api.fetchDictUpdates)).toHaveBeenNthCalledWith(1, 0, 0)
    expect(vi.mocked(api.fetchDictUpdates)).toHaveBeenNthCalledWith(2, 100, 2)
  })

  it('中途失败：已取页照常落库，但不推水位线（下轮整轮重来）', async () => {
    vi.mocked(api.fetchDictUpdates)
      .mockResolvedValueOnce({ rows: [localDict(1)], nextSince: 100, nextAfterId: 1, done: false })
      .mockRejectedValueOnce(new Error('net'))
    expect(await service.refreshDictUpdates(h.db)).toBe(false)
    expect(dictIds(h)).toEqual([1])
    expect(await dict.getDictUpdatesSince(h.db)).toBe(0) // 水位线未推进
  })

  it('maybeRefreshDictUpdates：今日已刷则跳过，整轮成功后标记今日', async () => {
    // 日窗起点由调用方算好传入（dict 不依赖学习域日边界）；此处用一个固定的当日窗口起点（本地 4:00）。
    const today = new Date(2026, 6, 15, 4, 0, 0).getTime()
    await setDictRefreshDay(h.db, today)
    await service.maybeRefreshDictUpdates(h.db, today)
    expect(vi.mocked(api.fetchDictUpdates)).not.toHaveBeenCalled() // 今日已刷

    await setDictRefreshDay(h.db, 0)
    vi.mocked(api.fetchDictUpdates).mockResolvedValueOnce({ rows: [], nextSince: 5, nextAfterId: 0, done: true })
    await service.maybeRefreshDictUpdates(h.db, today)
    expect(vi.mocked(api.fetchDictUpdates)).toHaveBeenCalledTimes(1)
    expect(await getDictRefreshDay(h.db)).toBe(today) // 成功 → 标记今日
  })
})

describe('service.readThroughByDictId（clearDictCache 后回填）', () => {
  it('命中即用；未命中在线取 → upsert → 回读', async () => {
    const h = makeDb()
    await dict.upsertDicts(h.db, [localDict(1), localDict(2)])
    await dict.clearDictCache(h.db)
    expect(await dict.cachedDictCount(h.db)).toBe(0)
    vi.mocked(api.fetchDictBatch).mockResolvedValueOnce([localDict(5)])
    const r = await service.readThroughByDictId(h.db, 5)
    expect(r?.dictId).toBe(5)
    expect(await dict.cachedDictCount(h.db)).toBe(1) // 回填
  })
})

// ══════════════════ service.lookupByTerm：查词三态（lookup.md §3） ══════════════════

describe('service.lookupByTerm（三态分流：hit / not-found / unavailable）', () => {
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
  })

  it('本地命中即终点（不发请求）；在线命中 upsert 后按权威拼写回读', async () => {
    await dict.upsertDicts(h.db, [localDict(1, 'hello')])
    expect(await service.lookupByTerm(h.db, 'hello')).toMatchObject({
      status: 'hit',
      row: { term: 'hello' },
    })
    expect(vi.mocked(api.fetchDictByTerm)).not.toHaveBeenCalled()

    // 输入 helo 命中权威拼写 hello2：行落在 hello2 键下，回读必须用权威拼写
    vi.mocked(api.fetchDictByTerm).mockResolvedValueOnce(localDict(2, 'hello2'))
    const r = await service.lookupByTerm(h.db, 'helo')
    expect(r).toMatchObject({ status: 'hit', row: { term: 'hello2' } })
    expect(await dict.getByTerm(h.db, 'hello2')).not.toBeNull() // 已回填本地
  })

  it('server 120002（有道无此词）→ not-found；不落库', async () => {
    const { ServerError } = await import('@/api/request')
    vi.mocked(api.fetchDictByTerm).mockRejectedValueOnce(new ServerError(120002, '未找到该词条'))
    expect(await service.lookupByTerm(h.db, 'nosuchword')).toEqual({ status: 'not-found' })
    expect(await dict.cachedDictCount(h.db)).toBe(0)
  })

  it('网络错误 / 其他服务错误 → unavailable（软降级，不抛给调用方）', async () => {
    const { NetworkError, ServerError } = await import('@/api/request')
    vi.mocked(api.fetchDictByTerm).mockRejectedValueOnce(new NetworkError('offline'))
    expect(await service.lookupByTerm(h.db, 'hello')).toEqual({ status: 'unavailable' })
    vi.mocked(api.fetchDictByTerm).mockRejectedValueOnce(new ServerError(120001, '查询词不合法'))
    expect(await service.lookupByTerm(h.db, 'hello')).toEqual({ status: 'unavailable' })
  })

  it('取数在途换账号（世代号变化）→ unavailable 且不写换后账号的库', async () => {
    vi.mocked(api.fetchDictByTerm).mockImplementationOnce(async () => {
      hoisted.gen.value = 2 // 在途切换账号
      return localDict(3, 'hello')
    })
    expect(await service.lookupByTerm(h.db, 'hello')).toEqual({ status: 'unavailable' })
    expect(await dict.cachedDictCount(h.db)).toBe(0)
  })
})
