import type {
  FoliateViewElement,
  FoliateLocation,
  FoliateLoadDetail,
  FoliateTocItem,
  FoliateOverlayer,
  FoliateCreateOverlayDetail,
  FoliateShowAnnotationDetail,
  FoliateDrawAnnotationDetail,
} from './foliate'
import { createPaginationMap, type PaginationMap } from './paginationMap'
import { cfiRangeEndpoints, type CfiRange } from './cfi'
import { cleanLookupTerm } from './lookupTerm'

export type { FoliateLocation, FoliateLoadDetail }
export type { PaginationMap } from './paginationMap'

/**
 * 目录树节点（阅读域对外形态）—— 由引擎 `book.toc` 收口而来。
 * `fractionStart` 是该章在全书中的起始比例 0–1（null=无 href 或解析不到章序号）；
 * 页面层用 `Math.floor(fractionStart × 全书总页数) + 1` 换算每章起始页号（对齐 readest 的 locations 页码）。
 */
export interface TocNode {
  label: string
  href?: string
  fractionStart: number | null
  /** 该章的起始 CFI（null=无 href 或解析不到章序号）：标注/书签按 cfi 归章时的分界依据。 */
  cfi: string | null
  subitems: TocNode[]
}

/**
 * 阅读外观参数（页面层排版 → 引擎的收口形态）—— 页面层的 `ReaderAppearance` 映射到此后交给 `applyAppearance`。
 * 主题色由页面层从 CDS token 解析成具体色值（`pageBg`/`pageFg`）再传入，adapter 不认识 CDS。
 */
export interface AppearanceParams {
  /** 正文字号 px。 */
  fontSize: number
  /** 字体族：衬线 / 无衬线。 */
  fontFamily: 'serif' | 'sans'
  /** 行高倍数。 */
  lineHeight: number
  /** 两端对齐。 */
  justify: boolean
  /** 英文行尾自动断词。 */
  hyphenate: boolean
  /** 段间距 px。 */
  paragraphSpacing: number
  /** 正文最大行宽 px（max-inline-size）。 */
  maxInlineSize: number
  /** 书页上/左/右页边距 px（margin-top/left/right）。 */
  marginPx: number
  /** 书页底边距 px（margin-bottom）：单独拆出，给常驻页码条浮层腾出底部留白（须 ≥ 页码条高度）。 */
  marginBottomPx: number
  /** 单栏(1) / 双栏(2 上限)（max-column-count）。 */
  columns: 'single' | 'double'
  /** 书页背景色（CDS token 解析后的具体色值）。 */
  pageBg: string
  /** 书页正文色。 */
  pageFg: string
  /** 是否深色主题（切 color-scheme / 链接色）。 */
  dark: boolean
}

/** 高亮线型（foliate 词汇）：整段底色 / 下划线 / 波浪线。业务侧线型（fill/wavy）在页面层映射到此。 */
export type OverlayStyle = 'highlight' | 'underline' | 'squiggly'

/** 一条要落到正文上的高亮：`value` 是它的 CFI（唯一 key，重绘同一条须同 value）；`color` 是 CSS 色值。 */
export interface EngineAnnotation {
  value: string
  style: OverlayStyle
  color: string
}

/** 一次划词选区：文字 + CFI 定位 + 章序号 + 浮层锚点（已换算成窗口坐标，选区下沿中点 + 选区高度）。 */
export interface EngineSelection {
  text: string
  /**
   * 供查词用的词（清洗后，见 `lookupTerm.ts`）：剥掉标点与边界空白，选中什么就是什么。
   * 与 `text` / `cfi` **相互独立**——标注一律按 `text`/`cfi` 落笔，取词的归一化绝不回写选区本身，
   * 否则用户拖到哪、高亮就不在哪（docs/feature/reading/lookup.md §核心口径）。
   * 选中的全是标点 / 符号时为空串，页面据此隐藏「查词」入口。
   */
  lookupTerm: string
  cfi: string
  index: number
  /** 浮层锚点 x（窗口坐标，选区水平中点）。 */
  x: number
  /** 浮层锚点 y（窗口坐标，选区下沿）。 */
  y: number
  /** 选区矩形高度：浮层翻到选区上方时据此让开选中的字（上沿 = y − height）。 */
  height: number
}

/**
 * 点中一条已有标注 overlay：它的 CFI（`value`，已剥掉笔记前缀）+ 命中处窗口坐标 +
 * 是否点在**笔记锚点**（bubble）而非高亮本体上。带笔记的高亮画两层 overlay：高亮本体 + 笔记锚点，
 * 页面层据 `isNote` 决定进高亮编辑态（点本体）还是弹笔记气泡（点锚点）。
 */
export interface EngineAnnotationHit {
  value: string
  x: number
  y: number
  /** 命中矩形高度：同 `EngineSelection.height`，浮层翻到上方时据此让开被点中的那行。 */
  height: number
  isNote: boolean
}

/** range editor 里一个可拖把手的位置（窗口坐标 + 该端所在行高，用于画竖线光标）。 */
export interface HandlePoint {
  x: number
  y: number
  height: number
}

/** 一次范围编辑的当前态：高亮当前 CFI + 文字 + 两端把手位置。 */
export interface RangeHandles {
  value: string
  text: string
  start: HandlePoint
  end: HandlePoint
}

/**
 * 朗读的一句枚举单元 —— 由 foliate `getSentences`（vendor tts.js，MIT）把当前主可见章切成句得来。
 * `range` 是**活 DOM Range**（在该章 iframe 文档里），换章即失效，故换章须重新 `ttsEnumerate`。
 * `sectionIndex` 供生成 CFI（续读锚点 `ttsLocation`）与跨章判定；`blockIndex/markName` 保留 foliate 语义。
 * `text` = `range.toString()`（送 Edge 合成的原文、也是逐词高亮按字符对齐的基准串）。
 */
export interface TtsSentence {
  sectionIndex: number
  blockIndex: number
  markName: string
  text: string
  range: Range
}

/**
 * 阅读引擎实例 —— 阅读域对 `vendor/foliate-js` 的唯一收口门面。
 *
 * 页面/组件只经此操作阅读引擎，不直接碰 vendor 内部模块（见 vendor/foliate-js/VENDOR.md）。
 * 暴露 EPUB 渲染 + 翻页 + 进度 + 划词标注所需的面；所有 iframe 坐标换算与 overlayer 画笔
 * 细节都封在 adapter 内，页面层只拿到「窗口坐标 + 业务语义」。
 */
