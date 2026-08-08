import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { SETTINGS_SECTIONS } from './sections'

export interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * 每次打开时强制定位到的分区 id（见 SETTINGS_SECTIONS）。
   * 给「从某功能就地唤起设置」的入口用（如阅读器顶栏的设置键 → 'reading'）；
   * 不传则沿用上次停留的分区（侧栏账户区那条入口的既有行为）。
   */
  initialSection?: string
}

/**
 * 设置 —— 逐像素复刻 claude.ai 的设置 Modal（实测 :8788 真站 DOM）：
 * 960×720 双栏 —— 左轨道 w-48 / surface-1 / 发丝右边框；右内容 surface-2 / px-6。
 * 由侧栏底部账户区打开；覆盖在当前页之上，关掉即回到原处、不丢位置。
 *
 * 默认 DialogContent 是窄 modal（p-6 / max-w-lg），这里覆写成大尺寸双栏：
 * 去内边距、网格分两列、固定尺寸，圆角/阴影沿用 Dialog 默认（rounded-card + shadow-panel-sm）。
 */
export function SettingsDialog({
  open,
  onOpenChange,
  initialSection,
}: SettingsDialogProps): React.JSX.Element {
  const [activeId, setActiveId] = useState(initialSection ?? 'general')
  const [query, setQuery] = useState('')

  // 每次打开都回到指定分区：弹窗常驻挂载，上次停在哪就还在哪——从阅读器点「设置」却落在「单词本」上，
  // 会让人以为点错了键。不传 initialSection 的入口不受影响（保持上次分区）。
  useEffect(() => {
    if (open && initialSection) setActiveId(initialSection)
  }, [open, initialSection])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return SETTINGS_SECTIONS
    return SETTINGS_SECTIONS.filter((s) => s.label.toLowerCase().includes(q))
  }, [query])

  const active = SETTINGS_SECTIONS.find((s) => s.id === activeId) ?? SETTINGS_SECTIONS[0]
  const ActivePanel = active.Panel

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[720px] max-h-[85vh] w-[calc(100%-2rem)] grid-cols-[12rem_1fr] gap-0 overflow-hidden p-0 sm:max-w-[960px]">
        {/* a11y：大 modal 仍需可达标题/描述，视觉上隐藏。 */}
        <DialogTitle className="sr-only">设置</DialogTitle>
        <DialogDescription className="sr-only">账户与学习偏好设置</DialogDescription>

        {/* 左：分区轨道。surface-1 微暖白 + 发丝右边框，与右侧纯白内容分层（实测真站关系）。 */}
        <aside className="flex h-full flex-col gap-2 overflow-y-auto border-r border-border bg-surface-1 p-3 [scrollbar-width:thin]">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted"
              strokeWidth={2}
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索设置"
              className="pl-8"
            />
          </div>

          <div className="flex flex-col gap-px">
            <div className="select-none px-2 pb-1 pt-4 text-xs text-text-muted">设置</div>
            {filtered.map(({ id, label, icon: Icon }) => {
              const isActive = id === activeId
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveId(id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'can-focus flex h-8 w-full cursor-pointer select-none items-center gap-3 rounded-lg px-2 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-alpha-2 font-medium text-text-100'
                      : 'text-text-secondary hover:bg-fill-ghost-hover hover:text-text-100'
                  )}
                >
                  <Icon className="size-[18px] shrink-0" strokeWidth={2} />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <div className="px-2 py-2 text-sm text-text-muted">无匹配项</div>
            )}
          </div>
        </aside>

        {/* 右：当前分区内容。独立滚动；px-6 与真站一致，pt-16 让首个分区标题与左栏「设置」标签齐平、
            上方留出真站那块空白（也顺带避开右上角关闭钮）。 */}
        <div className="min-w-0 overflow-y-auto bg-surface-2 px-6 pb-8 pt-16 [scrollbar-width:thin]">
          <ActivePanel />
        </div>
      </DialogContent>
    </Dialog>
  )
}
