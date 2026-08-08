/**
 * 阅读器的长期展示常量 —— 荧光笔调色板与首版固定的排版参数，供各处共享。
 *
 * 正文内容、分页与目录由真 foliate 引擎负责（经 `@/reading` 门面）。
 */
import type { HighlightColor, HighlightStyle, OverlayStyle } from '@/reading'
import type { FixedTypography } from './types'

// ─────────────────────────── 荧光笔调色板（映射到 CDS chip 语义 token）───────────────────────────

/**
 * 荧光笔预设色 —— 用 CDS 现成的 chip 语义 token 表达，token 纯净、自动明暗。
 * fill：整段填充底色；line：下划线/波浪线的线色；swatch：取色器色点。
 */
export const HIGHLIGHT_PALETTE: Record<
  HighlightColor,
  { label: string; fill: string; line: string; swatch: string }
> = {
  yellow: { label: '黄', fill: 'bg-bg-warning-chip', line: 'decoration-warning-200', swatch: 'bg-bg-warning-chip ring-border-warning' },
  green: { label: '绿', fill: 'bg-bg-success-chip', line: 'decoration-success-200', swatch: 'bg-bg-success-chip ring-border-success' },
  blue: { label: '蓝', fill: 'bg-bg-accent-chip', line: 'decoration-accent-200', swatch: 'bg-bg-accent-chip ring-border-accent' },
  red: { label: '红', fill: 'bg-bg-danger-chip', line: 'decoration-danger-200', swatch: 'bg-bg-danger-chip ring-border-danger' },
}

export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'red']

/**
 * 荧光笔在**真引擎正文**上落笔的字面色值 —— foliate 把高亮画成书 iframe 内的 SVG 覆盖层
 * （opacity .3 + mix-blend），Tailwind token 工具类进不了那层 DOM，只能给具体 CSS 色值。
 * 取 Tailwind 400 阶（与 readest 一致、与上面 chip 语义色观感相近），是本项目里少数必须写字面色的位置。
 */
export const HIGHLIGHT_INK: Record<HighlightColor, string> = {
  yellow: '#facc15',
  green: '#4ade80',
  blue: '#60a5fa',
  red: '#f87171',
}

/**
 * 朗读当前句高亮在**真引擎正文**上落笔的字面色值 —— 同荧光笔，overlay 是书 iframe 内的
 * SVG 层，Tailwind 工具类进不去，只能给具体 CSS 色值。取 Tailwind sky-400（与荧光笔同一取色口径）：
 * 偏青，和荧光笔蓝（blue-400）拉开一点，同一句既被划蓝又被读到时还分得出两层；
 * opacity/mix-blend 由 overlayer 默认（.3 + normal）负责。
 * 单值、明暗通用，故与荧光笔一样留在这里，不进 system.css —— 那层留给需要亮暗两套值的 token。
 */
export const TTS_HIGHLIGHT_INK = '#38bdf8'

/** 业务线型 → foliate overlayer 线型词汇（划词落笔与开书重绘共用）。 */
export const OVERLAY_STYLE: Record<HighlightStyle, OverlayStyle> = {
  fill: 'highlight',
  underline: 'underline',
  wavy: 'squiggly',
}

// ─────────────────────────── 首版固定的排版参数 ───────────────────────────

/** 读取 CDS --reading-* token 的数值(样式未就绪时用回退值)。参见 styles/system.css。 */
function readingToken(name: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))
  return Number.isFinite(n) ? n : fallback
}

/**
 * 首版**写死**的排版项：行高 / 段间距 / 行宽 / 页边距 / 分栏 / 两端对齐 / 断字
 *（docs/feature/reading/settings.md 「首版固定值」表）。
 * 数值项实读 CDS `--reading-*` token（见 styles/system.css），参数入口留着、只是首版不给用户调。
 *
 * 用户可调的那两项（字号 / 字体族）不在这里：它们落 `user_setting`，走 `@/settings` 门面读。
 */
export function getFixedTypography(): FixedTypography {
  return {
    lineHeight: readingToken('--reading-line-height', 1.6),
    maxWidth: readingToken('--reading-measure', 720),
    justify: false,
    paragraphSpacing: readingToken('--reading-para-gap', 12),
    marginPx: readingToken('--reading-margin-x', 48),
    hyphenate: false,
    // 双栏 = max-column-count 上限 2：宽屏双栏、窄屏自动回落单栏（foliate 默认的自适应）。
    columns: 'double',
  }
}

/**
 * 底部留白带高度 px：必须等于底栏 `chrome/ReaderFooterBar.tsx` 根节点的 `h-12`（改那边记得改这里，
 * 反向没有编译期护栏），页码活在带内右侧（readest 的 `marginBottomPx` 条带模型，见 PageIndicator），
 * 底栏浮出时正好把整条带盖住。
 * paginator 的 margin-bottom 至少留这么多，页码才压不到正文最后一行（页码浮在这条留白带里）。
 * 底边距实取 `max(用户页边距, 本值)`——用户把页边距调得更大时底部随之变大、不会比其它边窄。
 */
const BOTTOM_BAND_PX = 48

/**
 * 朗读迷你条的行高 px —— 必须等于 `tts/TtsBarPlayer.tsx` 那一行的 `h-14`（两处互指）。取常量而非
 * 实测 DOM：正文让位要在起播的同一帧就算出来，那会儿条还没挂上去（readest 同样写死 56）。
 */
const TTS_BAR_HEIGHT_PX = 56

/**
 * 正文底边距 px —— paginator 的 `margin-bottom`（唯一入口是 `applyAppearance`）。
 *
 * 基础值取 `max(用户页边距, 底带高)`：底部留白带住着页码，至少得留出它，而用户把页边距调得更大时
 * 底部随之变大、不比其它边窄。朗读会话期间再叠一个迷你条高（48 + 56 = 104）——条静止时坐在留白带
 * 顶上，占的是额外一层，故加成在取大**之外**叠加，不参与取大。
 *
 * 让位按迷你条的**静止位**算：底栏悬停浮出时条会抬高 8px、顶缘短暂压进正文一线，但底栏是纯覆盖层，
 * 为它二次重排会让正文在鼠标扫过底缘时抖一下——正文重排只由朗读会话起止驱动（readest 同款取舍）。
 */
export function readerMarginBottomPx(marginPx: number, ttsActive: boolean): number {
  return Math.max(marginPx, BOTTOM_BAND_PX) + (ttsActive ? TTS_BAR_HEIGHT_PX : 0)
}