export interface FoliateEngine {
  /** `<foliate-view>` 元素；宿主组件把它挂进（有尺寸的）容器后再调用 `open`。 */
  readonly element: HTMLElement
  /**
   * 打开一本书（EPUB / PDF 等的 Blob/File，按魔数自辨格式），完成后渲染首屏。**须先把 `element` 挂进 DOM**。
   * 开完看 `isFixedLayout` 判定拿到的是哪种版式——两种版式可用的能力不同（见该字段）。
   */
  open(book: Blob | File): Promise<void>
  /**
   * 这本书是否**固定版式**（PDF 恒为真；EPUB 除非声明 pre-paginated 否则为假）。开书后才准。
   *
   * 固定版式的正文是整页位图，没有可重排的文字流，故这些能力**不适用**：`applyAppearance`（字号/行宽/
   * 主题，调用即空转）、`goToFraction`（页内无比例可言）。翻页改为整页滚动，缩放走 `setZoom`，
   * 页码走 `pageState`。划词与标注一族沿用同一套（fxl 也建 overlay 层），本轮真题展示未用。
   */
  readonly isFixedLayout: boolean
  /**
   * 固定版式的页码：当前页序号（0 基）与总页数；非固定版式或尚未开书返回 null。
   * 连续滚动下「当前页」= 视口中线所在页，随滚动在 `onRelocate` 里重取即可。
   */
  pageState(): { index: number; total: number } | null
  /**
   * 页码分页表 —— 可重排书（EPUB）**页码的唯一来源**：foliate location 字符刻度（1500 字节一格），
   * 开书即全书精确、排版无关（改字号 / 窗口页码不变）；翻一屏页码可能 +0/+1/+2，设计内行为。
   * 固定版式（PDF）不经它，此时恒 `ready === false`，页码条回落百分比显示。
   */
  readonly pagination: PaginationMap
  /**
   * 固定版式的缩放倍率：**基准 1 = 适宽**（页宽铺满窗口，连续滚动下的固有版面），1.6 即适宽的 1.6 倍。
   * 非固定版式空转。注意不是「相对 PDF 原始尺寸」的倍率——滚动模式的页宽恒随窗口走。
   */
  setZoom(scale: number): void
  prevPage(): void
  nextPage(): void
  /** 跳到全书比例 0–1（进度条拖动）。 */
  goToFraction(fraction: number): Promise<void>
  /** 跳到 CFI 或章节 href（目录跳转 / 书签）。 */
  goTo(target: string): Promise<void>
  /** 各章在全书中的起始比例（进度条章节刻度）。 */
  sectionFractions(): number[]
  /** 目录树（`book.toc` → 阅读域 `TocNode`，每项带起始全书比例供页码换算）。开书后可用，无目录时为空数组。 */
  getTOC(): TocNode[]
  /**
   * 当前已渲染的章节文档（当前章 + 相邻预渲染章，随翻页滚动增删）。对照翻译等需遍历书页 DOM 的
   * 上层能力经此一次取齐已在册的 `Document`，不深入 vendor（与 `onLoad` 逐章给出的是同一批 doc）。
   */
  contentDocuments(): Document[]
  /** 应用阅读外观：注入书页排版 CSS + 设 renderer 的行宽/页边距/列数属性，即时重排。 */
  applyAppearance(p: AppearanceParams): void
  /** 落一条高亮 / 就地重绘同一条（同 `value` 会先移除旧 overlay 再画）。 */
  drawAnnotation(a: EngineAnnotation): Promise<void>
  /** 移除一条高亮（按 CFI `value`）。 */
  eraseAnnotation(value: string): Promise<void>
  /** 在某条高亮（CFI）末端画一枚同色**笔记锚点**（bubble）——点它弹笔记气泡；同 CFI 会先移除旧的再画。 */
  drawNote(cfi: string, color: string): Promise<void>
  /** 移除某条高亮的笔记锚点（按 CFI）。 */
  eraseNote(cfi: string): Promise<void>
  /**
   * 当前屏可见范围 `[start, end)`（relocate 区间 CFI 的端点；start = 屏首字符）。
   * 顶栏书签键与侧栏书签 / 标注「当前」按「cfi ∈ 此范围」判定（`util.itemsInRange`）——与页码域脱钩，
   * 重排后判定天然跟当前屏走。引擎还没抛过位置时 null。
   */
  visibleCfiRange(): CfiRange | null
  /** 位置变化（翻页/跳转）回调；返回取消订阅。 */
  onRelocate(cb: (loc: FoliateLocation) => void): () => void
  /** 章节文档加载回调（其他子模块可能用）；返回取消订阅。 */
  onLoad(cb: (detail: FoliateLoadDetail) => void): () => void
  /**
   * 书页 iframe 内的按键：各章是独立 iframe，其 keydown **不冒泡到宿主 window**，
   * 点一次正文后宿主挂的键盘翻页就全灭了，故在此逐章转发给上层统一处理。返回取消订阅。
   */
  onKeydown(cb: (e: KeyboardEvent) => void): () => void
  /** 划词选区变化：产生新选区时给 `EngineSelection`，选区清空时给 `null`；返回取消订阅。 */
  onSelect(cb: (sel: EngineSelection | null) => void): () => void
  /** 点中已有高亮：返回该高亮 CFI + 命中窗口坐标；返回取消订阅。 */
  onAnnotationClick(cb: (hit: EngineAnnotationHit) => void): () => void
  /**
   * 某一章的 overlay 层刚建好（该章首次渲染），回调带该章章序号：**已存标注要在此刻补画**。
   * foliate 只在内存里保留搜索高亮，普通标注不跨章持久（view.js `#createOverlayer` 只回填搜索结果），
   * 故翻到新章时须由上层重新 `drawAnnotation`。返回取消订阅。
   */
  onOverlayCreated(cb: (index: number) => void): () => void
  /**
   * 某章的 CFI 区间：`[start, end)`（`end` 为 null 表示末章，右边界开到书尾）。
   * 上层据此从全书标注里筛出本章的再补画（配 `onOverlayCreated` 的章序号用）。
   * null=取不到该章起始 CFI（书没解析出 sections），此时上层应回退整书补画。
   */
  sectionCfiRange(index: number): { start: string; end: string | null } | null
  /** 进入范围编辑：按 CFI 解析出高亮 range，返回两端把手位置（窗口坐标）。null=解析不到（该章未渲染）。 */
  beginRangeEdit(cfi: string): RangeHandles | null
  /**
   * 拖动某一端把手到窗口坐标 (clientX, clientY)：重算 range、若 CFI 变了就擦旧画新（同 style/color），
   * 返回新把手位置与新 CFI/文字。null=该点无有效落点或范围无效（收缩到空/越界），此时不改动。
   */
  dragRangeEdit(edge: 'start' | 'end', clientX: number, clientY: number, style: OverlayStyle, color: string): RangeHandles | null
  /** 结束范围编辑（清会话）。 */
  endRangeEdit(): void
  /** 清空当前文本选区（浮层动作执行后收尾用）。 */
  clearSelection(): void

  // ── 朗读（收口 vendor tts.js 的 getSentences + 主可见章 overlayer）──
  /**
   * 枚举**当前主可见章**的所有句子（含活 range + 文本 + 章序号）。朗读驱动与章内时间轴用它。
   * 固定版式（PDF）或该章未渲染时返回空数组。换章后须重新调用（旧 range 会失效）。
   */
  ttsEnumerate(): TtsSentence[]
  /** 在主可见章画/重画一条朗读句高亮到 `range`（同一条覆盖）；`color` 为 CSS 色值。 */
  ttsHighlight(range: Range, color: string): void
  /** 清除朗读高亮。 */
  ttsClearHighlight(): void
  /** 把 `range` 滚动进视口（朗读自动翻页跟随，不抢焦点）。 */
  ttsFollow(range: Range): void
  /** 当前文本选区（「从选中处往下读」定起点）：返回选区 range + 所在章序号；无有效选区返回 null。 */
  ttsSelectionRange(): { range: Range; sectionIndex: number } | null
  /** 把 CFI 解析为当前已渲染章里的 range（续读锚点 / 从页头起读用）：解析不到（该章未渲染）返回 null。 */
  ttsResolveCfiRange(cfi: string): { range: Range; sectionIndex: number } | null
  /** 由 (章序号, range) 生成 CFI（把当前朗读位置 `ttsLocation` 落成锚点）。 */
  ttsRangeCfi(sectionIndex: number, range: Range): string | null
  /** `range` 是否落在当前可见页内（续读判定「仍在可见页」/ 手动翻页脱离判定）。 */
  ttsRangeVisible(range: Range): boolean
  /** 当前主可见章序号（-1=未就绪）。 */
  ttsSectionIndex(): number
  /** 全书章数（spine 段数）。 */
  ttsSectionCount(): number
  /** 跳到某章并等其渲染就绪（章末自动续章 / 跨章导航）；越界或失败返回 false。 */
  ttsGoToSection(index: number): Promise<boolean>

