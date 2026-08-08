// 版本探测 / 重试单测：探测**只关心是否 426**。未登录（AuthError）、离线（NetworkError）
// 都不算被挡——「离线不挡」是硬约束，误判会让断网用户被永久锁在升级弹窗里
// （docs/feature/client-protocol.md）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

// partial mock：只替换取数口 apiGet，错误类要用真实现（instanceof 判断依赖同一个类对象）。
vi.mock('@/api/request', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/request')>()),
  apiGet: vi.fn(),
}))

import { apiGet, AuthError, NetworkError, UpgradeRequiredError } from '@/api/request'
import { probeClientVersion, retryUpgradeGate } from './clientGate'

const mockApiGet = vi.mocked(apiGet)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('probeClientVersion', () => {
  it('请求成功 → true（版本匹配）', async () => {
    mockApiGet.mockResolvedValue(undefined)
    await expect(probeClientVersion()).resolves.toBe(true)
  })

  it('遇 UpgradeRequiredError → false（被挡）', async () => {
    mockApiGet.mockRejectedValue(new UpgradeRequiredError('版本不匹配'))
    await expect(probeClientVersion()).resolves.toBe(false)
  })

  it('遇离线 / 未登录等其他错误 → true（不挡）', async () => {
    mockApiGet.mockRejectedValue(new NetworkError('offline'))
    await expect(probeClientVersion()).resolves.toBe(true)

    mockApiGet.mockRejectedValue(new AuthError('未登录'))
    await expect(probeClientVersion()).resolves.toBe(true)
  })
})

describe('retryUpgradeGate', () => {
  it('探测通过 → reload 并返回 true', async () => {
    mockApiGet.mockResolvedValue(undefined)
    const reload = vi.fn()
    await expect(retryUpgradeGate(reload)).resolves.toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('探测仍被挡 → 不 reload 且返回 false', async () => {
    mockApiGet.mockRejectedValue(new UpgradeRequiredError('版本不匹配'))
    const reload = vi.fn()
    await expect(retryUpgradeGate(reload)).resolves.toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
