import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Volume2 } from 'lucide-react'
import { TooltipProvider } from '@/components/ui'
import { cn } from '@/lib/cn'
import { ToolButton } from './ToolButton'

/**
 * 阅读器底栏（桌面单行工具条）—— 翻页/切章导航、进度滑块（可拖动跳转）、朗读入口。
 *
 * 滑块位置以引擎的**全书比例 fraction(0–1)** 为准。页码不在这里：它常驻正文下方
 * （见 [PageIndicator](./PageIndicator.tsx)），本栏浮出时那条淡出。历史前进/后退、朗读落地在后续模块。
 */

export interface ReaderFooterBarProps {
  /** 全书比例（0–1，滑块位置）。 */
  fraction: number
  canPrev: boolean
  canNext: boolean
  canPrevChapter: boolean
  canNextChapter: boolean
  ttsOpen: boolean
  onPrevPage: () => void
  onNextPage: () => void
  onPrevChapter: () => void
  onNextChapter: () => void
  /** 拖动/点击进度轨跳转到全书比例（0–1）。 */
  onSeekFraction: (fraction: number) => void
  onToggleTts: () => void
}

export function ReaderFooterBar(props: ReaderFooterBarProps): React.JSX.Element {
  const {
    fraction,
    canPrev,
    canNext,
    canPrevChapter,
    canNextChapter,
    ttsOpen,
    onPrevPage,
    onNextPage,
    onPrevChapter,
    onNextChapter,
    onSeekFraction,
    onToggleTts,
  } = props

  return (
    <TooltipProvider delayDuration={400}>
      <footer className="flex h-12 items-center gap-4 bg-page-bg/85 px-4 backdrop-blur">
        {/* 左：上一章 / 上一页 */}
        <ToolButton label="上一章" onClick={onPrevChapter} disabled={!canPrevChapter}>
          <ChevronsLeft className="size-[18px]" />
        </ToolButton>
        <ToolButton label="上一页" onClick={onPrevPage} disabled={!canPrev}>
          <ChevronLeft className="size-[18px]" />
        </ToolButton>

        {/* 进度滑块（占满剩余空间） */}
        <ProgressSlider fraction={fraction} onSeek={onSeekFraction} />

        {/* 右：朗读 / 下一页 / 下一章 */}
        <ToolButton label="朗读" onClick={onToggleTts} active={ttsOpen}>
          <Volume2 className="size-[18px]" />
        </ToolButton>
        <ToolButton label="下一页" onClick={onNextPage} disabled={!canNext}>
          <ChevronRight className="size-[18px]" />
        </ToolButton>
        <ToolButton label="下一章" onClick={onNextChapter} disabled={!canNextChapter}>
          <ChevronsRight className="size-[18px]" />
        </ToolButton>
      </footer>
    </TooltipProvider>
  )
}

/**
 * 可拖动进度滑块（CDS 暂无 Slider 组件，用 pointer 事件 + token 自建）。
 *
 * 拖动期间只动滑块自己（`dragFraction`），抬手才真跳一次：每个 pointermove 都 `goToFraction`
 * 就是每帧让引擎重新分页整本书，长书上拖起来是一卡一卡的。
 */
function ProgressSlider({
  fraction,
  onSeek,
}: {
  fraction: number
  onSeek: (fraction: number) => void
}): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  // null=没在拖：滑块跟着引擎给的 fraction 走。
  const [dragFraction, setDragFraction] = useState<number | null>(null)
  const dragging = dragFraction !== null
  const pct = Math.min(100, Math.max(0, (dragFraction ?? fraction) * 100))

  const fractionFromClientX = (clientX: number): number | null => {
    const el = trackRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="阅读进度"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragFraction(fractionFromClientX(e.clientX))
      }}
      onPointerMove={(e) => {
        if (dragging) setDragFraction(fractionFromClientX(e.clientX))
      }}
      // 抬手才真跳：点一下轨道也走这条（落点即按下时记的那个）。指针被系统取消视为放弃这次拖动，
      // 不跳转——与「抬手」不同，用户并没有确认落点。
      onPointerUp={(e) => {
        if (dragFraction !== null) onSeek(dragFraction)
        setDragFraction(null)
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => setDragFraction(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, fraction - 0.01))
        else if (e.key === 'ArrowRight') onSeek(Math.min(1, fraction + 0.01))
      }}
      className="group relative flex h-6 min-w-0 flex-1 cursor-pointer items-center outline-none"
    >
      <div className="h-1 w-full rounded-full bg-border-300">
        <div className="h-full rounded-full bg-fill-accent" style={{ width: `${pct}%` }} />
      </div>
      <div
        className={cn(
          'absolute size-3 -translate-x-1/2 rounded-full bg-fill-accent shadow-sm ring-2 ring-page-bg transition-transform',
          dragging ? 'scale-125' : 'group-hover:scale-110',
        )}
        style={{ left: `${pct}%` }}
      />
    </div>
  )
}
