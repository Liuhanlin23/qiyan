import { useLayoutEffect, useRef, useState } from 'react'

/**
 * 把「锚在选区上的 fixed 浮层」夹进视口 —— 划词浮层与笔记气泡都以 (x, y) 为锚（x 是水平中点、
 * y 是选区下沿）贴着选区下方浮出，在窗口边缘划词时原样定位会把它推出屏幕：书页在 iframe 里，
 * 宿主这层也没有滚动条能把它捞回来，等于该次划词的工具栏点不到。
 *
 * 锚点除下沿还要给**高度**（`anchorHeight`）：下方塞不下时浮层要翻到锚点上方，那时得从上沿
 * （`y - anchorHeight`）再往上让开自身高度，只按下沿算会把浮层压在选中的字上。
 *
 * 用法：ref 挂浮层根元素，left/top 覆盖它的定位（元素自身保留 `-translate-x-1/2` 的居中语义）。
 * 先按锚点渲染、再按实测尺寸夹取，故放在 layout effect 里（绘制前改完，不闪一帧）；浮层高度在
 * 生命周期内会变（落高亮后展开微调条、切到查词/翻译面板），故用 ResizeObserver 跟着重夹。
 */

/** 浮层与视口边缘的最小留白。 */
const MARGIN = 8
/** 浮层与选区之间的间隙。 */
const GAP = 8

export function useViewportAnchor<T extends HTMLElement>(
  x: number,
  y: number,
  /** 锚点矩形高度（选区 / 命中行的高度），翻到上方时用来让开锚点本身。 */
  anchorHeight: number,
): { ref: React.RefObject<T | null>; left: number; top: number } {
  const ref = useRef<T>(null)
  const [pos, setPos] = useState({ left: x, top: y + GAP })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const place = (): void => {
      const { width, height } = el.getBoundingClientRect()
      const half = width / 2
      // x 是中点，故左右各要留出半个浮层；窗口比浮层还窄时以左边界为准（Math.max 兜住空区间）。
      const left = Math.min(Math.max(x, MARGIN + half), Math.max(MARGIN + half, window.innerWidth - MARGIN - half))
      // 默认挂选区下方；下方塞不下就翻到选区**上沿之上**（y - anchorHeight 才是上沿，按下沿算会盖住
      // 选中的字）；上方也塞不下才贴顶边——那是空间真不够时的兜底，仍可能压住锚点。
      const below = y + GAP
      const above = y - anchorHeight - GAP - height
      const top = below + height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, above)
      setPos({ left, top })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [x, y, anchorHeight])

  return { ref, ...pos }
}
