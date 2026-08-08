import { X } from 'lucide-react'
import { WordLookupPanel } from '@/components/word/WordLookupPanel'

/**
 * 完整词条浮窗 —— 精简卡里点「查看完整词条」后浮出（docs/feature/reading/lookup.md §浮层二）。
 * 内容就是**查词页那块结果面板的原件**（`WordLookupPanel`）：完整词卡 + 英美音标切换 + 释义来源
 * 切换 + 例句/派生/近义/词组 Tab + 笔记 + 加入·移除学习。两处同一份实现，不另写一套。
 *
 * 刻意**不做模态**：加遮罩就等于把人从书里赶出来，而这个浮窗存在的理由正是「不离开阅读页也能看
 * 完整词条」。因此不贴选区（贴着会盖住刚读到的那行），居中偏上浮出，正文照常可见。
 *
 * 收浮窗：自带关闭键（关掉退回精简卡），以及宿主 SelectionAnnotator 那套统一出口（点书页空白 /
 * 点浮层外 / Esc / 翻页）——故带 `data-annotation-layer` 豁免「点外面就收」。
 */

export interface WordDetailPopupProps {
  /** 查询词（与精简卡同一个词；本地 dict 表已被上一次查询填好，这里通常是本地命中，不再打网络）。 */
  term: string
  /** 关闭：退回精简卡。 */
  onClose: () => void
}

export function WordDetailPopup({ term, onClose }: WordDetailPopupProps): React.JSX.Element {
  return (
    <div
      // 宿主「点浮层外面就收」靠这个标记豁免浮层自身（见 SelectionAnnotator）。
      data-annotation-layer=""
      className="anim-pop fixed left-1/2 top-[10vh] z-50 flex max-h-[72vh] w-[560px] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col select-text rounded-card bg-surface-3 text-text-primary shadow-popover"
      onMouseDown={(e) => e.preventDefault()} // 别让点浮窗清掉选区
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3.5">
        <span className="text-[13px] font-semibold text-text-muted">完整词条</span>
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="btn-squish grid size-7 place-items-center rounded-md text-text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-text-100"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <WordLookupPanel term={term} />
      </div>
    </div>
  )
}
