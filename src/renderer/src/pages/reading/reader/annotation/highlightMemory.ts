/**
 * 划词弹窗的高亮习惯记忆：**默认线型** + **每种线型各自记住的上次用色**。
 *
 * 属**设备级工具记忆**（归属与读写防御见 [lib/deviceMemory.ts](../../../../lib/deviceMemory.ts)）：
 * 落 localStorage、不进 `user_setting` 也不进 sqlite、不同步——在台式机上惯用波浪线，
 * 不该把笔记本上的习惯也改掉。读不出来 / 存的值不认识都退回出厂默认（填充 + 黄）。
 */
import { defineDeviceMemory } from '@/lib/deviceMemory'
import type { HighlightColor, HighlightStyle } from '@/reading'

export interface HighlightMemory {
  style: HighlightStyle
  colors: Record<HighlightStyle, HighlightColor>
}

const STORAGE_KEY = 'qiyan.reading.highlight'

const STYLES: HighlightStyle[] = ['fill', 'underline', 'wavy']
const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'red']

const DEFAULT: HighlightMemory = {
  style: 'fill',
  colors: { fill: 'yellow', underline: 'yellow', wavy: 'yellow' },
}

const asStyle = (v: unknown): HighlightStyle | null =>
  STYLES.includes(v as HighlightStyle) ? (v as HighlightStyle) : null
const asColor = (v: unknown, fallback: HighlightColor): HighlightColor =>
  COLORS.includes(v as HighlightColor) ? (v as HighlightColor) : fallback

/** 逐字段收口：任一项认不得就单独退回默认，不因一条脏记录整体丢掉其余记忆。 */
const memory = defineDeviceMemory<HighlightMemory>(STORAGE_KEY, DEFAULT, (raw) => {
  const parsed = (raw ?? {}) as { style?: unknown; colors?: Partial<Record<HighlightStyle, unknown>> }
  const colors = parsed.colors ?? {}
  return {
    style: asStyle(parsed.style) ?? DEFAULT.style,
    colors: {
      fill: asColor(colors.fill, DEFAULT.colors.fill),
      underline: asColor(colors.underline, DEFAULT.colors.underline),
      wavy: asColor(colors.wavy, DEFAULT.colors.wavy),
    },
  }
})

export const readHighlightMemory = memory.read
export const storeHighlightMemory = memory.store
