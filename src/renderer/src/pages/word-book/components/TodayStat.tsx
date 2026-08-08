import { ChevronRight, type LucideIcon } from 'lucide-react'

/** 今日队列里的可点统计行(今日学习 / 等待复习)。整行作入口。 */
export function TodayStat({
  icon: Icon,
  value,
  label,
  onClick,
}: {
  icon: LucideIcon
  value: number
  label: string
  onClick?: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-squish group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bg-neutral"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-3 text-text-secondary shadow-card-ring">
        <Icon className="size-[18px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-xl font-medium leading-none text-text-primary">{value}</span>
        <span className="mt-1 text-xs text-text-secondary">{label}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}
