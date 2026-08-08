// 同步引擎 fail-loudly 单测（sync.md §3.3）：服务端跳过非法行时客户端必须提示用户反馈，
// 且计数为 0 时保持静默、有跳过时只弹一条（跳过后 dirty 已清、不再重推，天然一次）。
// 业务语义（非法行不能静默丢失）变了这测试就该失败（规则 7）。
import { afterEach, describe, expect, it, vi } from 'vitest'

// 只测提示决策，隔离 toast/console 副作用；toast 桥依赖 CDS 组件，mock 掉即可。
const errorSpy = vi.fn()
const warningSpy = vi.fn()
vi.mock('@/lib/toast', () => ({
  toast: { error: (m: string) => errorSpy(m), warning: (m: string) => warningSpy(m) },
}))

import Database from 'better-sqlite3'
import { drizzle as betterDrizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as proxyDrizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { runBatch as execBatch, runStmt as execStmt } from '../../../main/dbExecutor'
import { runBatch, type Db } from '@/db/client'
import { settings as settingsCollection } from '@/settings/collection'
import * as settingsData from '@/settings/settings'

import { notifyClockSkew, notifySkippedRows } from './engine'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../drizzle', import.meta.url))

/** 模拟一台设备：进程内 better-sqlite3 + 迁移建库，走与生产同一套数据函数。 */
function makeDevice(): { db: Db; sqlite: Database.Database } {
  const sqlite = new Database(':memory:')
  migrate(betterDrizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR })
  const db = proxyDrizzle(
    async (sql, params, method) => execStmt(sqlite, { sql, params, method }) as { rows: any[] },
    async (queries) => execBatch(sqlite, queries) as { rows: any[] }[],
  )
  return { db, sqlite }
}

describe('notifySkippedRows（服务端跳过非法行的 fail-loudly 提示）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('计数 > 0 → toast 一条 + console.error 明细', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    notifySkippedRows(3)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toContain('3')
    expect(consoleSpy).toHaveBeenCalledTimes(1)
  })

  it('计数为 0 → 无任何提示', () => {
    errorSpy.mockClear()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    notifySkippedRows(0)
    expect(errorSpy).not.toHaveBeenCalled()
    expect(consoleSpy).not.toHaveBeenCalled()
  })
})

// 时钟偏差 fail-loudly：偏差超 5 分钟必须每次同步都提醒（故意不节流，让用户持续意识到设备时间异常）。
// 业务语义（超阈值 = 弹、阈值内 = 静默、且不得去重节流）变了这测试就该失败（规则 7）。
describe('notifyClockSkew（设备时间偏差的 fail-loudly 提示）', () => {
  afterEach(() => {
    warningSpy.mockClear()
    vi.restoreAllMocks()
  })

  it('偏差超 5 分钟（快 / 慢两向）→ toast.warning + console.warn', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    notifyClockSkew(6 * 60 * 1000) // 本地慢 6 分钟
    notifyClockSkew(-6 * 60 * 1000) // 本地快 6 分钟
    expect(warningSpy).toHaveBeenCalledTimes(2)
    expect(consoleSpy).toHaveBeenCalledTimes(2)
  })

  it('故意不节流：同一大偏差连续三回合弹三次（用户每次同步都被提醒）', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    notifyClockSkew(10 * 60 * 1000)
    notifyClockSkew(10 * 60 * 1000)
    notifyClockSkew(10 * 60 * 1000)
    expect(warningSpy).toHaveBeenCalledTimes(3)
  })

  it('阈值内偏差 / 校准被忽略（null）→ 静默', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    notifyClockSkew(5 * 60 * 1000) // 恰好 5 分钟，不超阈值（严格大于才提示）
    notifyClockSkew(1234) // 亚秒级正常偏差
    notifyClockSkew(null) // serverTimeMs 非法，calibrate 未应用
    expect(warningSpy).not.toHaveBeenCalled()
    expect(consoleSpy).not.toHaveBeenCalled()
  })
})

// 本次重构存在的理由：settings 键级 KV 下，两端并发改不同键互不覆盖（宽表整行 LWW 会互相误伤）。
// 走引擎 pull/push 的真实机械件（collectDirty 收脏 → applyRemoteStmt 逐行应用）。此测试失败即重构失败（规则 7）。
describe('两端并发改不同键，同步收敛后都存活（键级 KV）', () => {
  it('A 改 newPerDay、B 改 accent，互拉后两键在两端都在', async () => {
    const A = makeDevice()
    const B = makeDevice()
    // 两端各自离线改不同键（各产生一行脏行）
    await settingsData.updateSettings(A.db, { newPerDay: 33 }, 100)
    await settingsData.updateSettings(B.db, { accent: 'uk' }, 100)
    // 引擎 push 侧：各自收集脏行为 wire 行（模拟号池下发给对端）
    const fromA = await settingsCollection.collectDirty(A.db)
    const fromB = await settingsCollection.collectDirty(B.db)
    // 引擎 pull 侧：交叉逐行应用对端变更
    await runBatch(
      A.db,
      fromB.map((r) => settingsCollection.applyRemoteStmt(A.db, r)),
    )
    await runBatch(
      B.db,
      fromA.map((r) => settingsCollection.applyRemoteStmt(B.db, r)),
    )
    // 两端都收敛到「两键都改了」——键级独立，谁都没被对端整行覆盖
    expect(await settingsData.getSettings(A.db)).toMatchObject({ newPerDay: 33, accent: 'uk' })
    expect(await settingsData.getSettings(B.db)).toMatchObject({ newPerDay: 33, accent: 'uk' })
  })
})
