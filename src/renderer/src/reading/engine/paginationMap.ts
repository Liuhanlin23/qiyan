// 页码 = foliate location 字符刻度（SIZE_PER_LOC 字节一格），故排版无关：
// 改字号 / 开合侧栏 / 拖窗口，页码与总数都不变。
//
// 三条注意：
// 1. 翻一屏页码可能 +0 / +1 / +2（刻度与屏无关）——设计内行为，不是 bug，别"修"。
// 2. 全 app 页码唯一事实源 = pageOfCfi（字符计数域，缓存化）：底栏走 observe 挂的屏首 cfi、
//    书签/标注/笔记走各自 cfi，同一函数同一缓存。relocate 的视觉估计（location.current）只在
//    屏首解析回来前作占位显示，不是页码出口——渲染量测（列/像素/renderer.page）一律不得参与页码。
//    本注是该口径的唯一权威处，别处不再复述（改口径只改这里）。
// 3. ⚠️ `loc.fraction` 是**屏末口径**（vendor SectionProgress.getProgress 的 nextSize），拿它喂
//    `pageOfFraction` 求当前页会偏后一页；当前页只准取 `loc.location.current`（走 `observe` 占位）。

/** 必须与 vendor view.js 开书时写死的 sizePerLoc 一致，改一处就得改两处。 */
const SIZE_PER_LOC = 1500

/**
 * 章起始比例是 `字节和 ÷ sizeTotal` 除出来的，回乘 sizeTotal 带浮点渣（`(3/7) × 7000 = 2999.999…`），
 * 裸 `floor` 会把恰在刻度边界的位置算低一页、与 observe 的整数算术分叉。
 * 页号粒度 1/1500 ≈ 6.7e-4，1e-6 只吃渣不吃真值。
 */
const LOC_EPSILON = 1e-6

/** 页码查询面（展示层经引擎门面拿到的形态）。 */
export interface PaginationMap {
  /** 开书即就绪，无收敛期。固定版式（PDF）无 location 域，恒 false。 */
  readonly ready: boolean
  /** 排版无关，开书即精确且永不变。 */
  readonly totalPages: number | null
  readonly currentPage: number | null
  /**
   * 章内位置要数该章文档的字符才知道（引擎 `getCFIProgress`，冷章 100–300ms 的异步活），故**先给后修**：
   * 首次问到某条 cfi 同步返回「该章起始页」并排队解析，解析回来落缓存 + 广播 `onChange`，展示层重渲染即得最终值。
   * 缓存永不失效——location 排版无关，换字号 / 改分栏都不必清。
   */
  pageOfCfi(cfi: string): number | null
  pageOfFraction(fraction: number): number | null
  /** 返回退订。 */
  onChange(cb: () => void): () => void
}

/** 引擎 adapter 侧的控制面（页面层拿不到）。 */
export interface PaginationMapControl extends PaginationMap {
  /**
   * @param sectionFractions `view.getSectionFractions()`，长度 = 章数 + 1
   * @param sizeTotal 各 linear 章解压字节和，须对齐 vendor SectionProgress 口径
   *   —— 空数组或 0 = 本书无 location 域（固定版式）
   */
  reset(sectionFractions: readonly number[], sizeTotal: number): void
  /**
   * 每次 relocate 喂一次。`startCfi` 是屏首点 CFI（可见范围起点），`current` 是视觉比例估计的
   * 0 基屏首刻度，`atEnd` 是 `renderer.atEnd`；三者的口径与优先级见文件头注 2。
   * 解析不出屏首 cfi 时传 null。
   */
  observe(loc: { current: number; atEnd: boolean; startCfi: string | null }): void
}

export interface PaginationMapDeps {
  /** 同步、纯 CFI 解析；解析不到 null。 */
  sectionIndexOfCfi(cfi: string): number | null
  /** 异步：引擎 getCFIProgress → location.current + 1；解析不到 null。 */
  pageOfCfiAsync(cfi: string): Promise<number | null>
}

