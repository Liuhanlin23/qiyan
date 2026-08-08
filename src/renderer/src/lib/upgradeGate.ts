// 升级挡板命令桥：把「服务端要求升级客户端」这个全局阻断态包成命令式 API，供响应拦截器等
// 「非组件上下文」触发。宿主见 components/common/UpgradeGateDialog.tsx（与路由平级挂一次）。
// 与 lib/toast.ts 同为**零依赖叶子**：不 import api/ 或 sync/，避免 request → UI → request 成环。
// 业务规则见 docs/feature/client-protocol.md。
let open = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** 供 useSyncExternalStore 订阅的极简发布订阅 store（snapshot = 是否显示阻断弹窗）。 */
export const upgradeGateStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot(): boolean {
    return open
  },
}

/**
 * 落下挡板（幂等）：多个并发请求同时撞 426 只置位一次。
 * 无对应的 hide——挡板一旦落下，唯一出路是重试成功后整页 reload。
 */
export function showUpgradeGate(): void {
  if (open) return
  open = true
  emit()
}
