// 登录态编排：登录 = setAuth → db.open → sync.start；登出 = sync.stop → db.close → clearAuth；
// 冷启动 = getAuth → 同上。把「凭据落盘 / 开关库 / 起停引擎」三件事收敛在一处。
import type { AuthRecord } from '../../../shared/auth'
import { authBridge } from '@/platform'
import { closeUserDb, db, openUserDb } from '@/db/client'
import { primeClockOffset } from '@/sync/clock'
import { startEngine, stopEngine } from '@/sync'
import { clearRecord, getToken, getUser, setRecord } from './tokenStore'

export { getToken, getUser } from './tokenStore'

/** 是否已登录（内存中有 token）。 */
export const isAuthenticated = (): boolean => getToken() !== null
/** 当前登录邮箱；未登录返回 null。 */
export const readAuthEmail = (): string | null => getUser()?.email ?? null

/** 应用启动时从 main 读回持久化登录态，回填内存 + 开库 + 起引擎；须在首帧渲染前 await。 */
export async function initSession(): Promise<void> {
  const record = await authBridge.get()
  if (!record) return
  // 先开库、成功后才置内存登录态：否则「已登录但库未开」会被路由守卫按已登录渲染，本地读写全抛 db not open 且无恢复路径。
  try {
    await openUserDb(record.userId)
  } catch (e) {
    // 冷启动开库失败：不置登录态、不清磁盘凭据（下次启动可重试），按未登录返回（main.tsx 守卫据此渲染登录页）。
    console.error('[session] 冷启动开库失败，保留磁盘凭据待下次重试，本次按未登录渲染', e)
    return
  }
  setRecord(record)
  await startSyncAfterOpen()
}

/** 登录成功：写内存 + 加密落盘 + 开库 + 起引擎。 */
export async function signIn(record: AuthRecord): Promise<void> {
  // 先开库：失败直接抛给登录页展示，此时尚未置任何内存/磁盘登录态，无坏状态残留。
  await openUserDb(record.userId)
  setRecord(record)
  await authBridge.set(record)
  await startSyncAfterOpen()
}

/**
 * 开库并置登录态之后：预热校准钟 + 起同步引擎。二者失败仅降级（同步不可用），不回滚已建立的会话，
 * 但必须留日志（不得静默）——库已开、会话可用，同步引擎下次回合可自愈。
 */
async function startSyncAfterOpen(): Promise<void> {
  try {
    await primeClockOffset(db) // 预热校准钟内存 offset，供首个 pull 前的同步写路径取时
    startEngine()
  } catch (e) {
    console.warn('[session] 同步引擎启动失败，会话可用但同步降级', e)
  }
}

/** 登出 / 凭据失效：停引擎 + 关库 + 清落盘 + 清内存。 */
export async function signOut(): Promise<void> {
  stopEngine()
  await closeUserDb()
  await authBridge.clear()
  clearRecord()
}
