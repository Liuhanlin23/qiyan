// 手写薄类型：只覆盖 reading adapter 实际用到的 foliate `view.js`（vendor/foliate-js）API 面。
// 引擎是无类型 ESM，按 vendor/foliate-js/VENDOR.md 纪律「不改 vendor、不全量补类型」，仅在阅读域
// adapter 侧收口这一小片。字段按 adapter 需要裁剪，用到再补，避免与引擎实现漂移。

/** `relocate` 事件 detail（view.js `#onRelocate` 的 `lastLocation`）。 */
export interface FoliateLocation {
  /** 全书阅读进度，0–1。 */
  fraction?: number
  /** 当前位置 CFI（location 唯一事实源，Step B 标注/进度定位用）。 */
  cfi?: string
  /** 当前屏可见 DOM Range（`#onRelocate` 原样带出，`cfi` 即由它生成）：朗读可见性判定与它比边界。 */
  range?: Range
  /** 当前章的目录项。 */
  tocItem?: { label?: string; href?: string } | null
  /** 分页模式下的页码信息。 */
  location?: { current?: number; next?: number; total?: number }
}

/** `load` 事件 detail：章节 iframe 文档（Step B 划词监听挂这里）+ 章序号。 */
export interface FoliateLoadDetail {
  doc: Document
  index: number
}

/** 目录项（foliate `book.toc`，由 EPUB nav / NCX 解析而来）：标题 + 章内定位 href + 子项，可深层嵌套。 */
export interface FoliateTocItem {
  label?: string
  href?: string
  subitems?: FoliateTocItem[]
}

/**
 * `show-annotation` 事件 detail：点中一条已有高亮时抛出（view.js `#createOverlayer` 的
 * hitTest 命中）。`rect` 是命中高亮在**章节 iframe 文档坐标系**下的包围盒，adapter 需叠上
 * `frameElement` 的屏幕 rect 才是窗口坐标。
 */
export interface FoliateShowAnnotationDetail {
  /** 该高亮的 overlay key（= 建它时传入的 CFI `value`）。 */
  value: string
  /** 所在章序号。 */
  index: number
  rect?: { left: number; top: number; right: number; bottom: number }
}

/** `create-overlay` 事件 detail：某一章的 overlay 层刚建好（view.js `#createOverlayer`）。 */
export interface FoliateCreateOverlayDetail {
  /** 该章章序号（spine 序）。 */
  index: number
}

/**
 * `draw-annotation` 事件 detail：foliate 自己**不画**高亮，`addAnnotation` 把 CFI 解析成 range 后
 * 回抛此事件，由 app 调 `draw(画笔函数, 选项)` 决定怎么画（见 view.js `addAnnotation`）。
 */
export interface FoliateDrawAnnotationDetail {
  /** 用 overlayer 画笔（`Overlayer.highlight/underline/squiggly`）+ 选项落笔。 */
  draw: (func: unknown, options?: Record<string, unknown>) => void
  /** 建高亮时传入的标注对象（携带我方的 style/color 自定义字段，foliate 原样透传）。 */
  annotation: { value: string; [k: string]: unknown }
  doc: Document
  range: Range
}

/**
 * 一章 iframe 内的高亮画布（foliate `Overlayer`）：adapter 朗读高亮经它就地增删，
 * 不走 `addAnnotation`（那要 CFI、且持久语义）。key 相同即覆盖。仅声明用到的两个方法。
 */
export interface FoliateOverlayer {
  add(key: string, range: Range, draw: unknown, options?: Record<string, unknown>): void
  remove(key: string): void
}

/**
 * 渲染器（`view.renderer`），只声明 adapter 用到的面。**两种实现共用此声明**：可重排书（EPUB）是
 * `foliate-paginator`，固定版式（PDF 等 pre-paginated）是 `foliate-fxl`，由 `view.isFixedLayout` 区分——
 * 二者属性集不同（见 `setAttribute`），给错了不会报错、只是静默无效，故写属性前务必先判版式。
 */
