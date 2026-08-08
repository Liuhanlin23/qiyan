// 自动更新状态 store：把 main 推来的 electron-updater 原始事件（updaterBridge.onEvent）
// 折叠成展示状态，供挡板弹窗渲染「下载中 / 重启更新」。业务规则见 docs/feature/client-protocol.md §2：
// 检查时机 = 启动一次 + 撞 426 时（与挡板同节奏，运行期不轮询）；更新的强制点只有挡板，
// 这里不催——没被挡的用户静默下好，下次退出时自动装上（main 侧 autoInstallOnAppQuit）。
// 与 upgradeGate 不同，这里不是零依赖叶子（依赖 platform 桥），但仍无环：platform 不 import 业务。
import { updaterBridge } from '@/platform'
import type { UpdateEvent } from '../../../shared/updater'

export type AppUpdateState =
  | { phase: 'idle' } // 未检查 / dev 不支持
  | { phase: 'checking' }
  | { phase: 'latest' } // 已是最新
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'downloaded'; version: string }
  | { phase: 'error'; message: string }

/**
 * 纯折叠：事件 → 下一状态。autoDownload 开启，available 即视为下载已开始。
 * downloaded 是终态（新版本已落盘，任何后续事件都不该让「重启更新」按钮消失）；
 * 无 available 前置的 progress 也进 downloading——事件乱序防御，别让 UI 卡在 checking。
 */
export function reduceUpdateEvent(state: AppUpdateState, event: UpdateEvent): AppUpdateState {
  if (state.phase === 'downloaded') return state
  switch (event.type) {
    case 'checking':
      return { phase: 'checking' }
    case 'available':
      return { phase: 'downloading', version: event.version, percent: 0 }
    case 'not-available':
      return { phase: 'latest' }
    case 'progress':
      return {
        phase: 'downloading',
        version: state.phase === 'downloading' ? state.version : '',
        percent: event.percent,
      }
    case 'downloaded':
      return { phase: 'downloaded', version: event.version }
    case 'error':
      return { phase: 'error', message: event.message }
  }
}

let state: AppUpdateState = { phase: 'idle' }
let wired = false
const listeners = new Set<() => void>()

function dispatch(event: UpdateEvent): void {
  const next = reduceUpdateEvent(state, event)
  if (next === state) return
  state = next
  for (const listener of listeners) listener()
}

/** 供 useSyncExternalStore 订阅（对齐 upgradeGateStore 的形状）。 */
export const appUpdateStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot(): AppUpdateState {
    return state
  },
}

/** 组合根（main.tsx）调用一次：接上 main 的事件推流。幂等——单窗口应用不退订。 */
export function initAppUpdate(): void {
  if (wired) return
  wired = true
  updaterBridge.onEvent(dispatch)
}

/**
 * 触发一次「检查 +（有新版则）下载」。幂等守卫：checking / downloading 中不重复触发，
 * downloaded 后更不需要；latest / error 后放行——挡板弹窗的「重试」要能再试一次。
 * dev（bridge.check 返回 false）停在 idle，弹窗落回「下载页 + 重试」形态。
 */
export async function ensureUpdateCheck(): Promise<void> {
  if (state.phase !== 'idle' && state.phase !== 'latest' && state.phase !== 'error') return
  await updaterBridge.check()
}

/** 「重启更新」：退出 → 装新版 → 自动重启（main 侧下载未完成时是 no-op）。 */
export function installUpdate(): Promise<void> {
  return updaterBridge.install()
}

/** 仅测试用：回到初始状态（模块级单例在用例间共享）。 */
export function resetAppUpdateForTest(): void {
  state = { phase: 'idle' }
  wired = false
  listeners.clear()
}
