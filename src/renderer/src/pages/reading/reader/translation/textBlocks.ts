// 对照翻译遍历书页 DOM 的两个原语：从章节文档收集「可翻译的正文块」、由可见块索引算出
// 「懒翻译窗口」。骨架对齐 readest `utils/walk.ts` 的 walkTextNodes 与 useTextTranslation 的窗口计算，
// 去掉 iframe / shadow 递归——桌面端经引擎 adapter 直接拿到章节 doc，不必从 <foliate-view> 深挖。

/** 遍历时跳过的标签：代码 / 公式不该翻译，STYLE / LINK / SCRIPT 更不能当正文碰。 */
const REJECT_TAGS = new Set(['PRE', 'CODE', 'MATH', 'STYLE', 'LINK', 'SCRIPT'])

/** 追加的译文节点类名：收集时要把它自己排除，免得把中文译文当成新一段源文再翻一遍。 */
export const TRANSLATION_CLASS = 'qy-translation'

/**
 * 收集一个章节文档里可翻译的正文块：叶子文本元素，或「直接挂着非空文本节点」的元素
 *（如 `<p>Hello <b>x</b></p>` 收 `<p>` 整块）。既非叶子又无直接文本的纯容器继续下钻。
 */
export function collectTextBlocks(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  const walk = (node: Element, depth: number): void => {
    if (depth > 15) return
    for (const child of Array.from(node.children) as HTMLElement[]) {
      if (REJECT_TAGS.has(child.tagName)) continue
      if (child.classList.contains(TRANSLATION_CLASS)) continue
      const hasDirectText = Array.from(child.childNodes).some(
        (n) => n.nodeType === 3 /* TEXT_NODE */ && !!n.textContent?.trim(),
      )
      if (child.children.length === 0 && child.textContent?.trim()) out.push(child)
      else if (hasDirectText) out.push(child)
      else if (child.children.length > 0) walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return out
}

/**
 * 由「当前可见块的最小 / 最大索引」算出要翻译的闭区间 `[start, end]`：向前多取 1 段、向后多取 2 段
 *（翻到下一页时译文已备好），并夹到 `[0, len-1]`。可见集为空（`firstVisible > lastVisible`）时返回 null。
 */
export function lookAheadRange(
  len: number,
  firstVisible: number,
  lastVisible: number,
): { start: number; end: number } | null {
  if (len <= 0 || lastVisible < 0 || firstVisible > lastVisible) return null
  return {
    start: Math.max(0, firstVisible - 1),
    end: Math.min(len - 1, lastVisible + 2),
  }
}
