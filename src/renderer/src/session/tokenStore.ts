// 登录凭据的内存态（token 是真凭据，userId/email 供 UI 展示）。**无依赖**——api 与 session 都依赖它，
// 避免 api↔session 循环。真源由 main 用 safeStorage 加密落盘（见 platform/auth 桥）。
import type { AuthRecord } from '../../../shared/auth'

interface CurrentUser {
  userId: number
  email: string
}

let mem: AuthRecord | null = null

export const getToken = (): string | null => mem?.token ?? null
export const getUser = (): CurrentUser | null =>
  mem ? { userId: mem.userId, email: mem.email } : null
export const getRecord = (): AuthRecord | null => mem

export const setRecord = (record: AuthRecord): void => {
  mem = record
}
export const clearRecord = (): void => {
  mem = null
}

/** 滑动续期：只换 token（userId/email 不变）；未登录时忽略。 */
export const setToken = (token: string): void => {
  if (mem) mem = { ...mem, token }
}
