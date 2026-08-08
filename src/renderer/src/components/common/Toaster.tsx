import { useSyncExternalStore } from 'react'
import { Toast, ToastProvider, ToastViewport } from '@/components/ui/toast'
import { dismissToast, toastStore } from '@/lib/toast'

/**
 * Toast 宿主：全局挂载一次（见 main.tsx），订阅命令桥 store 渲染通知。
 * 命令式触发见 lib/toast.ts 的 toast.error / warning / info。
 */
export function Toaster(): React.JSX.Element {
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot)
  return (
    <ToastProvider swipeDirection="right">
      {items.map((item) => (
        <Toast
          key={item.id}
          variant={item.variant}
          open
          onOpenChange={(open) => {
            if (!open) dismissToast(item.id)
          }}
        >
          {item.message}
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}
