// 用户设置共享模块门面：跨域用户偏好的唯一读写入口。绑定库单例 db + 用校准钟同步取 editTime。
// user_setting 是键级 KV 的 LWW 集合（跨域偏好，sync.md §2 / db/01）；同步件在 ./collection，由 sync/engine 挂接。
import { db } from '@/db/client'
import { calibratedNowSync } from '@/sync/clock'
import * as settings from './settings'
import type { Settings } from './types'

export { DEFAULT_SETTINGS } from './settings'
export type { Settings } from './types'

/** 本进程内的设置变更订阅者（见 onSettingsChange）。 */
const listeners = new Set<() => void>()

/** 读设置（按键装配：缺键补默认、坏值回退默认并大声提示）。 */
export const getSettings = (): Promise<Settings> => settings.getSettings(db)

/** 改设置（本地写置 dirty + 打 editTime，下一同步回合带走），写完广播给本进程内的订阅者。 */
export const updateSettings = async (patch: Partial<Settings>): Promise<void> => {
  await settings.updateSettings(db, patch, calibratedNowSync())
  for (const fn of listeners) fn()
}

/**
 * 订阅设置变更，返回退订函数。只广播「本进程调 updateSettings 改了设置」这一件事（不带 payload，
 * 订阅方自行 getSettings 重读）——供设置弹窗与正在生效的界面（如阅读器排版）即时同步，
 * 免得让人关掉弹窗、重开一本书才看见改动。同步回合从远端拉来的改动不走这里（下次读取自然带上）。
 */
export function onSettingsChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