  /** 销毁：清监听、移除元素。 */
  destroy(): void
}

// 注入每个章节 iframe 的基础排版 CSS，骨架对齐 foliate `reader.js` 的 getCSS。
// 具体字号/行距/行宽等阅读外观由 applyAppearance 参数化，这里只给能读的默认。
const BASE_READING_CSS = `
  html { color-scheme: light dark; }
  p, li, blockquote, dd {
    line-height: 1.6;
    text-align: justify;
    -webkit-hyphens: auto;
    hyphens: auto;
  }
  pre { white-space: pre-wrap !important; }
`

// 衬线 / 无衬线字体栈（低特异性挂 html，书自带字体可覆盖，对齐 readest overrideFont=off）。
const FONT_STACK = {
  serif: "Georgia, 'Times New Roman', 'Noto Serif', 'Songti SC', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, 'PingFang SC', sans-serif",
}

/**
 * 由阅读外观参数拼出注入书页 iframe 的排版 CSS。骨架对齐 readest `utils/style.ts` 的手法：
 * 字号 `!important` 强制、字体族低特异性可被书覆盖、保留书内 `[align]` 显式对齐、深色补链接色。
 * 行宽 / 页边距 / 列数不在这里 —— 走 renderer 属性（见 `applyAppearance`）。
 */