export interface FoliateRenderer {
  /**
   * 当前已渲染各章的 { 章序号, 高亮画布, 文档 }（Paginator）。朗读取主可见章的 doc 枚举句子、
   * 取其 overlayer 画朗读高亮。固定版式的 fxl 无此方法，故可选。
   */
  getContents?(): { index: number; overlayer: FoliateOverlayer; doc: Document }[]
  /** 主可见章序号（视口中心所在章）。朗读据此定位「当前在读哪一章」。仅 Paginator。 */
  readonly primaryIndex?: number
  /**
   * 已渲染范围是否顶到书尾（vendor paginator.js 的 `get atEnd`，d.ts 原缺）。仅 Paginator。
   * 页码链路唯一用到的渲染量：页码规则禁止渲染量测参与页码**计算**，但「有没有顶到书尾」是 size 域
   * 给不出的判定（末屏可能只覆盖不足一格），故只拿它做书尾钳制（见 paginationMap.currentPage）。
   */
  readonly atEnd?: boolean
  /**
   * 把一个 Range / 元素滚动进视口（朗读自动翻页跟随）。`select=true` 时用 selection 语义滚动——
   * 不抢焦点（不设 tabIndex/focus），但落定后会把 anchor 设成真实 DOM 选区（上游自带 TTS 拿选区
   * 当高亮）；调用方不要这层选区就得自行收掉（见 ttsFollow）。仅 Paginator。
   */
  scrollToAnchor?(anchor: Range, select?: boolean, smooth?: boolean): Promise<void>
  /** 注入书页 CSS。仅 Paginator 有（固定版式是整页位图，没有可重排正文可注入），故可选。 */
  setStyles?(css: string): void
  /**
   * 设渲染属性。两套互不相通的属性集：
   * - Paginator：`flow` / `gap` / `margin-{top,bottom,left,right}` / `max-inline-size` /
   *   `max-block-size` / `max-column-count`，
   *   外加两个不在 observedAttributes 里的纯开关：`animated`（翻页动画）/ `no-swipe`。
   * - 固定版式 fxl：`zoom`（数字倍率 / `fit-width` / `fit-page`）/ `scale-factor` / `spread` /
   *   `flow`（`scrolled` = 连续滚动）/ `scroll-gap`。
   */
  setAttribute(name: string, value: string): void
  /**
   * 当前章序号（固定版式下即页序号，连续滚动时为视口中线所在页）；取不到为 -1。
   * 仅 fxl 声明——EPUB 的位置一律走 `relocate` 的 fraction / CFI，不读这个。
   */
  readonly index?: number
  next(): void
  prev(): void

  /** 是否连续滚动流（`flow=scrolled`）。 */
  readonly scrolled?: boolean
}

/** `<foliate-view>` 自定义元素，只声明 adapter 用到的面。 */
export interface FoliateViewElement extends HTMLElement {
  /** 打开一本书（Blob/File 自解析，见 view.js `open`/`makeBook`）。 */
  open(book: Blob | File): Promise<void>
  /**
   * 打开后的书对象；`toc` 为目录树（未开书或无目录时缺省）。目录模块用它取章节树。
   * `sections` 是 spine 各章，`cfi` 为该章起始 CFI —— 目录项按 `resolveNavigation` 得到的章序号取它，
   * 即得「章起始 CFI」，供标注/书签按 cfi 归章（见 engine/cfi.ts）。
   */
  readonly book?: {
    toc?: FoliateTocItem[] | null
    /** `size` 为该章解压字节数、`linear` 为 spine 的 linear 属性——location 刻度的 size 域原料。 */
    sections?: readonly { cfi?: string; linear?: string; size?: number }[]
  }
  readonly renderer: FoliateRenderer
  /**
   * 这本书是否固定版式（`book.rendition.layout === 'pre-paginated'`，PDF 恒为真）。**开书后才有值**，
   * 它决定了 `renderer` 是 fxl 还是 Paginator（见 view.js `open`），进而决定哪套渲染属性有效。
   */
  readonly isFixedLayout?: boolean
  /** 上一页（按书写方向，foliate 自处理 RTL）。 */
  goLeft(): void
  /** 下一页。 */
  goRight(): void
  /** 跳到 CFI / 章节 href，或直接给章序号（`resolveNavigation` 对数字即 `{ index }`）。 */
  goTo(target: string | number): Promise<unknown>
  /** 跳到全书比例 0–1。 */
  goToFraction(fraction: number): Promise<void>
  /** 各章在全书中的起始比例（进度条章节刻度）。 */
  getSectionFractions(): number[]
  /** 把章节 href / CFI 解析为 `{ 章序号 }`；解析失败返回 undefined（view.js `resolveNavigation`）。目录页码换算用。 */
  resolveNavigation(target: string): { index: number } | undefined
  /**
   * 某条 CFI 的 location 刻度（view.js `getCFIProgress`）：解析该章文档、数到该 CFI 处的字节量，
   * 换算成 1500 字节一格的刻度号（`location.current`，0 基）。**异步且冷章要现建 DOM**（100–300ms），
   * 只在分页表回填标注/书签页码时按需调用（见 paginationMap）。解析不到返回 null。
   * vendor 实际还返回 `fraction` / `location.next` / `location.total`，本项目一概不取——页码只准有
   * 一个口径，故按 adapter 需要裁剪声明。
   */
  getCFIProgress(cfi: string): Promise<{ location?: { current?: number } } | null | undefined>
  /** 由 (章序号, DOM Range) 生成 CFI（标注/位置的唯一定位串）。 */
  getCFI(index: number, range: Range): string
  /** 把 CFI 解析回 (章序号 + 取 range 的函数)，range editor 用它拿到高亮的原 range。 */
  resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range }
  /** 增删一条高亮 overlay：`remove` 为真则按 `value` 移除，否则解析 CFI 后回抛 `draw-annotation`。 */
  addAnnotation(annotation: { value: string; [k: string]: unknown }, remove?: boolean): Promise<unknown>
  /** 移除一条高亮 overlay（= `addAnnotation(annotation, true)`）。 */
  deleteAnnotation(annotation: { value: string }): Promise<unknown>
  /** 清空各章节文档里的原生文本选区。 */
  deselect(): void
}
