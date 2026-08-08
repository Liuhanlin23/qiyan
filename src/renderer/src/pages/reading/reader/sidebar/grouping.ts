/**
 * 侧栏「标注」「书签」列表的按章分组 —— 纯视图派生，不落库。
 * （「当前」高亮不在这里：两个列表都按 cfi ∈ 当前屏可见范围判定，见 `util.itemsInRange`。）
 *
 * 章节归属**现算**：记录只存 `cfi`，渲染时拿它到当前 TOC 里二分归章（`@/reading` 的 `findTocItemByCfi`），
 * 故换目录版本 / 重解析后分组自动跟着走，不会出现「存下来的旧章名和当前目录对不上」。
 * 组间按章在目录里的先序位置排，组内按 `CFI.compare` 的真实阅读位置排。
 */
import { compareCfi, findTocItemByCfi } from '@/reading'
import type { TocNode } from '@/reading'

/** 一个章分组：稳定标识 + 章标题 + 该章下的条目（已排序）。 */
export interface ChapterGroup<T> {
  /**
   * 分组的稳定身份（渲染用 React key）：取该章在目录先序里的序号，归不到章的为 `ungrouped`。
   * 不能拿 `label` 当 key —— 同名章（「第一节」重复出现）或多个空名章会撞 key，React 复用错节点。
   */
  key: string
  label: string
  items: T[]
}

type Positioned = { cfi: string }

// 归不到章的条目（目录为空、或 cfi 落在首章之前）统一排到最后。
const UNGROUPED = Number.MAX_SAFE_INTEGER

/** 目录先序遍历序：作章分组的组间排序键。 */
function chapterOrder(toc: TocNode[]): Map<TocNode, number> {
  const order = new Map<TocNode, number>()
  const walk = (nodes: TocNode[]): void => {
    for (const n of nodes) {
      order.set(n, order.size)
      walk(n.subitems)
    }
  }
  walk(toc)
  return order
}

export function groupByChapter<T extends Positioned>(items: T[], toc: TocNode[]): ChapterGroup<T>[] {
  const order = chapterOrder(toc)
  const groups = new Map<number, ChapterGroup<T>>()

  for (const item of items) {
    const node = findTocItemByCfi(toc, item.cfi)
    const key = node ? (order.get(node) ?? UNGROUPED) : UNGROUPED
    const bucket = groups.get(key)
    if (bucket) bucket.items.push(item)
    else
      groups.set(key, {
        key: key === UNGROUPED ? 'ungrouped' : String(key),
        label: node?.label || '未分组',
        items: [item],
      })
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, g]) => ({ ...g, items: [...g.items].sort((x, y) => compareCfi(x.cfi, y.cfi)) }))
}