function buildAppearanceCSS(p: AppearanceParams): string {
  const family = p.fontFamily === 'serif' ? FONT_STACK.serif : FONT_STACK.sans
  const hyphens = p.hyphenate ? 'auto' : 'manual'
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html { color-scheme: ${p.dark ? 'dark' : 'light'}; }
    html, body { font-size: ${p.fontSize}px !important; color: ${p.pageFg}; }
    html { font-family: ${family}; background-color: ${p.pageBg}; }
    p, li, blockquote, dd {
      line-height: ${p.lineHeight};
      text-align: ${p.justify ? 'justify' : 'start'};
      -webkit-hyphens: ${hyphens};
      hyphens: ${hyphens};
      -webkit-hyphenate-limit-before: 3;
      -webkit-hyphenate-limit-after: 2;
      -webkit-hyphenate-limit-lines: 2;
    }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    [align="justify"] { text-align: justify; }
    :is(hgroup, header) p { text-align: unset; hyphens: unset; }
    p { margin-block: ${p.paragraphSpacing}px; }
    a:any-link { ${p.dark ? 'color: lightblue;' : ''} }
    pre { white-space: pre-wrap !important; }
  `
}

/**
 * 一个 iframe 内 range 的窗口坐标锚点（下沿中点 + 该矩形高度）：iframe 内 rect 叠上 frameElement 屏幕 rect。
 * 带上 `height` 是因为浮层在下方塞不下时要翻到锚点**上方**，那时得知道上沿在哪（`y - height`），
 * 只给下沿会让翻上去的浮层压住选中的字。
 */
function anchorInWindow(
  doc: Document,
  rect: { left: number; right: number; top: number; bottom: number },
): { x: number; y: number; height: number } {
  const feRect = doc.defaultView?.frameElement?.getBoundingClientRect()
  const offX = feRect?.left ?? 0
  const offY = feRect?.top ?? 0
  return { x: (rect.left + rect.right) / 2 + offX, y: rect.bottom + offY, height: rect.bottom - rect.top }
}

// 下划线/波浪线画笔要一个 padding 把线压到行框底部（对齐 readest：由行高与字号推算）。
// 桌面端简化版，不处理竖排/墨水屏。
function strokePadding(doc: Document, range: Range): number {
  const node = range.startContainer
  const el = (node.nodeType === 1 ? node : node.parentElement) as Element | null
  const cs = el ? doc.defaultView?.getComputedStyle(el) : null
  const fontSize = parseFloat(cs?.fontSize ?? '') || 16
  const lineHeight = parseFloat(cs?.lineHeight ?? '') || fontSize * 1.6
  const strokeWidth = 2
  return (lineHeight - fontSize) / 2 - strokeWidth - 1
}

// 笔记锚点 overlay 的 value 前缀（对齐 readest `foliate-note:`）：带笔记的高亮画两层 overlay——
// 高亮本体 value=cfi、笔记锚点 value=NOTE_PREFIX+cfi，靠前缀在「画」与「点」两处区分二者。adapter 内部细节。
const NOTE_PREFIX = 'foliate-note:'

// 朗读高亮的 overlay key：朗读句 / 词就地增删的唯一 key，与标注/搜索的 overlay 各自独立、互不覆盖。
const TTS_OVERLAY_KEY = 'foliate-tts'

/** 滚轮 / 触控板翻页：一次手势累计位移达到此像素数才翻页（挡掉手掌轻擦触控板那种零星 delta）。 */
const WHEEL_FLIP_THRESHOLD_PX = 40
/** 滚轮静止这么久即判定一次手势结束（须盖过 macOS 触控板抬手后的惯性尾巴间隔）。 */
const WHEEL_IDLE_MS = 200
/** deltaMode 行 / 页 → 像素的换算。Chromium 桌面端基本只发 0（像素），这两条是兜底。 */
const WHEEL_LINE_PX = 40
const WHEEL_PAGE_PX = 800

/**
 * 一次重排的「静默期」：这么久没有新的重排信号即认为版面已稳定，可以回位。
 * 重排信号是连着来的（侧栏宽度有过渡动画，每帧一次 resize；拖窗口缩放同理），故取尾部防抖，
 * 中途不折腾——每帧都回位既看得见抖动，也白算一堆 CFI。
 */
const REFLOW_SETTLE_MS = 120

/**
 * slide 整屏翻页（View Transitions 分层翻页）能力检测（仿 readest `utils/viewTransition`）：
 * 需要 `document.startViewTransition` 且 CSS 支持 `view-transition-group: nearest`（Chromium 140+）。
 * 桌面端 Electron 的 Chromium 远高于此、正常恒真；检测失败则不设 turn-style，引擎自动回退瞬跳/push。
 */
function supportsViewTransitionSlide(): boolean {
  return (
    typeof document !== 'undefined' &&
    'startViewTransition' in document &&
    typeof CSS !== 'undefined' &&
    CSS.supports('view-transition-group', 'nearest')
  )
}

/**
 * 创建一个 foliate 阅读引擎实例。动态 import 引擎（注册 `<foliate-view>` 自定义元素）后建元素。
 * 宿主组件负责把返回的 `element` 挂载到有尺寸的容器里，再调用 `open`。
 */
export async function createFoliateEngine(): Promise<FoliateEngine> {
  // 副作用：注册 <foliate-view> 自定义元素。引擎是无类型 ESM（vendor 只读、不放 .d.ts 进 vendor），
  // 这里不取任何具名导出，仅这一行动态 import 抑制隐式 any（TS7016）。
  // @ts-expect-error 无类型的 vendor ESM 模块
  await import('@/vendor/foliate-js/view.js')
  // 三种线型的 overlayer 画笔函数（画在书 iframe 内的 SVG 覆盖层上）。
  // @ts-expect-error 无类型的 vendor ESM 模块
  const { Overlayer } = await import('@/vendor/foliate-js/overlayer.js')
  // 朗读：按句枚举正文 + 遍历文本节点。均为 vendor（MIT）纯函数，收口在此、不外泄给页面。
  // @ts-expect-error 无类型的 vendor ESM 模块
  const { getSentences } = await import('@/vendor/foliate-js/tts.js')
  // @ts-expect-error 无类型的 vendor ESM 模块
  const { textWalker } = await import('@/vendor/foliate-js/text-walker.js')
  const view = document.createElement('foliate-view') as FoliateViewElement
  // 必须显式 block：自定义元素默认 display:inline，而 inline 盒子不产生 ResizeObserver 观测
  //（尺寸恒报 0×0），下面重排回位挂在本元素上的 ResizeObserver 会一次都不触发（实测踩过：
  // 书页尺寸实际由内部 paginator 的容器从外层 div 撑起，渲染一切正常，独独 resize 观测是死的）。
  view.style.display = 'block'
  view.style.width = '100%'
  view.style.height = '100%'

  const relocateListeners = new Set<(loc: FoliateLocation) => void>()
  const loadListeners = new Set<(d: FoliateLoadDetail) => void>()
  const selectListeners = new Set<(sel: EngineSelection | null) => void>()
  const annClickListeners = new Set<(hit: EngineAnnotationHit) => void>()
  const overlayListeners = new Set<(index: number) => void>()
  const keydownListeners = new Set<(e: KeyboardEvent) => void>()
  // 章序号 → 章节文档：show-annotation / range editor 换算窗口坐标时用它取 frameElement。
  const docsByIndex = new Map<number, Document>()

  // 上层浮层此刻是否开着（划词浮层 / 标注编辑态 / 笔记气泡）——它们全都由本 adapter 抛的事件驱动，
  // 故这里能自己记账：抛出选区或标注命中即开，抛出「选区清空」即关（上层主动收浮层也走 clearSelection）。
  // 轻点判定用它区分「这一下是去收浮层的」与「一次干净的轻点」，前者不该再触发翻页 / 切栏
  //（对齐 readest 的 iframe-single-click 消费链）。
  let popupOpen = false

  const emitSelection = (sel: EngineSelection | null): void => {
    popupOpen = sel !== null
    selectListeners.forEach((cb) => cb(sel))
  }

  // ── 页码分页表（location 字符刻度）──
  // cfi → 章序号是同步的纯解析；cfi → 页号要数该章文档的字符（冷章 100–300ms），故是异步的，
  // 由分页表自己排队按需调用。直接取 location 刻度、不经 fraction 中转，避免二次换算引入分叉。
  // 页码口径（谁是事实源、谁是占位）见 paginationMap.ts 文件头注 2。
  const pagination = createPaginationMap({
    sectionIndexOfCfi: (cfi) => {
      // 同步库里可能混进形状异常的 cfi（只过了长度守卫），解析抛异常不该把整个列表渲染炸掉。
      try {
        return view.resolveNavigation(cfi)?.index ?? null
      } catch {
        return null
      }
    },
    pageOfCfiAsync: async (cfi) => {
      try {
        const current = (await view.getCFIProgress(cfi))?.location?.current
        return current == null ? null : current + 1
      } catch {
        return null
      }
    },
  })

  // ── 重排回位（侧栏开合 / 窗口缩放 / 改排版）──
  //
  // 书页是按容器宽度铺成的一长条列，宽度一变整章重新分列，旧的页边界全部作废。paginator 重排后
  // 会把「当前屏可见范围」吸附到新的列边界上，而吸附**只向书首取整**（`Math.floor`，见 vendor
  // paginator.js 的 `#scrollToRect`）：正在读的那个字保住了，但页首会多带出一小段刚读过的内容。
  // 这一步是分页排版的物理极限——页边界只能落在列边界上，想让某一页从任意一个字开始，往回翻再翻
  // 回来内容就对不上、页码也算不出来了，所以不做。
  //
  // 真正的毛病在下一步：paginator 随后把**自己的锚点**覆盖成吸附后的位置，于是每重排一轮就往前
  // 挪一点，来回开关侧栏会持续倒退（用户可见症状：「打开侧栏竟然向前截断」）。
  // 故这里自己记一份**不被吸附污染**的用户位置 `userCfi`，重排静默后据它回位——无论开关多少次
  // 侧栏、拖多少回窗口，每次都从同一个原始位置吸附，误差不累积。
  //
  // 记账纪律（第一版的教训）：重排后的 relocate 会**无限期**迟到——相邻章预加载、图片/字体加载
  // 引发的版面微调、paginator 自己 250ms 防抖的滚动尾巴挂在这些后面，都会再抛位置，且报的都是
  // 吸附后（偏向书首）的页起点。「屏蔽一个时间窗口再放开」的定时器方案注定漏：实测被章节预加载
  // 越过窗口污染，每开关一轮侧栏仍退一页。故改闩锁：重排一来就**落闩**，此后一切被动 relocate
  // 不记账，直到用户下一次主动动作（翻页 / 跳转 / 滚轮 / 朗读跟随）抬闩——用户动作之后落定的
  // 位置汇报才是他本人的位置，被动汇报再晚也污染不了。
  /** 当前屏可见范围 [start, end)（relocate 的区间 CFI 端点）：顶栏书签键 / 侧栏「当前」判定用。 */
  let visibleRange: CfiRange | null = null
  /** 当前屏可见 DOM Range（relocate 原样带出，每次无条件覆盖——重排后旧 range 可能已属死文档）：
      ttsRangeVisible 与它比边界。 */
  let visibleDomRange: Range | null = null
  /**
   * 端点没变就复用旧对象——重排后的 relocate 会无限期迟到并反复报同一位置（见下方 userCfi 那段），
   * 每次都换新对象身份会让页面层的 `setVisibleRange` 无法 bail out，白白重渲整条书签列表。
   * 返回更新后的范围，供调用方直接取用（页码要它的 start，不必再回读这个可变量）。
   */
  const updateVisibleRange = (cfi: string | undefined): CfiRange | null => {
    const next = cfi ? cfiRangeEndpoints(cfi) : null
    if (next && visibleRange && next.start === visibleRange.start && next.end === visibleRange.end)
      return visibleRange
    visibleRange = next
    return visibleRange
  }
  /** 用户真正读到的位置（CFI）：重排闩落下期间冻结，只随用户自己的翻页 / 跳转更新。 */
  let userCfi: string | null = null
  /** 重排闩：落下后 relocate 一律不记账。scheduleReflowRestore 落下、cancelReflowRestore 抬起。 */
  let reflowLatched = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * 把书页滚回 `cfi` 处。走 `renderer.scrollToAnchor` 而不是 `view.goTo`：后者会往前进/后退
   * 历史里塞一条（view.js `goTo` 的 `history.pushState`），侧栏开一次就污染一条。
   */
  const scrollBackTo = (cfi: string): void => {
    try {
      const resolved = view.resolveCFI(cfi)
      const doc = docsByIndex.get(resolved.index)
      if (!doc) return
      // select=false → navigation 语义：只滚动、不动选区、不抢焦点。
      void view.renderer?.scrollToAnchor?.(resolved.anchor(doc), false)
    } catch {
      // 解析不到（脏 cfi / 该章已卸载）：放弃这次回位，退化成 paginator 自己的吸附结果——
      // 位置略偏但不会乱，比抛异常炸掉重排流程好。
    }
  }

  /**
   * 用户自己挑了位置（翻页 / 目录跳转 / 拖进度条 / 滚轮 / 朗读跟随）：撤掉在途回位、抬起重排闩。
   * 他的选择优先于回位，且随后落定的 relocate 恢复记账——那才是他本人的新位置。
   * 已知边界：翻页动画在途时恰好又触发重排（点完翻页立刻拖窗口/开侧栏），该次翻页的落点会被
   * 重新落下的闩挡住不记账，回位会退回翻页前的页。时序须精确重叠、代价一页且再翻一下即自愈，
   * 不为它加机制。
   */
  const cancelReflowRestore = (): void => {
    clearTimeout(settleTimer)
    reflowLatched = false
  }

  /** 登记一次「书页要重排了」：落闩停记账，静默 REFLOW_SETTLE_MS 后按 `userCfi` 回位。 */
  const scheduleReflowRestore = (): void => {
    // 固定版式（PDF）是整页位图 + 连续滚动，没有列可分、也就没有吸附问题，不参与。
    if (view.isFixedLayout) return
    // 还没有可信位置（刚开书、首屏尚未落定）：既无锚点可回，也**不能**落闩——否则首屏那次
    // relocate 记不下来，之后所有重排就都没有锚点了。
    if (!userCfi) return
    reflowLatched = true
    clearTimeout(settleTimer)
    // 闩落着时 userCfi 冻结，到点直接读它即可；若中途用户主动导航，settleTimer 已被
    // cancelReflowRestore 撤掉，不会跟他的跳转抢方向盘。
    settleTimer = setTimeout(() => {
      if (userCfi) scrollBackTo(userCfi)
    }, REFLOW_SETTLE_MS)
  }

  // 窗口缩放 / 侧栏开合（字号/行宽/分栏走 applyAppearance，那条路自己调 scheduleReflowRestore）：
  // 登记重排，稳定后回位。页码不受重排影响（location 刻度排版无关），故无需作废任何缓存。
  //
  // 顺序要紧：本 observer 必须比 paginator 自己那个（它观察 shadow DOM 里的 #container，重排 +
  // 同步抛 relocate）**先**收到回调，否则那一帧的吸附位置会在屏蔽生效前写进 userCfi。两点保证了这一点：
  // ResizeObserver 同一批按 observer 创建顺序回调，而本 observer 建于此刻（paginator 要等 open()
  // 才存在）；且 view 比 #container 浅，浅的先派发。
  const resizeObserver = new ResizeObserver(() => {
    scheduleReflowRestore()
  })
  resizeObserver.observe(view)

  view.addEventListener('relocate', (e) => {
    const loc = (e as CustomEvent<FoliateLocation>).detail
    // 记下用户位置——重排闩落着时不记（见 userCfi）：那些位置是吸附出来的，记进去就会越退越多。
    if (!reflowLatched && loc.cfi) userCfi = loc.cfi
    // 可见范围端点：loc.cfi 是「屏首→屏末」的区间 CFI，拆成 [start, end)（页面层经 visibleCfiRange 取）。
    // 须在抛位置之前更新：页面层是在 relocate 回调里 pull 它的。
    const range = updateVisibleRange(loc.cfi)
    visibleDomRange = loc.range ?? null
    // 翻页/滚动/跳转都算「离开选区上下文」，收掉浮层。
    emitSelection(null)
    // 先喂分页表再抛位置：上层在 relocate 回调里读 pagination.currentPage 就已是这一屏的值。
    // 只喂可重排书——固定版式（PDF）无 location 域，ready 恒 false，页码条回落百分比。
    const l = loc.location
    if (!view.isFixedLayout && l?.current != null) {
      pagination.observe({
        current: l.current,
        atEnd: view.renderer?.atEnd ?? false,
        startCfi: range?.start ?? null,
      })
    }
    relocateListeners.forEach((cb) => cb(loc))
  })

  // ── 滚轮 / 触控板翻页 ──
  // 一次连续手势只翻一页：累计位移越过阈值即翻，随后把这一手势剩下的事件全部吞掉，直到滚轮静止。
  // 吞尾巴是必须的——macOS 触控板抬手后系统还会持续喷一两秒的惯性 wheel，不吞则一次轻扫连翻好几页。
  //
  // 刻意**不做**「跟手拖拽 + 松手回弹」（macOS 图书的手感）：Web 的 wheel 事件没有 NSEvent 的 phase，
  // 拿不到「手指离开触控板」那一刻，无从区分手动阶段与惯性阶段。真按跟手做，抬手后页面会被惯性推到
  // 相邻页边界僵住一两秒、等静止判定生效才吸附，比离散翻页更难受。paginator 的 scrollBy / snap 都是
  // public，将来若能拿到可靠的抬手信号，跟手是在这套接线上加，不用推倒重来。
  let wheelAccX = 0
  let wheelAccY = 0
  let wheelLastTs = -Infinity
  // 本次手势是否已经翻过页：翻过之后剩下的事件都是惯性尾巴，一律吞掉。
  let wheelFlipped = false

  const onWheel = (e: WheelEvent): void => {
    // 固定版式（PDF）走 fxl 的连续滚动，滚轮就是原生滚动本身——既不该拦、也不该换算成翻页，
    // 一律放行（拦了页面就彻底滚不动）。
    if (view.isFixedLayout) return
    // 分页模式下书页 iframe 是 overflow:hidden，横滑本不会有原生滚动，但会触发 Electron 的双指
    // 「返回上一页」历史手势——必须拦掉。注意 wheel 在 document 上默认是 passive 的，所有绑定处
    // 都得显式 { passive: false }，否则这行 preventDefault 只是空转（还会报警告）。
    e.preventDefault()

    // 静止超过 idle 窗口 = 上一次手势（连同它的惯性尾巴）已经结束，开一次新手势。
    if (e.timeStamp - wheelLastTs > WHEEL_IDLE_MS) {
      wheelAccX = 0
      wheelAccY = 0
      wheelFlipped = false
    }
    wheelLastTs = e.timeStamp
    if (wheelFlipped) return

    const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? WHEEL_PAGE_PX : 1
    wheelAccX += e.deltaX * unit
    wheelAccY += e.deltaY * unit
    // 只认主轴：横扫时那点纵向抖动（和普通滚轮的纯纵向）都不该把方向带偏。
    const delta = Math.abs(wheelAccX) > Math.abs(wheelAccY) ? wheelAccX : wheelAccY
    if (Math.abs(delta) < WHEEL_FLIP_THRESHOLD_PX) return

    wheelFlipped = true
    cancelReflowRestore()
    // 向下 / 向右滚即「往后读」。RTL 由 goRight/goLeft 自己处理，这里不判书写方向。
    if (delta > 0) view.goRight()
    else view.goLeft()
  }

  // 绑在宿主元素上：盖住页边距、两侧留白等 iframe 之外的区域。
  view.addEventListener('wheel', onWheel, { passive: false })

  // 新章的 overlay 层建好：通知上层补画该章的已存标注（foliate 不替我们持久化）。
  view.addEventListener('create-overlay', (e) => {
    const { index } = (e as CustomEvent<FoliateCreateOverlayDetail>).detail
    overlayListeners.forEach((cb) => cb(index))
  })

  view.addEventListener('load', (e) => {
    const detail = (e as CustomEvent<FoliateLoadDetail>).detail
    docsByIndex.set(detail.index, detail.doc)
    // 只留当前章与其左右邻章的 doc：远章的 iframe 早被 paginator 卸掉，留着 Document 引用就是
    // 一场长书会话里只涨不跌的内存滞留。保留邻章是因为 paginator 会预渲染它们（同款邻近策略），
    // show-annotation / beginRangeEdit 也只在已渲染的章上才有意义。
    for (const i of docsByIndex.keys()) {
      if (Math.abs(i - detail.index) > 1) docsByIndex.delete(i)
    }
    attachSelectionListeners(detail.doc, detail.index)
    // 章节 iframe 内的按键转发给上层（键盘翻页；监听随该章 iframe 一同销毁，同 pointer 监听）。
    detail.doc.addEventListener('keydown', (e) => keydownListeners.forEach((cb) => cb(e)))
    // 正文区的滚轮翻页。wheel 不冒泡出 iframe，故每章各绑一份，但共用**同一个** onWheel 闭包——
    // 手势状态因此是全引擎唯一的，鼠标从正文滑到页边距（宿主元素）也不会把一次手势拆成两次。
    detail.doc.addEventListener('wheel', onWheel, { passive: false })
    loadListeners.forEach((cb) => cb(detail))
  })

  // foliate 自己不画高亮：解析完 CFI 回抛 draw-annotation，这里按 value 前缀/线型选 overlayer 画笔落笔。
  view.addEventListener('draw-annotation', (e) => {
    const { draw, annotation, doc, range } = (e as CustomEvent<FoliateDrawAnnotationDetail>).detail
    const { value, style, color } = annotation as unknown as EngineAnnotation
    // 笔记锚点（value 带前缀）：画同色 bubble 小气泡，不管线型。
    if (typeof value === 'string' && value.startsWith(NOTE_PREFIX)) {
      draw(Overlayer.bubble, { color })
    } else if (style === 'highlight') {
      draw(Overlayer.highlight, { color })
    } else {
      // underline / squiggly：线色 + padding 压到行底。
      draw(Overlayer[style], { color, padding: strokePadding(doc, range) })
    }
  })

  // 点中已有 overlay：换算窗口坐标 + 按前缀判定是否点在笔记锚点上，抛给页面层
  //（点高亮本体→进编辑态；点笔记锚点→弹笔记气泡）。value 剥掉前缀后即高亮 CFI。
  view.addEventListener('show-annotation', (e) => {
    const { value, index, rect } = (e as CustomEvent<FoliateShowAnnotationDetail>).detail
    const isNote = typeof value === 'string' && value.startsWith(NOTE_PREFIX)
    const cfi = isNote ? value.slice(NOTE_PREFIX.length) : value
    const doc = docsByIndex.get(index)
    const anchor = doc && rect ? anchorInWindow(doc, rect) : { x: 0, y: 0, height: 0 }
    popupOpen = true
    annClickListeners.forEach((cb) => cb({ value: cfi, x: anchor.x, y: anchor.y, height: anchor.height, isNote }))
  })

  // 在一个章节文档上挂划词监听。桌面鼠标端分工：
  //  - pointerdown：一次通用「收浮层」——点书里空白即收（连不依赖活选区的编辑态浮层/笔记气泡也一并关）。
  //  - pointerup：本手势结束，读定选区、产生新浮层（划词的唯一入口，避开拖动中刷屏）。
  //
  // 刻意**不监听 selectionchange 收浮层**：点浮层里的色板/线型会让书 iframe 失焦、抛出「选区清空」，
  // 那并非用户划走，收浮层会误关（对齐 readest「除非点空白处否则常开」）。收浮层只认 pointerdown / 翻页。
  //
  function attachSelectionListeners(doc: Document, index: number): void {
    const readSelection = (): void => {
      const sel = doc.getSelection()
      // 单击 / 误触 / 单字符：不弹浮层。pointerdown 已收掉旧浮层，这里不必再抛。
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || sel.toString().trim().length < 2) return
      const range = sel.getRangeAt(0)
      const anchor = anchorInWindow(doc, range.getBoundingClientRect())
      emitSelection({
        text: sel.toString().trim(),
        // 取词（查词专用）：只把选中的文字归一化，**不动 text/cfi**，也不去够选区外的字。
        lookupTerm: cleanLookupTerm(range.toString()),
        cfi: view.getCFI(index, range),
        index,
        x: anchor.x,
        y: anchor.y,
        height: anchor.height,
      })
    }

    doc.addEventListener('pointerdown', () => emitSelection(null))
    doc.addEventListener('pointerup', readSelection)
  }

  // ── 范围编辑（拖两端把手改高亮范围）──
  // 会话保存：所在章 doc、当前 CFI、两端边界（node/offset）。拖动时固定一端、把另一端移到光标落点。
  type Boundary = { node: Node; offset: number }
  let rangeSession: { index: number; doc: Document; value: string; start: Boundary; end: Boundary } | null = null

  // 朗读：主可见章的 { 章序号, overlayer, doc } —— 句枚举与朗读高亮都作用其上。
  // fxl（PDF）的 renderer 无 getContents，返回 undefined（朗读整体不适用固定版式）。
  function primaryContent(): { index: number; overlayer: FoliateOverlayer; doc: Document } | undefined {
    const r = view.renderer
    const contents = r?.getContents?.() ?? []
    const pIndex = r?.primaryIndex ?? -1
    return contents.find((c) => c.index === pIndex) ?? contents[0]
  }

  // 由一个 range 算出两端把手的窗口坐标（首行首端 = start，末行末端 = end）。
  function handlesFrom(doc: Document, value: string, range: Range): RangeHandles | null {
    const rects = range.getClientRects()
    if (!rects.length) return null
    const first = rects[0]
    const last = rects[rects.length - 1]
    const feRect = doc.defaultView?.frameElement?.getBoundingClientRect()
    const ox = feRect?.left ?? 0
    const oy = feRect?.top ?? 0
    return {
      value,
      text: range.toString(),
      start: { x: first.left + ox, y: first.top + oy, height: first.height },
      end: { x: last.right + ox, y: last.bottom + oy, height: last.height },
    }
  }

  return {
    element: view,
    pagination,
    async open(book) {
      await view.open(book)
      // location 刻度的分母（对齐 vendor SectionProgress 口径）：各 linear 章的解压字节数总和。
      // 固定版式（PDF）的 sections 无 size ⇒ sizeTotal 0 ⇒ 分页表恒不就绪，页码条回落百分比。
      const sizeTotal = (view.book?.sections ?? []).reduce(
        (a, s) => a + (s.linear !== 'no' && s.size != null && s.size > 0 ? s.size : 0),
        0,
      )
      pagination.reset(view.getSectionFractions(), sizeTotal)
      // 固定版式（PDF）：renderer 是 fxl 而非 Paginator，整页位图既无正文可注入 CSS、也无栏可分，
      // 下面那套 EPUB 接线一条都不适用（给 fxl 写 Paginator 的属性只会静默无效）。
      // 只设一件事：连续滚动（一份卷子上下滑最顺手，也免去翻页动画）。滚动模式的页宽固有地
      // 铺满窗口，不必也无法再设 `zoom`，缩放另走 `setZoom`（见其注释）。
      if (view.isFixedLayout) {
        view.renderer.setAttribute('flow', 'scrolled')
        // 必须显式落到首页：切进滚动模式时 fxl 是拿「当前页」当锚点的，而此刻还没渲染过任何一页
        // （分页模式的首屏要靠 `renderer.next()` 才建立），它取到的当前页是 -1，于是锚点分支整个跳过，
        // 初始滚动位置无人设定——实测会停在最后一页。这一跳同时替代了 `next()` 的「渲染首屏」职责。
        await view.goTo(0)
        return
      }
      view.renderer.setStyles?.(BASE_READING_CSS)
      // 翻页动画：Paginator 的滑动动画整条链路都 gate 在这个属性上（`hasAttribute('animated')`），
      // 不设就是 `containerPosition = offset` 瞬跳。它不在 observedAttributes 里——纯开关、不触发重排，
      // 故只需开书时设一次。刻意不做成设置项（对齐点击分区的取舍：先定死一套行为收反馈）。
      // 另一个属性 `gpu-composite` 是 Apple WebKit 专用的大章节优化开关，Chromium 下不设——按 vendor
      // 注释，不设才会在超大章节回退到 rAF 逐帧滚动，避免 Blink 合成超大图层时的主线程卡顿。
      view.renderer.setAttribute('animated', '')
      // slide 整屏翻页：能力具备就设 turn-style=slide。引擎翻页时会从 renderer 向上 closest 找
      // `[data-view-transition-root]`（Reader 的中列容器）打 `view-transition-name: foliate-turn`，
      // 让正文 + 页码条 + 上下留白作为「一张纸」整屏滑动（对齐 macOS 图书）。能力不足则不设，引擎
      // 自动回退瞬跳/push（老 WebView 兜底，不暴露给用户）。同 animated：turn-style 不在
      // observedAttributes 里、纯读取式开关，开书设一次即可。
      if (supportsViewTransitionSlide()) {
        view.renderer.setAttribute('turn-style', 'slide')
      }
      view.renderer.next() // 渲染首屏（对齐 reader.js）
    },
    get isFixedLayout() {
      return view.isFixedLayout ?? false
    },
    pageState() {
      if (!view.isFixedLayout) return null
      const total = view.book?.sections?.length ?? 0
      const index = view.renderer?.index ?? -1
      // PDF 每页即一个 section，故页序号直接就是 section 序号；渲染前 fxl 给 -1，按首页算。
      return total ? { index: index < 0 ? 0 : index, total } : null
    },
    setZoom(scale) {
      if (!view.isFixedLayout) return
      // 连续滚动下 fxl 的页宽恒等于窗口宽（`zoom` 属性只管分页模式，这里设了也会被无视），
      // 可调的只有叠在其上的 `scale-factor`（百分比）——它才是滚动模式的缩放旋钮。
      view.renderer.setAttribute('scale-factor', String(Math.round(scale * 100)))
    },
    // 四个用户导航入口都先撤掉在途的重排回位（见 cancelReflowRestore）：
    // 键盘 / 点击分区 / 底栏按钮走 prev/nextPage，目录 / 书签 / 标注走 goTo，进度条与切章走 goToFraction。
    prevPage: () => {
      cancelReflowRestore()
      view.goLeft()
    },
    nextPage: () => {
      cancelReflowRestore()
      view.goRight()
    },
    goToFraction: (fraction) => {
      cancelReflowRestore()
      return view.goToFraction(fraction)
    },
    goTo: async (target) => {
      cancelReflowRestore()
      await view.goTo(target)
    },
    sectionFractions: () => view.getSectionFractions(),
    getTOC() {
      const fractions = view.getSectionFractions()
      const sections = view.book?.sections ?? []
      // 每项 href → 章序号（resolveNavigation）→ 该章起始比例（sectionFractions[序号]）与起始 CFI
      //（sections[序号].cfi）；解析不到则 null。
      const toNode = (it: FoliateTocItem): TocNode => {
        let fractionStart: number | null = null
        let cfi: string | null = null
        if (it.href) {
          const idx = view.resolveNavigation(it.href)?.index
          if (idx !== undefined && idx >= 0 && idx < fractions.length) fractionStart = fractions[idx]
          if (idx !== undefined && idx >= 0) cfi = sections[idx]?.cfi ?? null
        }
        return {
          label: it.label?.trim() ?? '',
          href: it.href,
          fractionStart,
          cfi,
          subitems: (it.subitems ?? []).map(toNode),
        }
      }
      return (view.book?.toc ?? []).map(toNode)
    },
    contentDocuments: () => [...docsByIndex.values()],
    sectionCfiRange(index) {
      const sections = view.book?.sections ?? []
      const start = sections[index]?.cfi
      if (!start) return null
      return { start, end: sections[index + 1]?.cfi ?? null }
    },
    applyAppearance(p) {
      const r = view.renderer
      if (!r) return
      // 固定版式（PDF）没有可重排的正文：字号 / 行宽 / 栏数无从施加，下面全是 Paginator 的属性，
      // 写给 fxl 只会静默无效。直接空转，让「PDF 上排版设置不起作用」是显式约定而非偶然。
      if (view.isFixedLayout) return
      // 同样要回位：改排版和侧栏开合是同一个吸附问题（见 userCfi）。**必须在设属性之前**登记——
      // 下面的 setAttribute / setStyles 会同步触发 paginator 重排并当场抛出 relocate，
      // 屏蔽晚一步，那次吸附位置就已经写进 userCfi 了。
      scheduleReflowRestore()
      // 行宽 / 页边距 / 列数 → renderer 属性（尺寸带 px，列数无单位）；Paginator 观察这些属性并重排。
      r.setAttribute('max-inline-size', `${p.maxInlineSize}px`)
      r.setAttribute('margin-top', `${p.marginPx}px`)
      // 底边距单独走 marginBottomPx：常驻页码条（PageIndicator）浮在这条底部留白带里，
      // 留白须 ≥ 页码条高度，否则页码会压到正文最后一行（页面层据此传值，见 constants）。
      r.setAttribute('margin-bottom', `${p.marginBottomPx}px`)
      r.setAttribute('margin-left', `${p.marginPx}px`)
      r.setAttribute('margin-right', `${p.marginPx}px`)
      r.setAttribute('max-column-count', p.columns === 'single' ? '1' : '2')
      // 字体 / 排版 / 主题色 → 注入书页 CSS（替换 BASE_READING_CSS）。
      r.setStyles?.(buildAppearanceCSS(p))
    },
    async drawAnnotation(a) {
      // 自定义字段（style/color）foliate 原样透传到 draw-annotation；同 value 会先移除旧 overlay。
      // EngineAnnotation 无索引签名，转成引擎期望的宽松形。
      await view.addAnnotation(a as unknown as { value: string; [k: string]: unknown })
    },
    async eraseAnnotation(value) {
      await view.deleteAnnotation({ value })
    },
    async drawNote(cfi, color) {
      // 笔记锚点作为独立 overlay（value 带前缀，与高亮本体不同 key，不会互相覆盖）；style 仅占位，
      // draw-annotation 里靠前缀选 bubble 画笔。
      await view.addAnnotation({ value: `${NOTE_PREFIX}${cfi}`, style: 'highlight', color } as unknown as {
        value: string
        [k: string]: unknown
      })
    },
    async eraseNote(cfi) {
      await view.deleteAnnotation({ value: `${NOTE_PREFIX}${cfi}` })
    },
    beginRangeEdit(cfi) {
      // 坏 CFI 会让 resolveCFI / anchor 抛（同步拉来的行只过了长度守卫、没有形状守卫）——一条脏记录
      // 不该把「点高亮」整个炸掉，返回 null 不进编辑态，向用户报错交调用方（SelectionAnnotator）。
      try {
        const resolved = view.resolveCFI(cfi)
        const doc = docsByIndex.get(resolved.index)
        if (!doc) return null
        const range = resolved.anchor(doc)
        rangeSession = {
          index: resolved.index,
          doc,
          value: cfi,
          start: { node: range.startContainer, offset: range.startOffset },
          end: { node: range.endContainer, offset: range.endOffset },
        }
        return handlesFrom(doc, cfi, range)
      } catch (e) {
        console.warn('[reading] 标注 CFI 解析失败，不进入范围编辑：', e)
        return null
      }
    },
    dragRangeEdit(edge, clientX, clientY, style, color) {
      const s = rangeSession
      if (!s) return null
      const feRect = s.doc.defaultView?.frameElement?.getBoundingClientRect()
      const ix = clientX - (feRect?.left ?? 0)
      const iy = clientY - (feRect?.top ?? 0)
      // 光标落点 → (node, offset)。原生鼠标划词也走同一套 hit-test，故分栏/变换下坐标一致。
      const caret = s.doc.caretRangeFromPoint?.(ix, iy)
      if (!caret) return null
      const moved: Boundary = { node: caret.startContainer, offset: caret.startOffset }
      const start = edge === 'start' ? moved : s.start
      const end = edge === 'end' ? moved : s.end
      const next = s.doc.createRange()
      try {
        next.setStart(start.node, start.offset)
        next.setEnd(end.node, end.offset)
      } catch {
        return null // 越过对端导致 start>end：本次不改动
      }
      if (next.collapsed) return null // 收缩到空：保底至少 1 字符
      const newCfi = view.getCFI(s.index, next)
      if (newCfi !== s.value) {
        void view.deleteAnnotation({ value: s.value })
        void view.addAnnotation({ value: newCfi, style, color } as unknown as { value: string; [k: string]: unknown })
        s.value = newCfi
      }
      // range 已自动规整 start≤end：据此回填两端边界（对端可能因越界被夹住）。
      s.start = { node: next.startContainer, offset: next.startOffset }
      s.end = { node: next.endContainer, offset: next.endOffset }
      return handlesFrom(s.doc, s.value, next)
    },
    endRangeEdit() {
      rangeSession = null
    },
    visibleCfiRange: () => visibleRange,
    onRelocate(cb) {
      relocateListeners.add(cb)
      return () => relocateListeners.delete(cb)
    },
    onLoad(cb) {
      loadListeners.add(cb)
      return () => loadListeners.delete(cb)
    },
    onSelect(cb) {
      selectListeners.add(cb)
      return () => selectListeners.delete(cb)
    },
    onKeydown(cb) {
      keydownListeners.add(cb)
      return () => keydownListeners.delete(cb)
    },
    onOverlayCreated(cb) {
      overlayListeners.add(cb)
      return () => overlayListeners.delete(cb)
    },
    onAnnotationClick(cb) {
      annClickListeners.add(cb)
      return () => annClickListeners.delete(cb)
    },
    clearSelection() {
      view.deselect()
      emitSelection(null)
    },

    // ── 朗读（收口 vendor tts.js 的 getSentences + 主可见章 overlayer）──
    ttsEnumerate() {
      const primary = primaryContent()
      if (!primary?.doc) return []
      const out: TtsSentence[] = []
      // getSentences(doc, textWalker, nodeFilter, granularity)：nodeFilter=null（不排除脚注等，v1 从简）。
      for (const seg of getSentences(primary.doc, textWalker, null, 'sentence') as Iterable<{
        blockIndex: number
        markName: string
        range: Range
      }>) {
        const text = seg.range.toString()
        if (!text.trim()) continue
        out.push({
          sectionIndex: primary.index,
          blockIndex: seg.blockIndex,
          markName: seg.markName,
          text,
          range: seg.range,
        })
      }
      return out
    },
    ttsHighlight(range, color) {
      const primary = primaryContent()
      if (!primary?.overlayer) return
      primary.overlayer.remove(TTS_OVERLAY_KEY)
      primary.overlayer.add(TTS_OVERLAY_KEY, range, Overlayer.highlight, { color })
    },
    ttsClearHighlight() {
      // 遍历所有已渲染章擦除：跨章朗读时高亮可能落在非主可见章的 overlayer 上。
      for (const c of view.renderer?.getContents?.() ?? []) c.overlayer?.remove(TTS_OVERLAY_KEY)
    },
    ttsFollow(range) {
      // 朗读跟随也在推进阅读位置：撤掉在途回位，否则朗读中开合侧栏会把书页拽回朗读开始前那一页。
      cancelReflowRestore()
      // select=true → selection 语义滚动：不抢焦点、不写 tabIndex/outline（navigation 分支会）。
      // 代价：paginator 落定后把 range 设成真实 DOM 选区（上游 foliate 自带 TTS 拿原生选区当高亮，
      // 对它是功能；我们画自己的 overlay，这层选区是纯残留，渲染成非活动灰）。relocate 在 promise
      // resolve 前同步派发（paginator #afterScroll 末尾），落定后收掉即可，无竞态。
      void view.renderer?.scrollToAnchor?.(range, true)?.then(() => {
        const sel = range.startContainer.ownerDocument?.getSelection()
        if (!sel?.rangeCount) return
        const r = sel.getRangeAt(0)
        // 只收「确实是我们传入的 range」的选区，绝不误伤用户手上的划词。
        if (
          r.compareBoundaryPoints(Range.START_TO_START, range) === 0 &&
          r.compareBoundaryPoints(Range.END_TO_END, range) === 0
        )
          sel.removeAllRanges()
      })
    },
    ttsSelectionRange() {
      const primary = primaryContent()
      const sel = primary?.doc?.getSelection?.()
      if (!primary || !sel || sel.isCollapsed || sel.rangeCount === 0) return null
      return { range: sel.getRangeAt(0), sectionIndex: primary.index }
    },
    ttsResolveCfiRange(cfi) {
      try {
        const resolved = view.resolveCFI(cfi)
        const doc = docsByIndex.get(resolved.index)
        if (!doc) return null
        return { range: resolved.anchor(doc), sectionIndex: resolved.index }
      } catch {
        return null
      }
    },
    ttsRangeCfi(sectionIndex, range) {
      try {
        return view.getCFI(sectionIndex, range)
      } catch {
        return null
      }
    },
    ttsRangeVisible(range) {
      // 与 relocate 报出的可见 Range 比边界（对齐 readest），不做几何判定：分页下 iframe 被撑成
      // 整章总宽，iframe 内的 rect / innerWidth 判「在不在当前页」必错（恒真）；读 rect 还会
      // 逼 iframe 每词同步重排。相交语义：既不整体在可见区之后、也不整体在其之前。
      const vis = visibleDomRange
      if (!vis) return false
      try {
        const ahead = range.compareBoundaryPoints(Range.END_TO_START, vis) > 0
        const behind = range.compareBoundaryPoints(Range.START_TO_END, vis) < 0
        return !ahead && !behind
      } catch {
        return false // 跨文档比较会抛（预加载的相邻章 / 已卸载章的死 range）：按不可见
      }
    },
    ttsSectionIndex() {
      return view.renderer?.primaryIndex ?? -1
    },
    ttsSectionCount() {
      return view.book?.sections?.length ?? 0
    },
    async ttsGoToSection(index) {
      const total = view.book?.sections?.length ?? 0
      if (index < 0 || index >= total) return false
      cancelReflowRestore()
      try {
        await view.goTo(index)
        return true
      } catch {
        return false
      }
    },

    destroy() {
      resizeObserver.disconnect()
      // 未落地的重排回位：不清会在 view 已 remove 之后去解析 CFI / 滚动一个死元素。
      clearTimeout(settleTimer)
      relocateListeners.clear()
      loadListeners.clear()
      selectListeners.clear()
      annClickListeners.clear()
      overlayListeners.clear()
      keydownListeners.clear()
      docsByIndex.clear()
      visibleDomRange = null // 不清会经引擎对象钉住已卸载章的 iframe 文档
      view.remove()
    },
  }
}
