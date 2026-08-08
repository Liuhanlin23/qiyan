/** 阅读器面板共用的纯展示助手（文本截断、日期、页码标签、高亮着色类名）。 */
import { cn } from '@/lib/cn'
import { HIGHLIGHT_PALETTE } from './constants'
import { isCfiInSection, type CfiRange, type HighlightColor, type HighlightStyle } from '@/reading'

/** 把一段文字截成书签/标注列表用的短标题。 */
export function snippet(text: string, max = 48): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/** 把时刻归到当天本地 00:00 的 epoch ms。 */
function localMidnight(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** 创建日期（YYYY-MM-DD，本地时区）：标注/书签条目上那一行小字。 */
export function formatDay(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 相对日期（对齐 readest 的「N 天前」）：按**本地日历日差**判定，不是 24h 滚动窗口——
 * 否则昨晚 23:00 标的、今早 08:00 看会误显示「今天」。展示用途，读设备时钟即可，不接校准钟。
 */
export function relativeDay(ms: number): string {
  const days = Math.max(0, Math.round((localMidnight(Date.now()) - localMidnight(ms)) / 86400000))
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  return `${days} 天前`
}

/**
 * 页号 → 显示用的「p N」；null（分页表未就绪 / cfi 解析不到）时不显页码。
 * 不做钳制——页号是分页表现算出来的，天然落在 [1, 总页数] 内（见 reading/engine/paginationMap）。
 */
export function pageLabel(page: number | null): string | null {
  return page == null ? null : `p ${page}`
}

/**
 * 右下角页码那行字：格式恒为 `x / y`（斜杠两侧带空格，对齐 readest），不随底栏开合变形。
 * **当前页与总页数都在才给页码**，缺任一半（分页表未就绪 / PDF）都回落全书百分比——只看当前页
 * 的话，总页数还没回填的那一瞬间会显出 `12 / null` 这种字面量。
 */
export function pageIndicatorLabel(
  currentPage: number | null,
  totalPages: number | null,
  fraction: number,
): string {
  if (currentPage != null && totalPages != null) return `${currentPage} / ${totalPages}`
  return `${Math.round(fraction * 100)}%`
}

/**
 * 落在当前屏可见范围内的条目 —— 顶栏书签键的开关态、侧栏书签 / 标注「当前」高亮**共用的唯一判定**。
 * 同屏有几条就命中几条（侧栏据此把它们全部标「当前」），不挑「最近的一条」。
 *
 * `range` 是引擎 relocate 抛出的区间 CFI 端点（`engine.visibleCfiRange()`，start = 屏首字符），判定即
 * `cfi ∈ [start, end)`——与页码域彻底脱钩：重排后可见范围变了，判定跟着当前屏走，精确无投影误差。
 * 半开区间这条规则与「标注归章」是同一条（下一屏的首字符属于下一屏，同下一章的起始 CFI 属于下一章），
 * 故直接复用 `@/reading` 的 `isCfiInSection`，不另写一份比较——书签 cfi 是区间 CFI（起点 = 落签时屏首
 * 字符）、标注 cfi 是划选区间，其内部的 `compareCfi` 对区间 CFI 自动按起点比较（vendor epubcfi.js:166），
 * 语义正确：一律以**起点**归屏，故起点在上一屏、尾巴延进本屏的跨屏标注算上一屏的，本屏不亮。
 *
 * `range` 为 null（引擎还没抛过位置）时不判定，一律视作「本屏无条目」。
 */
export function itemsInRange<T extends { cfi: string }>(items: T[], range: CfiRange | null): T[] {
  if (!range) return []
  return items.filter((i) => isCfiInSection(i.cfi, range.start, range.end))
}

/** 高亮原文按色 + 线型（填充/下划线/波浪）的样式类。 */
export function highlightTextClass(color: HighlightColor, style: HighlightStyle): string {
  const pal = HIGHLIGHT_PALETTE[color]
  return cn(
    'text-text-secondary',
    style === 'fill' && cn('rounded-[3px] px-0.5', pal.fill),
    style === 'underline' && cn('underline decoration-2 underline-offset-4', pal.line),
    style === 'wavy' && cn('underline decoration-wavy underline-offset-4', pal.line),
  )
}
