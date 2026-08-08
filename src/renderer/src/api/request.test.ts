// 请求层拦截器单测：请求头注入（版本挡板契约 X-Client-Version + Authorization）
// 与 HTTP 层错误分流（426 版本挡板 vs 普通网络错误）。
// 版本头必须**无条件**带上——服务端对全部端点（含 /auth/**）做相等比对，缺头即 426
// （docs/feature/client-protocol.md）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'

// toast 桥依赖 CDS 组件，mock 掉；同时用于断言 426 **不**弹 toast（弹窗已覆盖提示职责）。
const errorSpy = vi.fn()
vi.mock('@/lib/toast', () => ({
  toast: { error: (m: string) => errorSpy(m) },
}))

// getToken 是登录态真源，逐例控制；同模块其余导出（getRecord/setToken，滑动续期用）保留真实现。
vi.mock('@/session/tokenStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/session/tokenStore')>()),
  getToken: vi.fn(),
}))

import { getToken } from '@/session/tokenStore'
import {
  applyRequestHeaders,
  handleHttpError,
  NetworkError,
  setUpgradeRequiredHandler,
  UpgradeRequiredError,
} from './request'

const mockGetToken = vi.mocked(getToken)

const newConfig = (): InternalAxiosRequestConfig =>
  ({ headers: new AxiosHeaders() }) as InternalAxiosRequestConfig

beforeEach(() => {
  vi.clearAllMocks()
})

describe('applyRequestHeaders', () => {
  it('无 token → 仍带 X-Client-Version，且不注入 Authorization', () => {
    mockGetToken.mockReturnValue(null)
    const config = applyRequestHeaders(newConfig())
    expect(config.headers.get('X-Client-Version')).toBe(__APP_VERSION__)
    expect(config.headers.Authorization).toBeUndefined()
  })

  it('有 token → 注入 Authorization 且仍带版本头', () => {
    mockGetToken.mockReturnValue('t1')
    const config = applyRequestHeaders(newConfig())
    expect(config.headers.Authorization).toBe('Bearer t1')
    expect(config.headers.get('X-Client-Version')).toBe(__APP_VERSION__)
  })
})

// HTTP 426 = 服务端版本挡板。静默与交互两种模式**处置一致**：都触发升级 handler、都 reject
// UpgradeRequiredError、都不 toast——静默模式若把 426 吞成 NetworkError，同步引擎撞挡板就成了
// 普通网络错误静默退避，正是「能用但同步默默死了」的中间态（client-protocol.md）。
describe('handleHttpError', () => {
  const upgradeSpy = vi.fn()

  afterEach(() => {
    setUpgradeRequiredHandler(null) // 模块级钩子是单例，逐例复位
  })

  it('426 + 静默模式 → 触发升级 handler 且 reject UpgradeRequiredError', async () => {
    setUpgradeRequiredHandler(upgradeSpy)
    await expect(
      handleHttpError({ config: { silent: true }, response: { status: 426 } }),
    ).rejects.toBeInstanceOf(UpgradeRequiredError)
    expect(upgradeSpy).toHaveBeenCalledTimes(1)
  })

  it('426 + 交互模式 → 同样处置，且不 toast', async () => {
    setUpgradeRequiredHandler(upgradeSpy)
    await expect(handleHttpError({ config: {}, response: { status: 426 } })).rejects.toBeInstanceOf(
      UpgradeRequiredError,
    )
    expect(upgradeSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('426 且 handler 未注册 → 不抛 TypeError，仍 reject UpgradeRequiredError', async () => {
    setUpgradeRequiredHandler(null)
    await expect(
      handleHttpError({ config: { silent: true }, response: { status: 426 } }),
    ).rejects.toBeInstanceOf(UpgradeRequiredError)
  })

  it('非 426 + 静默模式 → NetworkError（离线不挡）', async () => {
    setUpgradeRequiredHandler(upgradeSpy)
    await expect(
      handleHttpError({ config: { silent: true }, message: 'timeout' }),
    ).rejects.toBeInstanceOf(NetworkError)
    expect(upgradeSpy).not.toHaveBeenCalled()
  })

  it('非 426 + 交互模式 → toast 且 reject 原错误', async () => {
    const original = { config: {}, response: { status: 500 } }
    await expect(handleHttpError(original)).rejects.toBe(original)
    expect(errorSpy).toHaveBeenCalledWith('网络服务出错，请稍后重试')
  })
})
