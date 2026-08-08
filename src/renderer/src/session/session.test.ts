// 会话编排的失败回滚护栏单测（修复执行文档 T5）：核心 intent = 开库失败不留「已登录但库未开」坏状态。
// 冷启动开库失败按未登录处理且保留磁盘凭据待重试；登录开库失败不留任何内存/磁盘凭据并抛错给登录页；
// 校准钟 / 引擎启动失败仅降级、不回滚已建立的会话。业务语义变了这些测试就该失败（规则 7）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthRecord } from '../../../shared/auth'

// 隔离外部副作用：桥（凭据落盘）、开库、校准钟、同步引擎全部 mock；tokenStore 用真实实现以断言内存登录态。
vi.mock('@/platform', () => ({ authBridge: { get: vi.fn(), set: vi.fn(), clear: vi.fn() } }))
vi.mock('@/db/client', () => ({ openUserDb: vi.fn(), closeUserDb: vi.fn(), db: {} }))
vi.mock('@/sync/clock', () => ({ primeClockOffset: vi.fn() }))
vi.mock('@/sync', () => ({ startEngine: vi.fn(), stopEngine: vi.fn() }))

import { authBridge } from '@/platform'
import { openUserDb } from '@/db/client'
import { primeClockOffset } from '@/sync/clock'
import { startEngine } from '@/sync'
import { initSession, signIn, isAuthenticated } from './index'
import { clearRecord } from './tokenStore'

const RECORD: AuthRecord = { userId: 1, email: 'a@b.com', token: 'tok' }

const m = {
  authGet: vi.mocked(authBridge.get),
  authSet: vi.mocked(authBridge.set),
  authClear: vi.mocked(authBridge.clear),
  openUserDb: vi.mocked(openUserDb),
  primeClockOffset: vi.mocked(primeClockOffset),
  startEngine: vi.mocked(startEngine),
}

beforeEach(() => {
  vi.clearAllMocks()
  clearRecord() // tokenStore 是模块级单例，逐例复位内存登录态
  m.primeClockOffset.mockResolvedValue(undefined)
  m.authSet.mockResolvedValue(undefined)
  m.authClear.mockResolvedValue(undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('initSession（冷启动）', () => {
  it('开库失败 → 未登录、保留磁盘凭据、不起引擎、不抛出', async () => {
    m.authGet.mockResolvedValue(RECORD)
    m.openUserDb.mockRejectedValue(new Error('db open fail'))
    await expect(initSession()).resolves.toBeUndefined()
    expect(isAuthenticated()).toBe(false) // 未置内存登录态 → 路由守卫按未登录渲染
    expect(m.authClear).not.toHaveBeenCalled() // 磁盘凭据保留，下次启动可重试
    expect(m.startEngine).not.toHaveBeenCalled()
  })

  it('开库成功 → 已登录、起引擎', async () => {
    m.authGet.mockResolvedValue(RECORD)
    m.openUserDb.mockResolvedValue(undefined)
    await initSession()
    expect(isAuthenticated()).toBe(true)
    expect(m.startEngine).toHaveBeenCalledTimes(1)
  })

  it('无持久化凭据 → 保持未登录、不开库', async () => {
    m.authGet.mockResolvedValue(null)
    await initSession()
    expect(isAuthenticated()).toBe(false)
    expect(m.openUserDb).not.toHaveBeenCalled()
  })

  it('校准钟/引擎启动失败 → 仍登录成功（同步降级，不回滚会话）', async () => {
    m.authGet.mockResolvedValue(RECORD)
    m.openUserDb.mockResolvedValue(undefined)
    m.primeClockOffset.mockRejectedValue(new Error('prime fail'))
    await expect(initSession()).resolves.toBeUndefined()
    expect(isAuthenticated()).toBe(true) // 库已开、会话可用，不因同步降级而丢登录态
  })
})

describe('signIn（登录）', () => {
  it('开库失败 → 抛错、内存与磁盘均无残留登录态', async () => {
    m.openUserDb.mockRejectedValue(new Error('db open fail'))
    await expect(signIn(RECORD)).rejects.toThrow()
    expect(isAuthenticated()).toBe(false)
    expect(m.authSet).not.toHaveBeenCalled() // 磁盘无凭据落盘
    expect(m.startEngine).not.toHaveBeenCalled()
  })

  it('开库成功 → 已登录、落盘凭据、起引擎', async () => {
    m.openUserDb.mockResolvedValue(undefined)
    await signIn(RECORD)
    expect(isAuthenticated()).toBe(true)
    expect(m.authSet).toHaveBeenCalledWith(RECORD)
    expect(m.startEngine).toHaveBeenCalledTimes(1)
  })
})
