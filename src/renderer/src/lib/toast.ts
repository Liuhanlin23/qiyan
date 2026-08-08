// Toast 命令桥：把 CDS 的 components/ui/toast 组件包成命令式 API（toast.error/warning/info），
// 供响应拦截器等「非组件上下文」弹错。宿主见 components/common/Toaster.tsx（全局挂一次）。
// 详见 docs/desktop/api-convention.md「统一错误提示（toast）」。
import type { ToastVariant } from '@/components/ui/toast'

export interface ToastItem {
  id: number
  variant: ToastVariant
  message: string
}

let items: ToastItem[] = []
let seq = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** 供 useSyncExternalStore 订阅的极简发布订阅 store。 */
export const toastStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot(): ToastItem[] {
    return items
  },
}

/** 通知消失（自动超时或手动关闭时调用）。 */
export function dismissToast(id: number): void {
  items = items.filter((item) => item.id !== id)
  emit()
}

function push(variant: ToastVariant, message: string): void {
  items = [...items, { id: ++seq, variant, message }]
  emit()
}

/** 命令式弹错入口，供拦截器 / 业务层调用。 */
export const toast = {
  error: (message: string): void => push('danger', message),
  warning: (message: string): void => push('warning', message),
  info: (message: string): void => push('info', message),
}
