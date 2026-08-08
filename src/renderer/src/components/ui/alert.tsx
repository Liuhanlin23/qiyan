import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * 内联提示条，由 AlertIcon、AlertContent（含 AlertDescription）、AlertAction 三个槽组合使用。
 * 容器本身是静态 callout，不带 role=alert；需要朗读语义时由调用方自行添加。
 */

function Alert({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex w-full items-center gap-2 rounded-card bg-surface-1 px-4 py-3 text-sm text-text-primary shadow-card-ring',
        className
      )}
      {...props}
    />
  )
}

function AlertIcon({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('flex shrink-0 items-center text-text-secondary [&_svg]:size-4', className)} {...props} />
}

function AlertContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2', className)} {...props} />
  )
}

function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-[min(20ch,100%)] flex-1 text-text-primary', className)} {...props} />
}

function AlertAction({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('flex shrink-0 items-center', className)} {...props} />
}

export { Alert, AlertIcon, AlertContent, AlertDescription, AlertAction }
