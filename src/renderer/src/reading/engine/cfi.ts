// CFI 比较与「这条 cfi 属于哪一章」—— 阅读域对 vendor `epubcfi.js` 的第三处收口
//（另两处：foliateEngine 建视图、bookMeta 提元数据）。纯函数、不碰 DOM，故可静态 import（引擎本体要
// 动态 import 是因为它注册自定义元素）。标注/书签的章分组与组内排序全靠这两个函数。
//
// `findTocItemByCfi` 的二分逻辑拷自 readest `apps/readest-app/src/services/nav/lookup.ts::findTocItemBS`（AGPL-3.0）。
// @ts-expect-error 无类型的 vendor ESM 模块
import * as CFI from '@/vendor/foliate-js/epubcfi.js'
import type { TocNode } from './foliateEngine'

const compare = (CFI as { compare: (a: string, b: string) => number }).compare
const collapse = (CFI as { collapse: (x: string, toEnd?: boolean) => string }).collapse

/** 比较两个 CFI 的先后：<0 前、0 同、>0 后。解析不了（形状异常）视作相等，不让排序抛出来。 */
export function compareCfi(a: string, b: string): number {
  try {
    return compare(a, b)
  } catch {
    return 0
  }
}

/**
 * 这条 cfi 是否落在某一章的 CFI 区间 `[start, end)` 内（`end` 为 null = 末章，右边界开到书尾）。
 * 章边界取自 spine 各章的**起始** CFI，故右边界必须是开区间：下一章的起始 CFI 属于下一章，
 * 含进来就把邻章的标注也算成本章的了。翻入某章时用它筛出该章标注补画（见 Reader 的 overlay 补画）。
 */
export function isCfiInSection(cfi: string, start: string, end: string | null): boolean {
  return compareCfi(cfi, start) >= 0 && (end === null || compareCfi(cfi, end) < 0)
}

/**
 * 按 cfi 在目录里二分找它所属的目录项（目录项按 `cfi` 有序，即文档序）。
 * 命中的项若有子项则继续下钻，取最深的那一层；找不到（cfi 在首章之前 / 目录无 cfi）返回 null。
 */
export function findTocItemByCfi(toc: TocNode[], cfi: string): TocNode | null {
  if (!cfi) return null
  // 无 cfi 的目录项（href 缺失 / resolveNavigation 解析不到）必须先滤掉再二分：vendor 的 `compare('', x)`
  // 恒返回 -1（不抛），留着它们等于往有序数组里塞了「永远排在最前」的项——二分会把它当候选 result
  // 吃掉正确的归章。目录量级小，每次 filter 的代价可忽略。
  const items = toc.filter((t) => t.cfi)
  let left = 0
  let right = items.length - 1
  let result: TocNode | null = null

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const item = items[mid]
    const comparison = compareCfi(item.cfi ?? '', cfi)
    if (comparison === 0) {
      return findInSubitems(item, cfi) ?? item
    } else if (comparison < 0) {
      result = findInSubitems(item, cfi) ?? item
      left = mid + 1
    } else {
      right = mid - 1
    }
  }

  return result
}

function findInSubitems(item: TocNode, cfi: string): TocNode | null {
  if (!item.subitems.length) return null
  return findTocItemByCfi(item.subitems, cfi)
}

/** 一段 CFI 区间的两个端点，语义恒为半开区间 `[start, end)`（当前屏可见范围 / 章区间同款）。 */
export interface CfiRange {
  start: string
  end: string
}

/**
 * 把一条（可能是区间的）CFI 拆成 `[start, end]` 两个端点 CFI（vendor `collapse`；非区间 CFI 两端相同）。
 * relocate 的 `loc.cfi` 是「屏首→屏末」的区间 CFI，拆出的端点即当前屏可见范围——
 * 顶栏书签键 / 侧栏「当前」按「书签 cfi ∈ [start, end)」判定（`isCfiInSection` 同一条半开区间规则）。
 * 解析不了返回 null，不抛。
 */
export function cfiRangeEndpoints(cfi: string): CfiRange | null {
  try {
    return { start: collapse(cfi), end: collapse(cfi, true) }
  } catch {
    return null
  }
}
