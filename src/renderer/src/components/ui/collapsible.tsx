import { Collapsible as CollapsiblePrimitive } from 'radix-ui'

/**
 * 单项展开/收起容器，默认无高度动画（瞬时 mount/unmount）。
 * 需要展开动画时，在调用方用 --radix-collapsible-content-height 接 keyframes。
 */

const Collapsible = CollapsiblePrimitive.Root
const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger
const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
