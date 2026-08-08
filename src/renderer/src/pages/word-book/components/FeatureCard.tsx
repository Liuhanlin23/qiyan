import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 常用功能卡:发丝描边卡片 + 单色图标盒 + 标题;hover 仅整卡克制加深(与「今日」队列一致,不换投影/不反白)。
 * disabled 为占位项(词汇测试/数据统计/导出 PDF v1 无功能——wordbook.md 范围外):置灰、不可点、右侧标「即将上线」。
 */
export function FeatureCard({
  icon: Icon,
  title,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon
  title: string
  onClick?: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cn(
        'btn-squish group flex items-center gap-3.5 rounded-card bg-surface-1 p-4 text-left shadow-card-ring transition-colors',
        disabled ? 'cursor-not-allowed opacity-55' : 'hover:bg-bg-200'
      )}
    >
      <span
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-lg bg-bg-neutral',
          disabled ? 'text-text-muted' : 'text-text-secondary'
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{title}</span>
      {disabled ? (
        <span className="shrink-0 text-xs text-text-muted">即将上线</span>
      ) : (
        <ChevronRight className="size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" />
      )}
    </button>
  )
}