export function createPaginationMap(deps: PaginationMapDeps): PaginationMapControl {
  /** 各章起始全书比例，长度 = 章数 + 1（末位 1）；空 = 未就绪。 */
  let starts: number[] = []
  let sizeTotal = 0
  let cur: { current: number; atEnd: boolean; startCfi: string | null } | null = null

  const listeners = new Set<() => void>()
  const emit = (): void => listeners.forEach((cb) => cb())

  // null 值 = 解析失败，也要记下来，否则每次渲染都会重排一遍队。
  const pageByCfi = new Map<string, number | null>()
  const queue: string[] = []
  const queued = new Set<string>()
  let draining = false

  const isReady = (): boolean => starts.length >= 2 && sizeTotal > 0
  const total = (): number | null => (isReady() ? Math.ceil(sizeTotal / SIZE_PER_LOC) : null)
  /** 书尾整除刻度时 +1 会越界一格，故须钳。仅就绪后调用。 */
  const clamp = (page: number): number => Math.max(1, Math.min(total() ?? 1, page))

  // 串行跑：侧栏一次渲染出几十行，并发解析就是同时建几十个章节 DOM。
  // drain 是 pageByCfi 的唯一写入口，且 queued 保证同一 cfi 不会重复入队，故无需再防重写。
  const drain = async (): Promise<void> => {
    if (draining) return
    draining = true
    try {
      for (let cfi = queue.shift(); cfi !== undefined; cfi = queue.shift()) {
        let page: number | null = null
        try {
          page = await deps.pageOfCfiAsync(cfi)
        } catch {
          page = null
        }
        pageByCfi.set(cfi, page == null ? null : clamp(page))
        queued.delete(cfi)
        // 屏首解析完成即时广播（底栏在等）；其余攒到队列见底一次性刷，免得书签列表逐条重渲。
        if (queue.length === 0 || cfi === cur?.startCfi) emit()
      }
    } finally {
      draining = false
    }
  }

  /**
   * 排队解析一条 cfi 的章内页号。已缓存（含解析失败的 null）或已在队里都不再排。
   * `urgent` = 屏首：插队头，否则底栏要等侧栏那几十条书签解析完，占位期能拖到秒级。
   */
  const enqueue = (cfi: string | null, urgent = false): void => {
    if (!cfi || pageByCfi.has(cfi) || queued.has(cfi)) return
    queued.add(cfi)
    if (urgent) queue.unshift(cfi)
    else queue.push(cfi)
    void drain()
  }

  /** 当前页的取值优先级（口径见文件头注 2）：书尾钳制 > 屏首 cfi 的字符计数精确值 > 视觉估计占位。 */
  const pageOfCur = (at: typeof cur): number | null => {
    if (!isReady() || at == null) return null
    if (at.atEnd) return total()
    const exact = at.startCfi == null ? undefined : pageByCfi.get(at.startCfi)
    return exact ?? clamp(at.current + 1)
  }

  function pageOfFraction(fraction: number): number | null {
    if (!isReady() || !Number.isFinite(fraction)) return null
    const f = Math.min(1, Math.max(0, fraction))
    return clamp(Math.floor((f * sizeTotal) / SIZE_PER_LOC + LOC_EPSILON) + 1)
  }

  return {
    get ready() {
      return isReady()
    },
    get totalPages() {
      return total()
    },
    get currentPage() {
      return pageOfCur(cur)
    },
    pageOfFraction,

    pageOfCfi(cfi) {
      if (!isReady() || !cfi) return null
      const cached = pageByCfi.get(cfi)
      if (cached != null) return cached
      enqueue(cfi) // 解析回来前先给该章起始页顶上
      const index = deps.sectionIndexOfCfi(cfi)
      if (index == null || index < 0 || index >= starts.length - 1) return null
      return pageOfFraction(starts[index])
    },

    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },

    reset(sectionFractions, newSizeTotal) {
      // 不足两项（即不足一章）或无 size 域，都无页码可言。
      if (sectionFractions.length < 2 || !(newSizeTotal > 0)) {
        starts = []
        sizeTotal = 0
      } else {
        starts = sectionFractions.map((x) => Math.min(1, Math.max(0, x)))
        starts[starts.length - 1] = 1
        sizeTotal = newSizeTotal
      }
      cur = null
      pageByCfi.clear()
      queue.length = 0
      queued.clear()
      emit()
    },

    observe(loc) {
      if (!isReady()) return
      // 广播与否只看**显示值**变没变：重排期间 relocate 会反复抛同一屏的不同表述（current 不动只
      // 换 startCfi 等），比对原始三元组会把这些白刷也算成「动了」，逐次重渲整个阅读器。
      const before = pageOfCur(cur)
      cur = { current: loc.current, atEnd: loc.atEnd, startCfi: loc.startCfi }
      enqueue(loc.startCfi, true)
      if (pageOfCur(cur) !== before) emit()
    },
  }
}
