import { cn } from '@/lib/cn'

/**
 * 列表条目/卡片内的悬停动作小按钮（编辑 / 删除 / 改名…）—— 阻止冒泡，避免触发整行的跳转。
 * 标注列表、书签列表、笔记本三处共用。
 */
export function RowAction({
  label,
  danger,
  onClick,
  children,
}: {
  label: string
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'grid size-6 place-items-center rounded text-text-muted transition-colors hover:bg-fill-ghost-hover',
        danger ? 'hover:text-text-danger' : 'hover:text-text-primary',
      )}
    >
      {children}
    </button>
  )
}
