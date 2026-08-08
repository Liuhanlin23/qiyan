// 跨进程共享的登录凭据契约（main 落盘 / preload 传参 / renderer 消费的单一事实源）。
/** 登录凭据记录：token 为凭据，userId/email 供 UI 展示。 */
export interface AuthRecord {
  token: string
  userId: number
  email: string
}
