/**
 * 阅读器侧栏页签（标注 / 书签）的空态：图标 + 标题，可选一枚动作按钮。
 *
 * 刻意不复用顶层 `components/common/EmptyState` —— 那是 tab/详情栏两种形态的通用件，
 * 视觉签名（图标底托、字号、间距）与侧栏这套不同，合并会改观感。
 */
export function SidebarEmptyState({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode
  title: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <span className="text-text-muted">{icon}</span>
      <p className="text-sm font-medium text-text-secondary">{title}</p>
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}
