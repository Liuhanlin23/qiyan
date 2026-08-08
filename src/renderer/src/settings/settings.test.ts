// settings 数据层单测：聚焦「为什么这些行为重要」——键级 KV 同步语义（默认不落库、逐键写、键级独立仲裁、
// 坏值读路径自愈且 fail loudly、未知键兼容）。业务语义变了这些测试就该失败（规则 7）。
//
// 生产与测试跑同一套数据函数，只是执行器不同：测试把 sqlite-proxy 回调指向进程内 better-sqlite3（复用 main/dbExecutor）。
import Database from 'better-sqlite3'
import { drizzle as betterDrizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as proxyDrizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runBatch as execBatch, runStmt as execStmt } from '../../../main/dbExecutor'

import { runBatch, type Db } from '@/db/client'
import type { SettingsRow } from '@/sync/protocol'
import * as settings from './settings'
import * as collections from './collection'

// 坏值回退要 toast + console.error（fail loudly）；mock 掉 toast 桥断言其被触发。
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
import { toast } from '@/lib/toast'

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

function wireSettings(over: Partial<SettingsRow> = {}): SettingsRow {
  return { syncVer: 0, editTime: 0, settingKey: 'wordbook.newPerDay', value: '20', ...over }
}

const readRow = (h: TestDb, key: string) =>
  h.sqlite
    .prepare('SELECT value, edit_time AS editTime, dirty FROM user_setting WHERE setting_key=?')
    .get(key) as { value: string; editTime: number; dirty: number } | undefined

const allKeys = (h: TestDb) =>
  (h.sqlite.prepare('SELECT setting_key AS k FROM user_setting ORDER BY setting_key').all() as { k: string }[])
    .map((r) => r.k)

const rawInsert = (h: TestDb, key: string, value: string) =>
  h.sqlite
    .prepare('INSERT INTO user_setting (setting_key, value, edit_time, dirty) VALUES (?,?,0,0)')
    .run(key, value)

// ══════════════════ settings 集合：键级 KV ══════════════════

describe('settings 键级 KV（无墓碑、自然键 settingKey）', () => {
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
    vi.mocked(toast.error).mockClear()
  })

  it('无行 = 全默认，且默认不落库（默认不入流）', async () => {
    expect(await settings.getSettings(h.db)).toEqual(settings.DEFAULT_SETTINGS)
    expect(allKeys(h)).toEqual([]) // 读默认一行不建
  })

  it('写后读回；只写 patch 键——改 A 不产生 B 的行（键级独立，本次重构的核心）', async () => {
    await settings.updateSettings(h.db, { newPerDay: 33 }, 100)
    expect(allKeys(h)).toEqual(['wordbook.newPerDay']) // 只有被改的键落库
    expect(readRow(h, 'wordbook.newPerDay')).toMatchObject({ value: '33', editTime: 100, dirty: 1 })
    expect((await settings.getSettings(h.db)).newPerDay).toBe(33)
    // 改第二个键：各自独立成行，互不影响
    await settings.updateSettings(h.db, { accent: 'uk' }, 200)
    expect(allKeys(h)).toEqual(['wordbook.newPerDay', 'wordcard.accent'])
    const s = await settings.getSettings(h.db)
    expect(s).toMatchObject({ newPerDay: 33, accent: 'uk' })
  })

  it('newCardOrder：默认 random（协议约定）、写读回路保真（feature/wordbook/settings.md）', async () => {
    expect(settings.DEFAULT_SETTINGS.newCardOrder).toBe('random')
    expect((await settings.getSettings(h.db)).newCardOrder).toBe('random') // 无行取默认
    await settings.updateSettings(h.db, { newCardOrder: 'joinTime' }, 100)
    expect((await settings.getSettings(h.db)).newCardOrder).toBe('joinTime')
  })

  it('坏值回退默认且大声提示（同步管道可能流入别端垃圾，读路径必须自愈 + fail loudly）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    rawInsert(h, 'wordcard.meaningSource', 'not-json') // parse 失败
    rawInsert(h, 'wordcard.accent', '"fr"') // 合法 JSON 但值域非法

    const s = await settings.getSettings(h.db)
    expect(s.meaningSource).toBe('concise') // 回退默认
    expect(s.accent).toBe('us') // 回退默认
    expect(errSpy).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('表中存在未知键时 getSettings 正常工作（老客户端兼容新版键）', async () => {
    rawInsert(h, 'tts.speechRate', '1.25') // 注册表外的未来键
    await settings.updateSettings(h.db, { newPerDay: 42 }, 100)
    const s = await settings.getSettings(h.db)
    expect(s.newPerDay).toBe(42) // 已知键照常
    expect(s).not.toHaveProperty('tts.speechRate') // 未知键不进结果、不报错
    expect(toast.error).not.toHaveBeenCalled() // 未知键不算坏值，不提示
  })

  it('阅读两项：默认 16/serif，值域外的字号回退默认（阅读器排版直接吃这两个值）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(settings.DEFAULT_SETTINGS).toMatchObject({ readingFontSize: 16, readingFontFamily: 'serif' })

    // 别端流入的越界字号不能直接喂给排版引擎（会把正文排成不可读的巨字），读路径按 14–28 收口
    rawInsert(h, 'reading.fontSize', '99')
    expect((await settings.getSettings(h.db)).readingFontSize).toBe(16)
    expect(toast.error).toHaveBeenCalled()

    await settings.updateSettings(h.db, { readingFontSize: 20, readingFontFamily: 'sans' }, 100)
    expect(await settings.getSettings(h.db)).toMatchObject({
      readingFontSize: 20,
      readingFontFamily: 'sans',
    })
    errSpy.mockRestore()
  })

  it('远端按键应用；本地脏 editTime 更大则保留该键（键级 LWW 仲裁）', async () => {
    await runBatch(h.db, [
      collections.settings.applyRemoteStmt(h.db, wireSettings({ value: '40', editTime: 100 })),
    ])
    expect(readRow(h, 'wordbook.newPerDay')).toMatchObject({ value: '40', dirty: 0 })
    // 本地脏 editTime 更大 → 保留本地
    await settings.updateSettings(h.db, { newPerDay: 55 }, 200)
    await runBatch(h.db, [
      collections.settings.applyRemoteStmt(h.db, wireSettings({ value: '99', editTime: 150 })),
    ])
    expect(readRow(h, 'wordbook.newPerDay')).toMatchObject({ value: '55', dirty: 1 })
  })

  it('collectDirty 出脏键行（settingKey + value + editTime）；compare-and-clear', async () => {
    await settings.updateSettings(h.db, { accent: 'uk' }, 100)
    const dirty = await collections.settings.collectDirty(h.db)
    expect(dirty).toHaveLength(1)
    expect(dirty[0]).toMatchObject({ settingKey: 'wordcard.accent', value: '"uk"', editTime: 100, syncVer: 0 })
    await runBatch(h.db, collections.settings.clearAcceptedStmts(h.db, dirty))
    expect(readRow(h, 'wordcard.accent')).toMatchObject({ dirty: 0 })
  })
})
