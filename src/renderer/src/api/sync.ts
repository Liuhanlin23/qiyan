// 同步端点：/sync/pull、/sync/push（静默模式）。引擎调用，错误抛类型化异常（AuthError 停手、其余等下一跳）。
// 协议不设自身版本头（sync.md §1，旧协议版本头已随 v2 删除）；跨版本防护移交客户端协议版本机制。
import { apiPost } from './request'
import type {
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from '@/sync/protocol'

export const pull = (req: SyncPullRequest): Promise<SyncPullResponse> =>
  apiPost<SyncPullResponse>('/sync/pull', req)

export const push = (req: SyncPushRequest): Promise<SyncPushResponse> =>
  apiPost<SyncPushResponse>('/sync/push', req)
