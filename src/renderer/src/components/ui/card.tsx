import * as React from 'react'
import { cn } from '@/lib/cn'

/** 卡片容器，由 CardHeader / CardTitle / CardDescription / CardContent / CardFooter 子组件组合使用。 */

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn('rounded-card bg-surface-1 text-text-primary shadow-card-ring', className)}
      {...props}
    />
  )
})

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function CardHeader(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn('flex flex-col gap-1.5 px-4 pt-3', className)} {...props} />
})

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function CardTitle(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn('text-sm font-semibold text-text-primary', className)} {...props} />
})

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function CardDescription(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn('text-sm text-text-muted', className)} {...props} />
})

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function CardContent(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn('px-4 py-3', className)} {...props} />
})

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function CardFooter(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn('flex items-center px-4 pb-3', className)} {...props} />
})

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
