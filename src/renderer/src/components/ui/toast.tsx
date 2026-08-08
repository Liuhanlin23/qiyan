import * as React from 'react'
import { Toast as ToastPrimitive } from 'radix-ui'
import { Info, TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './button'

/**
 * 通知气泡，右上角定时消失，支持向右滑动消除。
 * info 为中性样式，warning / danger 使用对应语义色。
 * debugDetails 可附加等宽脚注（如错误详情）。
 */

const ToastProvider = ToastPrimitive.Provider

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(function ToastViewport({ className, ...props }, ref) {
  return (
    <ToastPrimitive.Viewport
      ref={ref}
      className={cn(
        'fixed right-0 top-0 z-[60] flex flex-col gap-3 p-4 outline-none',
        'pointer-events-none',
        className
      )}
      {...props}
    />
  )
})

type ToastVariant = 'info' | 'warning' | 'danger'

const variantBubble: Record<ToastVariant, string> = {
  info: 'bg-bg-000 border-border-100',
  warning: 'bg-warning-900 border-warning-200',
  danger: 'bg-danger-900 border-danger-200',
}

const variantRowText: Record<ToastVariant, string> = {
  info: '',
  warning: 'text-warning-000',
  danger: 'text-danger-000',
}

const variantClose: Record<ToastVariant, string> = {
  info: '',
  warning: '!text-current hover:!bg-warning-100/10 hover:!text-current',
  danger: '!text-current hover:!bg-danger-100/10 hover:!text-current',
}

const variantIcon: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  info: Info,
  warning: TriangleAlert,
  danger: TriangleAlert,
}

interface ToastProps extends Omit<React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>, 'title'> {
  variant?: ToastVariant
  title?: React.ReactNode
  /** 可选等宽脚注，用于附带调试详情 */
  debugDetails?: React.ReactNode
}

const Toast = React.forwardRef<React.ElementRef<typeof ToastPrimitive.Root>, ToastProps>(function Toast(
  { className, variant = 'info', title, debugDetails, children, duration = 6500, ...props },
  ref
) {
  const Icon = variantIcon[variant]
  return (
    <ToastPrimitive.Root
      ref={ref}
      duration={duration}
      type={variant === 'info' ? 'background' : 'foreground'}
      className={cn(
        'anim-toast pointer-events-none flex justify-end',
        'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none',
        // 回弹的过渡列表写 translate 而非 transform：translate-x-* 落的是 `translate` 属性。
        'data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-[translate]',
        className
      )}
      {...props}
    >
      <div
        className={cn(
          'pointer-events-auto max-w-lg overflow-hidden rounded-xl border-[0.5px] p-2 text-sm text-text-primary shadow-md',
          variantBubble[variant]
        )}
      >
        <div className={cn('ml-1 flex justify-between gap-2', variantRowText[variant])}>
          <div className="flex min-w-0 items-start gap-2">
            <span className="flex h-6 items-center">
              <Icon className="size-5" aria-hidden />
            </span>
            <div className="mt-0.5 min-w-0 break-words">
              {title && <ToastPrimitive.Title className="font-medium">{title}</ToastPrimitive.Title>}
              <ToastPrimitive.Description className="select-text">{children}</ToastPrimitive.Description>
            </div>
          </div>
          <ToastPrimitive.Close asChild>
            <Button variant="ghost" size="iconXs" aria-label="关闭" className={variantClose[variant]}>
              <X className="size-3" />
            </Button>
          </ToastPrimitive.Close>
        </div>
        {debugDetails && (
          <div className="-mx-2 -mb-2 mt-2 rounded-b-lg border-t-[0.5px] border-border-300 bg-bg-000 px-3 py-1.5 font-mono text-xs text-text-300">
            {debugDetails}
          </div>
        )}
      </div>
    </ToastPrimitive.Root>
  )
})

const ToastTitle = ToastPrimitive.Title
const ToastDescription = ToastPrimitive.Description
const ToastClose = ToastPrimitive.Close
const ToastAction = ToastPrimitive.Action

export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
  type ToastProps,
  type ToastVariant,
}
