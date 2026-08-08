// 升级挡板命令桥单测：426 一旦命中就必须**置位且通知**订阅者（弹窗才会出现），
// 且重复命中（多个并发请求同时撞挡板）不得把已开的弹窗关掉——幂等是硬要求。
import { describe, expect, it, vi } from 'vitest'
import { showUpgradeGate, upgradeGateStore } from './upgradeGate'

describe('upgradeGateStore', () => {
  // store 无复位口（挡板一旦落下唯一出路是整页 reload），故初始态只能在文件内首例断言。
  it('showUpgradeGate 置位并通知订阅者', () => {
    const listener = vi.fn()
    const unsubscribe = upgradeGateStore.subscribe(listener)
    expect(upgradeGateStore.getSnapshot()).toBe(false)

    showUpgradeGate()

    expect(upgradeGateStore.getSnapshot()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('重复调用幂等：仍为 true 且不再通知（并发请求同时撞挡板）', () => {
    showUpgradeGate() // 本例自包含：先确保已置位
    const listener = vi.fn()
    const unsubscribe = upgradeGateStore.subscribe(listener)

    showUpgradeGate()

    expect(upgradeGateStore.getSnapshot()).toBe(true)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})
