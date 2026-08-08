import { ArrowLeft, Bookmark, Languages, PanelLeft, Settings2 } from 'lucide-react'
import { TooltipProvider } from '@/components/ui'
import { cn } from '@/lib/cn'
import { ToolButton } from './ToolButton'

/**
 * 阅读器顶栏 —— 默认隐藏，鼠标移动时由父层淡入。分左/中/右三段：
 * 左：侧栏开关 · 返回书架 · 书签 · 翻译；中：书名；右：设置。
 * 「设置」直接开全局设置弹窗的「阅读」分区（阅读设置的唯一入口，阅读器内不再有就地外观浮层）；
 * 全屏不设专门入口，走系统能力（macOS 绿灯 / Windows 最大化）。
 * 窗口按钮交给系统原生标题栏（主进程默认 frame）：macOS 是左上角交通灯，Windows 是右上角三键，
 * 都不由本组件自绘，避免与系统栏重复。
 */

export interface ReaderHeaderBarProps {
  /** 书名（中段展示）。 */
  title: string
  /** 作者（中段展示）。 */
  author: string
  bookmarked: boolean
  translationOn: boolean
  translatable: boolean
  onToggleSidebar: () => void
  onToggleBookmark: () => void
  onToggleTranslation: () => void
  onOpenSettings: () => void
  onBackToShelf: () => void
}

export function ReaderHeaderBar(props: ReaderHeaderBarProps): React.JSX.Element {
  const {
    title,
    author,
    bookmarked,
    translationOn,
    translatable,
    onToggleSidebar,
    onToggleBookmark,
    onToggleTranslation,
    onOpenSettings,
    onBackToShelf,
  } = props

  return (
    <TooltipProvider delayDuration={400}>
      <header className="flex h-12 items-center gap-2 bg-page-bg/85 px-2 backdrop-blur">
        {/* 左段 */}
        <div className="flex items-center gap-0.5">
          <ToolButton label="侧栏（目录 / 标注 / 书签）" onClick={onToggleSidebar}>
            <PanelLeft className="size-[18px]" />
          </ToolButton>
          <ToolButton label="返回书架" onClick={onBackToShelf}>
            <ArrowLeft className="size-[18px]" />
          </ToolButton>
          <ToolButton
            label={bookmarked ? '移除书签' : '加书签'}
            active={bookmarked}
            activeSurface={false}
            onClick={onToggleBookmark}
          >
            {/* 加了书签 = 同一枚图标由空心转品牌橙实心，不换图标形状 */}
            <Bookmark className={cn('size-[18px]', bookmarked && 'fill-current text-brand-100')} />
          </ToolButton>
          <ToolButton
            label={translatable ? (translationOn ? '关闭对照翻译' : '开启对照翻译') : '当前语言不支持翻译'}
            active={translationOn}
            disabled={!translatable}
            onClick={onToggleTranslation}
          >
            <Languages className="size-[18px]" />
          </ToolButton>
        </div>

        {/* 中段：书名（仅展示） */}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-2 text-center">
          <span className="max-w-full truncate text-sm font-medium text-text-primary">{title}</span>
          <span className="max-w-full truncate text-[11px] text-text-muted">{author}</span>
        </div>

        {/* 右段：设置（唯一一枚，开弹窗定位「阅读」分区） */}
        <div className="flex items-center gap-0.5">
          <ToolButton label="阅读设置" onClick={onOpenSettings}>
            <Settings2 className="size-[18px]" />
          </ToolButton>
        </div>
      </header>
    </TooltipProvider>
  )
}
