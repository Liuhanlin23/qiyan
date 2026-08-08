// 自动更新状态 store 单测：main 推来的原始事件 → 展示状态的折叠逻辑（reduceUpdateEvent），
// 以及触发检查的幂等守卫（ensureUpdateCheck）。事件序列由 electron-updater 决定，
// 折叠规则见 docs/feature/client-protocol.md §2。
import { beforeEach, describe, expect, it, vi } from 'vitest'

// platform 桥全量替换：appUpdate 只消费 updaterBridge，其余桥不需要真实现。
vi.mock('@/platform', () => ({
  updaterBridge: {
    check: vi.fn(),
    install: vi.fn(),
    onEvent: vi.fn(),
  },
}))

import { updaterBridge } from '@/platform'
import {
  type AppUpdateState,
  appUpdateStore,
  ensureUpdateCheck,
  initAppUpdate,
  installUpdate,
  reduceUpdateEvent,
  resetAppUpdateForTest,
} from './appUpdate'

const mockBridge = vi.mocked(updaterBridge)

beforeEach(() => {
  vi.clearAllMocks()
  resetAppUpdateForTest()
})

describe('reduceUpdateEvent（纯折叠）', () => {
  const idle: AppUpdateState = { phase: 'idle' }

  it('happy path：checking → available 即开始下载 → progress → downloaded', () => {
    let s = reduceUpdateEvent(idle, { type: 'checking' })
    expect(s).toEqual({ phase: 'checking' })

    s = reduceUpdateEvent(s, { type: 'available', version: '0.0.2' })
    expect(s).toEqual({ phase: 'downloading', version: '0.0.2', percent: 0 })

    s = reduceUpdateEvent(s, { type: 'progress', percent: 42 })
    expect(s).toEqual({ phase: 'downloading', version: '0.0.2', percent: 42 })

    s = reduceUpdateEvent(s, { type: 'downloaded', version: '0.0.2' })
    expect(s).toEqual({ phase: 'downloaded', version: '0.0.2' })
  })

  it('not-available → latest（已是最新）', () => {
    const s = reduceUpdateEvent({ phase: 'checking' }, { type: 'not-available' })
    expect(s).toEqual({ phase: 'latest' })
  })

  it('error → error（带 message）', () => {
    const s = reduceUpdateEvent({ phase: 'downloading', version: '0.0.2', percent: 10 }, { type: 'error', message: 'boom' })
    expect(s).toEqual({ phase: 'error', message: 'boom' })
  })

  it('downloaded 是终态：后续任何事件都不回退（否则「重启更新」按钮会消失）', () => {
    const done: AppUpdateState = { phase: 'downloaded', version: '0.0.2' }
    expect(reduceUpdateEvent(done, { type: 'checking' })).toEqual(done)
    expect(reduceUpdateEvent(done, { type: 'error', message: 'x' })).toEqual(done)
    expect(reduceUpdateEvent(done, { type: 'progress', percent: 1 })).toEqual(done)
  })

  it('无 available 前置的 progress 也进 downloading（事件乱序防御，版本号缺省空串）', () => {
    const s = reduceUpdateEvent(idle, { type: 'progress', percent: 5 })
    expect(s).toEqual({ phase: 'downloading', version: '', percent: 5 })
  })
})

describe('ensureUpdateCheck（幂等守卫）', () => {
  it('idle 时触发 check；不支持（dev）则停在 idle', async () => {
    mockBridge.check.mockResolvedValue(false)
    mockBridge.onEvent.mockReturnValue(() => {})
    initAppUpdate()
    await ensureUpdateCheck()
    expect(mockBridge.check).toHaveBeenCalledTimes(1)
    expect(appUpdateStore.getSnapshot()).toEqual({ phase: 'idle' })
  })

  it('checking / downloading / downloaded 中不重复触发', async () => {
    mockBridge.check.mockResolvedValue(true)
    let push: (e: UpdateEvent) => void = () => {}
    mockBridge.onEvent.mockImplementation((cb) => {
      push = cb
      return () => {}
    })
    initAppUpdate()

    await ensureUpdateCheck()
    expect(mockBridge.check).toHaveBeenCalledTimes(1)

    push({ type: 'checking' })
    await ensureUpdateCheck()
    push({ type: 'available', version: '0.0.2' })
    await ensureUpdateCheck()
    push({ type: 'downloaded', version: '0.0.2' })
    await ensureUpdateCheck()
    expect(mockBridge.check).toHaveBeenCalledTimes(1)
  })

  it('latest / error 后允许再查（挡板弹窗的重试口）', async () => {
    mockBridge.check.mockResolvedValue(true)
    let push: (e: UpdateEvent) => void = () => {}
    mockBridge.onEvent.mockImplementation((cb) => {
      push = cb
      return () => {}
    })
    initAppUpdate()

    await ensureUpdateCheck()
    push({ type: 'not-available' })
    await ensureUpdateCheck()
    expect(mockBridge.check).toHaveBeenCalledTimes(2)

    push({ type: 'error', message: 'net down' })
    await ensureUpdateCheck()
    expect(mockBridge.check).toHaveBeenCalledTimes(3)
  })

  it('事件推进 snapshot 并通知订阅者', () => {
    mockBridge.onEvent.mockImplementation((cb) => {
      cb({ type: 'available', version: '0.0.3' })
      return () => {}
    })
    const listener = vi.fn()
    appUpdateStore.subscribe(listener)
    initAppUpdate()
    expect(appUpdateStore.getSnapshot()).toEqual({ phase: 'downloading', version: '0.0.3', percent: 0 })
    expect(listener).toHaveBeenCalled()
  })

  it('initAppUpdate 幂等：只接线一次', () => {
    mockBridge.onEvent.mockReturnValue(() => {})
    initAppUpdate()
    initAppUpdate()
    expect(mockBridge.onEvent).toHaveBeenCalledTimes(1)
  })
})

describe('installUpdate', () => {
  it('转发 bridge.install', async () => {
    mockBridge.install.mockResolvedValue(undefined)
    await installUpdate()
    expect(mockBridge.install).toHaveBeenCalledTimes(1)
  })
})
