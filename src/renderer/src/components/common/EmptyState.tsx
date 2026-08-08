// 统一空态占位组件：
// - variant='inline'：tab/section 级空态（原 Empty()：三页手写的「暂无内容」占位）。
// - variant='detail'：container/layout 级空态（原 EmptyDetail()：未选中单词时的右栏占位）。

import { BookText } from 'lucide-react'
import { cn } from '@/lib/cn'

interface EmptyStateProps {
  /** 空态图标（可选；仅 variant='detail' 生效；默认使用通用图标 BookText） */
  icon?: React.ReactNode
  /** 空态标题/描述 */
  title: string
  subtitle?: string
  /**
   * 空态形态：
   * - 'inline'：tab/section 级，仅一行文字（默认）
   * - 'detail'：container/layout 级，居中图标 + 文字
   */
  variant?: 'inline' | 'detail'
  /** 自定义内容 slot */
  children?: React.ReactNode
  /** 根节点额外类名 */
  className?: string
}

export function EmptyState({
  icon,
  title,
  subtitle,
  variant = 'inline',
  children,
  className,
}: EmptyStateProps): React.JSX.Element {
  if (variant === 'detail') {
    return (
      <div
        className={cn(
          'flex h-full flex-col items-center justify-center gap-3 text-center',
          className,
        )}
      >
        <div className="grid size-12 place-items-center rounded-full bg-bg-neutral-chip">
          {icon ?? <BookText className="size-6 text-text-muted" />}
        </div>
        <p className="text-sm text-text-muted">{title}</p>
        {subtitle ? <p className="text-sm text-text-muted">{subtitle}</p> : null}
        {children}
      </div>
    )
  }

  return <p className={cn('text-sm text-text-muted', className)}>{title}</p>
}
