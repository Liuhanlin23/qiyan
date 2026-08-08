import { cn } from '@/lib/cn'
import { pageIndicatorLabel } from '../util'

/**
 * 正文右下角的常驻页码（对齐 readest）：坐在底部留白带内、右对齐、带内垂直居中，格式恒为 `x / y`
 * （拿不到页码信息时回落显百分比）。本组件的 `h-12` 必须等于 `BOTTOM_BAND_PX`(48)——不等则页码
 * 不在带内垂直居中；右缘的 `pe` 取正文同一枚 `--reading-margin-x` token，页边距改值自动跟随。
 *
 * 底栏浮出时**整条淡出**：底栏与本带同高、会把它完全盖住，而我们的底栏是半透明毛玻璃（readest
 * 是不透明实底直接盖住），不淡出会透出一团糊字。
 *
 * 走**绝对定位浮层**浮在中列底部留白带里：paginator 的 margin-bottom 已按 `BOTTOM_BAND_PX` 腾位
 * （见 constants / foliateEngine），页码压不到正文最后一行。之所以要浮层而非占正常流：整屏 slide
 * 翻页时页码要作为「一张纸」的一部分随正文整体滑动——它须落在快照根（中列
 * `[data-view-transition-root]`）内、且不把 foliate-view 挤短。`pointer-events-none` 让底部
 * hover 感应带仍能接到鼠标。
 */
export function PageIndicator({
  currentPage,
  totalPages,
  fraction,
  chromeOpen,
}: {
  /** 当前全书页号；与总页数缺任一则回落显百分比。 */
  currentPage: number | null
  /** 全书总页数。 */
  totalPages: number | null
  /** 全书比例 0–1（缺页码时的百分比回落）。 */
  fraction: number
  /** 底栏是否浮出：浮出时整条淡出（底栏同高，会完全盖住本带）。 */
  chromeOpen: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-12 items-center justify-end pe-[var(--reading-margin-x)] transition-opacity duration-200 ease-out',
        chromeOpen ? 'opacity-0' : 'opacity-100',
      )}
    >
      <span className="text-xs tabular-nums text-text-muted">
        {pageIndicatorLabel(currentPage, totalPages, fraction)}
      </span>
    </div>
  )
}
