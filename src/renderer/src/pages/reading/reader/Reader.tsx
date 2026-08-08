import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useDarkMode } from '@/hooks/useTheme'
import { cn } from '@/lib/cn'
import { toast } from '@/lib/toast'
import * as reading from '@/reading'
import type { AnnotationRecord, BookmarkRecord, CfiRange, FoliateEngine, TocNode } from '@/reading'
import { DEFAULT_SETTINGS, getSettings, onSettingsChange } from '@/settings'
import { ReaderHeaderBar } from './chrome/ReaderHeaderBar'
import { ReaderFooterBar } from './chrome/ReaderFooterBar'
import { PageIndicator } from './chrome/PageIndicator'
import { ReaderSidebar } from './sidebar/ReaderSidebar'
import { FoliateView } from './FoliateView'
import { SelectionAnnotator } from './annotation/SelectionAnnotator'
import { NoteDialog } from './annotation/NoteDialog'
import { useInlineTranslation } from './translation/useInlineTranslation'
import {
  readTranslationProvider,
  storeTranslationProvider,
  type TranslationProvider,
} from './translation/providerMemory'
import {
  clearBookData,
  createBookmark,
  getAnnotation,
  loadBookData,
  removeAnnotation,
  removeBookmark,
  renameBookmark,
  updateAnnotation,
  useAnnotations,
  useBookmarks,
} from './annotationStore'
import { getFixedTypography, HIGHLIGHT_INK, OVERLAY_STYLE, readerMarginBottomPx } from './constants'
import { itemsInRange } from './util'
import { TtsBarPlayer } from './tts/TtsBarPlayer'
import { TtsFullPlayer } from './tts/TtsFullPlayer'
import { useTtsSession } from './tts/useTtsSession'
import { useReadingTracker } from './useReadingTracker'

/**
 * 阅读器 —— 从书架点开一本书后进入的独立整屏阅读页（对应路由 /reader/:bookHash）。
 *
 * 正文由 vendor 的 foliate 引擎真渲染一本真 EPUB（经 `@/reading` 门面 + `FoliateView` 挂载），
 * 翻页 / 进度 / 章节 / 划词标注（`SelectionAnnotator`）全部走真引擎；顶/底栏为默认隐藏的浮层 chrome，
 * 鼠标移到正文上/下缘唤出（对齐 macOS「图书」，正文上的点击一概不动 chrome、也不翻页）。
 * 翻页有三条入口：滚轮 / 触控板双指（引擎内接线）、底栏按钮、方向键 / 空格。
 *
 * 书按路由 `:bookHash` 从本地 user_book 表取元数据，书文件从内容寻址存储 `books/<hash>/` 读出来喂引擎；
 * 行不在（或已删）、文件不在本机都给兜底态，不放进阅读器。
 * 标注 / 书签 / 阅读进度全部落本地库：开书拉当书数据进 [annotationStore](./annotationStore.ts) 并把已有高亮
 * 补画回正文，退出前把进度 flush 掉。正文排版（`applyAppearance`）= 全局设置里的字号/字体族（`@/settings`，
 * 落库随账号同步、改完即时重排）+ 首版固定的其余项（`getFixedTypography`），书页明暗跟随 App 全局主题；
 * 对照翻译真接引擎（`useInlineTranslation` 懒翻可见段落、英→中双语对照，开关为内存态）；
 * 朗读（M14）真接 Edge 合成引擎（`tts/useTtsSession`），底栏开关 + 划词起播 + 迷你条/完整播放器。
 */

const EPS = 1e-4

/** 翻页写进度的去抖窗口：连按方向键时只落最后一次，别每页一趟 IPC。 */
const PROGRESS_DEBOUNCE_MS = 1000

/**
 * 键盘翻页要放行的元素：空格是按钮/输入类元素的激活键，抢走它意味着点完顶栏按钮再按空格是翻页
 * 而不是重新激活该按钮。用 closest 匹配而非 tagName，才盖得住按钮内层 svg/span 成为事件目标的情形。
 */
const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [contenteditable="true"]'

/** 在目录树里按 href 找章标题（新书签的默认名取当前章名；列表分组不用它，按 cfi 现算）。 */
function findChapterLabel(nodes: TocNode[], href: string | null): string {
  if (!href) return ''
  for (const n of nodes) {
    if (n.href === href) return n.label
    const sub = findChapterLabel(n.subitems, href)
    if (sub) return sub
  }
  return ''
}

export function Reader(): React.JSX.Element {
  const navigate = useNavigate()
  // 书架点书进来的 :bookHash → user_book 行（含墓碑，便于把「已删」和「从没有过」都归到兜底态）。
  const { bookHash = '' } = useParams<{ bookHash: string }>()
  const bookQuery = useAsyncData(() => reading.getBook(bookHash), [bookHash])
  const book = bookQuery.data && !bookQuery.data.isDeleted ? bookQuery.data : null
  const format = book?.format ?? ''

  // 书文件读取器（FoliateView 要求稳定引用）。读不到多半是文件不在本机，换成人话再抛给它的错误态。
  const loadBook = useCallback(async () => {
    try {
      return await reading.openBookFile(bookHash, format)
    } catch (e) {
      console.error('[reading] 读取书文件失败：', e)
      throw new Error('书文件不在本机。它可能已被删除，或还没从其它设备同步过来。')
    }
  }, [bookHash, format])

  // ── 阅读进度：翻页去抖写库，离开前 flush ──
  // restoredRef=false 期间不记进度：开书首帧的那次 relocate 是「第 1 页」，记下去会把上次的位置盖掉。
  const restoredRef = useRef(false)
  const pendingRef = useRef<{ location: string; fraction: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushProgress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const pending = pendingRef.current
    if (!pending || !bookHash) return
    pendingRef.current = null
    void reading
      .saveProgress(bookHash, pending.location, pending.fraction)
      .catch((e) => {
        console.error('[reading] 记录阅读进度失败：', e)
        toast.error('阅读进度没能保存')
      })
  }, [bookHash])

  const queueProgress = useCallback(
    (location: string, fraction: number) => {
      if (!restoredRef.current) return
      pendingRef.current = { location, fraction }
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flushProgress, PROGRESS_DEBOUNCE_MS)
    },
    [flushProgress],
  )

  // 关书（离开路由）与关窗前都要把攒着的进度写掉，否则「读两页就退出」白读。
  useEffect(() => {
    window.addEventListener('beforeunload', flushProgress)
    return () => {
      window.removeEventListener('beforeunload', flushProgress)
      flushProgress()
    }
  }, [flushProgress])

  // ── 当书数据：标注/书签装进 store，进度取回来供恢复位置 ──
  // 只在开书时拉一次；后续增删改由 store 就地维护镜像，不再回库重读。
  const initialLocationRef = useRef<string | null>(null)
  const [dataReady, setDataReady] = useState(false)
  useEffect(() => {
    if (!bookHash) return
    let cancelled = false
    setDataReady(false)
    restoredRef.current = false
    void (async () => {
      try {
        const [, saved] = await Promise.all([loadBookData(bookHash), reading.getProgress(bookHash)])
        if (cancelled) return
        initialLocationRef.current = saved?.location ?? null
      } catch (e) {
        console.error('[reading] 加载标注 / 进度失败：', e)
        toast.error('这本书的标注与阅读位置没能读出来')
      } finally {
        // 失败也要放行：读不出旧数据不该把人挡在书外面，最差就是从头读、新标注照样能存。
        if (!cancelled) setDataReady(true)
      }
    })()
    return () => {
      cancelled = true
      clearBookData()
    }
  }, [bookHash])

  // ── 引擎实例 + 由 relocate 派生的位置态 ──
  const [engine, setEngine] = useState<FoliateEngine | null>(null)
  const [fraction, setFraction] = useState(0)
  const [sectionMarks, setSectionMarks] = useState<number[]>([])
  // 目录：目录树 + 当前章 href + 当前 cfi（供「当前位置」跳转）。
  const [toc, setToc] = useState<TocNode[]>([])
  const [currentHref, setCurrentHref] = useState<string | null>(null)
  const [currentCfi, setCurrentCfi] = useState<string | null>(null)
  // 页码：当前页 / 总页数一律出自引擎的分页表（location 字符刻度，排版无关），不落库、不入进度。
  // 这里只存一份快照供渲染；真源是 engine.pagination，随 relocate 经 onChange 重取。
  const [pageInfo, setPageInfo] = useState<{ current: number | null; total: number | null }>({
    current: null,
    total: null,
  })
  const { current: currentPage, total: totalPages } = pageInfo
  // 当前屏可见范围（引擎 relocate 的区间 CFI 端点，[start, end)）：顶栏书签键与侧栏书签「当前」判定用。
  const [visibleRange, setVisibleRange] = useState<CfiRange | null>(null)

  // ── chrome / 侧栏 / 笔记本 ──
  // 顶/底栏默认隐藏（沉浸阅读）；唯一入口是鼠标移到正文上/下缘的感应带（见下方 hover 带）。
  const [chromeVisible, setChromeVisible] = useState(false)
  // 设置弹窗（顶栏「设置」唤起，定位「阅读」分区）。阅读器是 AppShell 之外的整屏路由，
  // 拿不到壳上那份实例，故在此复用同一个组件挂一份。
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 弹窗开着时 chrome 强制常显：鼠标移到弹窗上就算「离开了顶栏」，收掉会让人关掉弹窗后
  // 对着空白正文找不到刚才那枚设置键。
  const chromeShown = chromeVisible || settingsOpen
  const hideChrome = (): void => {
    if (!settingsOpen) setChromeVisible(false)
  }
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // 左侧栏「标注」页签里当前就地展开编辑器的标注 id（写笔记 / 编辑 / 笔记气泡唤起时设置）。
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  // 标注 / 书签：读共享 store（库驱动）。标注用于开书补画正文高亮，书签用于顶栏「加书签」态。
  const annotations = useAnnotations()
  const bookmarks = useBookmarks()
  // 笔记对话框当前编辑的标注（activeNoteId 指向的那条；被删 / 找不到则为 null → 对话框关闭）。
  const activeNote = activeNoteId ? annotations.find((a) => a.id === activeNoteId) ?? null : null

  // ── 正文排版（真接引擎）/ 主题 / 翻译 ──
  // 字号与字体族是账户级设置（user_setting，随账号同步）：这里只读，唯一改动入口是全局设置弹窗的
  // 「阅读」分区。门面在写完后广播（onSettingsChange），故弹窗开着改，正文当场重排。
  const settingsQuery = useAsyncData(() => getSettings(), [])
  // 取数期间用全默认顶着（读失败也停在这份），但**不喂给引擎**——见下方排版 effect 的 loading 早退：
  // 先按 16px 排一遍、设置到了再按 20px 排一遍，开书就会当着人面重排一次。
  const { data: settings = DEFAULT_SETTINGS, loading: settingsLoading, reload: reloadSettings } = settingsQuery
  useEffect(() => onSettingsChange(() => void reloadSettings()), [reloadSettings])
  // 书页明暗跟随 App 全局主题（阅读器没有独立主题项）：CDS token 自动给 chrome 换色，
  // 而书页在 iframe 里、引擎不认识 token，故把折算出的明暗二值随排版一起喂给它。
  const dark = useDarkMode()
  // 对照翻译：开关内存态。仅可重排 EPUB 可译——固定版式（PDF）
  // 无正文流，engine.isFixedLayout 为真时不可译（顶栏据此禁用按钮）；engine 未就绪时先按不可译。
  const [translationEnabled, setTranslationEnabled] = useState(false)
  const translatable = !!engine && !engine.isFixedLayout
  // 句子翻译引擎：设备级记忆（localStorage，不同步）。整个阅读器共用这一份，划词翻译框里切一次，
  // 对照翻译的后续段落也随之改用新引擎；下次开 app 仍是上次的选择。
  const [translationProvider, setTranslationProvider] = useState<TranslationProvider>(
    readTranslationProvider,
  )
  const changeTranslationProvider = useCallback((p: TranslationProvider) => {
    setTranslationProvider(p)
    storeTranslationProvider(p)
  }, [])
  // 翻译接口失败：关开关（否则按钮亮着却不再翻，比不提示更像坏了）+ 提示换一家重试。
  // 关开关走的是正常 teardown，已译段落随之清掉；缓存留着，重开时不必再请求一遍。
  const handleTranslationFail = useCallback(() => {
    setTranslationEnabled(false)
    toast.warning('对照翻译失败，已关闭。可切换翻译服务后重新开启')
  }, [])
  // 阅读器根容器：读取书页主题色的探针宿主。
  const containerRef = useRef<HTMLDivElement>(null)

  // FoliateView 稳定回调（否则开书 effect 会因回调变化反复重建引擎）。
  const handleEngineReady = useCallback((e: FoliateEngine) => setEngine(e), [])
  const handleEngineGone = useCallback(() => setEngine(null), [])

  // 订阅引擎位置变化：读全书比例、当前章 href、当前屏可见范围、章节刻度、目录树。
  useEffect(() => {
    if (!engine) return
    setSectionMarks(engine.sectionFractions())
    setToc(engine.getTOC())
    const off = engine.onRelocate((loc) => {
      const f = loc.fraction ?? 0
      setFraction(f)
      setCurrentHref(loc.tocItem?.href ?? null)
      setCurrentCfi(loc.cfi ?? null)
      if (loc.cfi) queueProgress(loc.cfi, f)
      setVisibleRange(engine.visibleCfiRange())
      // 首次 relocate 时章节刻度可能才可用，补一次。
      setSectionMarks((prev) => (prev.length ? prev : engine.sectionFractions()))
    })
    return off
  }, [engine, queueProgress])

  // 页码：跟着分页表走。它在 relocate（位置变化）与 cfi 页号回填时广播 onChange，
  // 这里重取一次即可——四处页码（指示条 / 侧栏 / 笔记对话框 / 目录）由此同源同值。
  useEffect(() => {
    if (!engine) return
    const map = engine.pagination
    // 恒建新对象（不比对早退）：表里变的可能只是某条 cfi 的章内位置——当前页/总页数没动，但侧栏那句
    // 「p N」得刷新。onChange 本身只在表真的变了时才响，故这里不会白刷。
    const sync = (): void => setPageInfo({ current: map.currentPage, total: map.totalPages })
    sync()
    return map.onChange(sync)
  }, [engine])

  // 侧栏 / 笔记对话框的「p N」现算入口（分页表是唯一来源）。engine 换了才换引用，免得列表每帧重算。
  const pageOfCfi = useCallback((cfi: string) => engine?.pagination.pageOfCfi(cfi) ?? null, [engine])
  const pageOfFraction = useCallback(
    (f: number) => engine?.pagination.pageOfFraction(f) ?? null,
    [engine],
  )

  // 阅读时长采集（无 UI）：位置键与 UI 页码同域（都是 location 刻度）。
  // currentPage 是 1 基显示值，还原回 0 基 location 喂计时内核；分页表未就绪（开书首帧 / PDF）不喂。
  // **已知限制**：PDF 因此不产计时事件（靠空闲 / 隐藏 / 关书仍会结算出片段）——PDF 计时需要另一套
  // 位置键，暂不支持，不是 bug。
  useReadingTracker(bookHash, currentPage == null ? null : currentPage - 1, totalPages, fraction)

  // ── 朗读（M14）：会话状态全在 hook / session 核心，Reader 只放 UI 开合 ──
  const tts = useTtsSession(engine, bookHash)
  const [ttsExpanded, setTtsExpanded] = useState(false)
  // 会话结束（读完 / 出错 / 手动停）连带收起完整播放器，别留一张空面板
  useEffect(() => {
    if (!tts.active) setTtsExpanded(false)
  }, [tts.active])

  // 恢复上次读到的位置：等当书数据取回来（initialLocationRef 已填）再跳，且只跳一次。
  // 跳完（或本来就没读过）才开始记进度——否则开书首帧那次 relocate 会把「第 1 页」当成新进度写回去。
  useEffect(() => {
    if (!engine || !dataReady) return
    const saved = initialLocationRef.current
    if (!saved) {
      restoredRef.current = true // 从没读过：没什么要恢复的，立刻开始记
      return
    }
    // 必须等 goTo settle 才放行：跳转发起到落位之间引擎还会抛「仍在第 1 页」的 relocate，
    // 提前放行就会把它当新进度写回去——goTo 失败（CFI 陈旧）时那次覆盖是永久的。
    void engine
      .goTo(saved)
      .catch((e) => {
        console.error('[reading] 恢复阅读位置失败：', e)
        toast.warning('没能恢复上次的阅读位置')
      })
      .finally(() => {
        restoredRef.current = true
      })
  }, [engine, dataReady])

  // 把已有标注画回正文。foliate 不替我们持久化 overlay（换章即没），故每次某章 overlay 层建好都要补画。
  // 刻意**不依赖 annotations 数组**：单条的落笔/改色/删除各自就地画（SelectionAnnotator / 下面几个回调），
  // 挂进依赖会让笔记编辑器每敲一个字就把全书标注重画一遍。用 ref 取最新值即可。
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations
  useEffect(() => {
    if (!engine) return
    const paint = (list: AnnotationRecord[]): void => {
      for (const a of list) {
        void engine.drawAnnotation({ value: a.cfi, style: OVERLAY_STYLE[a.style], color: HIGHLIGHT_INK[a.color] })
        if (a.note.trim()) void engine.drawNote(a.cfi, HIGHLIGHT_INK[a.color])
      }
    }
    paint(annotationsRef.current)
    return engine.onOverlayCreated((index) => {
      // 只补画这一章的：别章的标注画下去也是解析不到 range 的 no-op，但每条都要走一趟 CFI 解析，
      // 百条标注 × 每翻入一章就白算一百次。取不到章边界（书没解析出 sections）时回退整书补画。
      const range = engine.sectionCfiRange(index)
      if (!range) return paint(annotationsRef.current)
      paint(annotationsRef.current.filter((a) => reading.isCfiInSection(a.cfi, range.start, range.end)))
    })
  }, [engine, dataReady])

  // 正文排版 → 引擎：设置里的字号/字体族 + 首版固定的其余项，注入书页并即时重排。主题色不硬编码——
  // 用一枚探针读出 CDS token 解析后的书页 bg/fg 具体色值（<html> 上的 data-mode 已由全局主题挂好，
  // 探针读到的即当前明暗对应的颜色；故 dark 变化时本 effect 必须重跑）。
  useEffect(() => {
    if (!engine || settingsLoading) return
    const container = containerRef.current
    let pageBg = ''
    let pageFg = ''
    if (container) {
      const probe = document.createElement('div')
      probe.style.cssText =
        'position:absolute;visibility:hidden;pointer-events:none;background-color:var(--color-page-bg);color:var(--color-text-100)'
      container.appendChild(probe)
      const cs = getComputedStyle(probe)
      pageBg = cs.backgroundColor
      pageFg = cs.color
      container.removeChild(probe)
    }
    const fixed = getFixedTypography()
    engine.applyAppearance({
      fontSize: settings.readingFontSize,
      fontFamily: settings.readingFontFamily,
      lineHeight: fixed.lineHeight,
      justify: fixed.justify,
      hyphenate: fixed.hyphenate,
      paragraphSpacing: fixed.paragraphSpacing,
      maxInlineSize: fixed.maxWidth,
      marginPx: fixed.marginPx,
      // 底边距给底部留白带（页码住在里面）腾位，朗读期间再多让出一个迷你条高（口径见 constants）。
      marginBottomPx: readerMarginBottomPx(fixed.marginPx, tts.active),
      columns: fixed.columns,
      pageBg,
      pageFg,
      dark,
    })
    // 依赖里只挂 tts.active 这个布尔（起播/停止各重排一次，回位由引擎的 scheduleReflowRestore 兜底），
    // 别挂整个 tts——hook 返回对象每次渲染都是新引用，挂它等于每帧重排一次正文。
  }, [engine, settingsLoading, settings.readingFontSize, settings.readingFontFamily, dark, tts.active])

  // 对照翻译：开启后懒翻可见段落、把中文追加到原文下方（真接引擎的书页 iframe，见 hook）。
  useInlineTranslation(
    engine,
    translationEnabled && translatable,
    translationProvider,
    handleTranslationFail,
  )
  // 打开的书是不可译版式（PDF）时收回可能残留的开启态，免得顶栏显示「已开启」却无正文可译。
  useEffect(() => {
    if (!translatable) setTranslationEnabled(false)
  }, [translatable])

  // ── 翻页 / 切章（全部驱动真引擎）──
  const goPrevPage = useCallback(() => engine?.prevPage(), [engine])
  const goNextPage = useCallback(() => engine?.nextPage(), [engine])

  // 章节导航按「章起始比例刻度」跳转：上一章=严格小于当前比例的最后一个刻度（在章中即回本章开头、
  // 已在章首则回上一章）；下一章=严格大于当前比例的第一个刻度。
  const prevChapterMark = [...sectionMarks].reverse().find((m) => m < fraction - EPS)
  const nextChapterMark = sectionMarks.find((m) => m > fraction + EPS)
  const goPrevChapter = useCallback(() => {
    if (prevChapterMark !== undefined) void engine?.goToFraction(prevChapterMark)
  }, [engine, prevChapterMark])
  const goNextChapter = useCallback(() => {
    if (nextChapterMark !== undefined) void engine?.goToFraction(nextChapterMark)
  }, [engine, nextChapterMark])
  const seekFraction = useCallback((f: number) => void engine?.goToFraction(f), [engine])

  // ── 键盘翻页（交互元素内不拦截）。FoliateView 不自带键盘，这里统一接管。 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t?.closest?.(INTERACTIVE_SELECTOR)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        engine?.nextPage()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        engine?.prevPage()
      }
    }
    window.addEventListener('keydown', onKey)
    // 书页各章是独立 iframe，keydown 不冒泡到 window：点一下正文后方向键就全灭了。
    // 引擎逐章转发过来的按键喂同一个 handler，翻页逻辑只此一份。
    const offEngineKey = engine?.onKeydown(onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      offEngineKey?.()
    }
  }, [engine])

  // ── 标注 / 书签簇（数据在共享 annotationStore，库驱动；划词新高亮即时进列表）──
  // 当前章标题只用来给新书签起个默认名——标注/书签都不存章名，列表分组按 cfi 现算（grouping.ts）。
  const currentChapterLabel = useMemo(() => findChapterLabel(toc, currentHref), [toc, currentHref])

  // 本屏书签：顶栏书签键的开关态与侧栏「当前」高亮同一套判定（util.itemsInRange，按 cfi ∈ 当前屏
  // 可见范围，与页码域脱钩——理由见该函数注释）。引擎还没抛过位置时为空，书签键呈未加态。
  const pageBookmarks = itemsInRange(bookmarks, visibleRange)
  const bookmarked = pageBookmarks.length > 0

  // 打开笔记对话框写某条标注（划词写笔记 / 编辑 / 笔记气泡「写笔记」共用）。
  const openNote = useCallback((id: string) => setActiveNoteId(id), [])

  // 点标注/笔记条目：只跳回原文（不打开编辑器——编辑走各自的「编辑」入口）。
  const navigateAnnotation = useCallback((a: AnnotationRecord) => void engine?.goTo(a.cfi), [engine])

  // 改笔记：写回 store，并按笔记有无在正文里增删笔记锚点（同色 bubble）。
  const updateNote = useCallback(
    (id: string, note: string) => {
      updateAnnotation(id, { note })
      const a = getAnnotation(id)
      if (a) {
        if (note.trim()) void engine?.drawNote(a.cfi, HIGHLIGHT_INK[a.color])
        else void engine?.eraseNote(a.cfi)
      }
    },
    [engine],
  )

  // 删除标注：连正文高亮 + 笔记锚点一起擦（对齐 readest）；若删的是当前聚焦条则清空聚焦。
  const removeAnnotationById = useCallback(
    (id: string) => {
      const a = getAnnotation(id)
      if (a) {
        void engine?.eraseAnnotation(a.cfi)
        void engine?.eraseNote(a.cfi)
      }
      removeAnnotation(id)
      setActiveNoteId((cur) => (cur === id ? null : cur))
    },
    [engine],
  )

  // 在当前阅读点加一条书签。默认名取当前章名，可在书签列表里就地改。
  // 刻意**不把页码烤进 title**：title 是持久化的，页码是运行时现算量，存进去等于把一个数字写死在
  // 名字里。取不到章名就退回「书签」。
  const addBookmarkAtCurrent = useCallback(() => {
    // 引擎还没抛过位置（首帧未到）时没有 cfi 可挂，此时不落书签。
    if (!currentCfi) return
    createBookmark({ cfi: currentCfi, title: currentChapterLabel || '书签' })
  }, [currentCfi, currentChapterLabel])

  // 顶栏书签键：本页已有书签→全部移除（历史上同页叠出的多条一并清掉，一页一个开关态），否则→新增。
  const toggleBookmark = useCallback(() => {
    if (pageBookmarks.length > 0) pageBookmarks.forEach((b) => removeBookmark(b.id))
    else addBookmarkAtCurrent()
  }, [pageBookmarks, addBookmarkAtCurrent])

  // 点书签条目：跳回该页。
  const navigateBookmark = useCallback((b: BookmarkRecord) => void engine?.goTo(b.cfi), [engine])

  // 行还没取回来 / 取数出错 / 取回来是空（没这本书或已删）：都不进阅读器。
  if (!book)
    return (
      <ReaderFallback
        loading={bookQuery.loading}
        error={bookQuery.error}
        onBackToShelf={() => navigate('/reading')}
      />
    )

  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1 overflow-hidden bg-page-bg">
      {/* 左侧栏（目录 / 标注 / 书签，均为真数据）：隐藏式折叠。 */}
      <div
        className={cn(
          'shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
          sidebarOpen ? 'w-[300px]' : 'w-0',
        )}
      >
        <ReaderSidebar
          className="h-full w-[300px] border-r-[0.5px] border-border-300"
          open={sidebarOpen}
          toc={toc}
          currentHref={currentHref}
          currentPage={currentPage}
          visibleRange={visibleRange}
          pageOfFraction={pageOfFraction}
          pageOfCfi={pageOfCfi}
          onNavigate={(href) => void engine?.goTo(href)}
          onNavigateToCurrent={() => {
            if (currentCfi) void engine?.goTo(currentCfi)
          }}
          onNavigateAnnotation={navigateAnnotation}
          onEditAnnotation={openNote}
          onRemoveAnnotation={removeAnnotationById}
          onNavigateBookmark={navigateBookmark}
          onRenameBookmark={renameBookmark}
          onRemoveBookmark={removeBookmark}
          onAddBookmark={addBookmarkAtCurrent}
        />
      </div>

      {/* 中列：正文（真引擎 + 划词标注）铺满；顶/底栏为浮层覆盖，靠上/下缘 hover 感应带切换显隐。
          data-view-transition-root：整屏 slide 翻页的快照边界。引擎翻页时从 renderer 向上 closest 找到本
          容器、给它打 view-transition-name: foliate-turn，让正文 + 页码条 + 上下留白（连同此刻隐藏的顶/底栏
          浮层）作为「一张纸」整体滑动（对齐 macOS 图书）。turn-style 的接线见 reading/engine/foliateEngine。 */}
      <div
        data-view-transition-root=""
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        <FoliateView
          loadBook={loadBook}
          onEngineReady={handleEngineReady}
          onEngineGone={handleEngineGone}
        >
          {engine && (
            <SelectionAnnotator
              engine={engine}
              onOpenNote={openNote}
              onSpeakSelection={tts.startFromSelection}
              onSpeakCfi={tts.startFromCfi}
              translationProvider={translationProvider}
              onTranslationProviderChange={changeTranslationProvider}
            />
          )}
        </FoliateView>

        {/* 正文右下角的常驻页码（对齐 readest）：绝对定位浮层，贴底占满与底栏同高的那条留白带
            （margin-bottom 已按 BOTTOM_BAND_PX 腾位，压不到最后一行），格式恒为 x / y；底栏浮出时
            会盖住这条带，故整条淡出。落在中列快照根内，故 slide 翻页时随正文整屏滑动。 */}
        <PageIndicator
          currentPage={currentPage}
          totalPages={totalPages}
          fraction={fraction}
          chromeOpen={chromeShown}
        />

        {/* 「回到朗读位置」：手动翻页脱离后贴顶 4px 居中（对齐 readest）。常驻挂载、靠 opacity 进出，
            与顶/底栏同一套 200ms 过渡；位置固定不随 chrome 动，免得鼠标伸过来时按钮自己挪走。
            **顶栏浮出即淡出**：它与顶栏同占顶部这一条，不让位就会盖住中段的书名。
            于是按钮那一竖列必须自己把顶部 hover 感应带挡住（内层撑满 h-12 并吃掉指针事件，z-30 在
            感应带 z-10 之上）——否则鼠标从正文往上够按钮时，会先踩到按钮下方 40–48px 那道缝、唤出
            顶栏，按钮在被点到之前就淡没了，等于永远点不着。从侧面掠进来仍会唤出顶栏、按钮照常让位。
            外层 pointer-events-none：两侧空白继续透给正文；隐藏期间内层也不吃事件。 */}
        {tts.active && (
          <div
            className={cn(
              'pointer-events-none absolute inset-x-0 top-0 z-30 flex h-12 items-start justify-center pt-1 transition-opacity duration-200 ease-out',
              tts.detached && !chromeShown ? 'opacity-100' : 'opacity-0',
            )}
          >
            <div className={cn('h-full', tts.detached && !chromeShown && 'pointer-events-auto')}>
              <Button
                variant="secondary"
                round
                className="border-border-300 bg-surface-popover shadow-popover"
                onClick={tts.returnToTtsLocation}
              >
                回到朗读位置
              </Button>
            </div>
          </div>
        )}

        {/* 朗读迷你条：会话进行中常驻正文底部（对齐 readest）。静止位 bottom-12 = 底部留白带高
            （BOTTOM_BAND_PX=48），条底缘正贴带顶缘；底栏浮出时上抬 8px（-translate-y-2），在底栏
            h-12 之上留出缝。抬升走 translate 而非改 bottom：位移不触发布局、与顶/底栏同一套位移
            语汇，且静止位只留 bottom-12 这一个数字（不必再维护一个 48+8 的派生值）。
            z-30 > 底栏 z-20 故压在底栏上方、不挡它的进度滑块与按钮。外层 pointer-events-none 让两侧
            空白继续透给正文（同 demo 的挂法）。 */}
        {tts.active && (
          <div
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-12 z-30 flex justify-center px-6 transition-transform duration-200 ease-out',
              chromeShown ? '-translate-y-2' : 'translate-y-0',
            )}
          >
            <div className="pointer-events-auto flex w-full max-w-md justify-center">
              <TtsBarPlayer
                book={book.title}
                chapter={currentChapterLabel}
                playing={tts.playing}
                elapsed={tts.elapsed}
                duration={tts.duration}
                measuredFraction={tts.bufferedFraction}
                hasTimeline
                repeating={tts.repeating}
                onTogglePlay={tts.togglePlay}
                onPrevSentence={tts.prevSentence}
                onNextSentence={tts.nextSentence}
                onToggleRepeat={tts.toggleRepeat}
                onSeek={tts.seek}
                onStop={tts.stop}
                onExpand={() => setTtsExpanded(true)}
              />
            </div>
          </div>
        )}

        {/* 顶/底边缘的 hover 感应带（与栏同高）：把鼠标移到正文上/下缘即唤出 chrome。默认隐藏的沉浸阅读
            少了这个就没有可发现的入口——连「返回书架」都藏在顶栏里，只能靠点正文中间试出来。
            chrome 一显示就撤掉，免得白占正文顶/底 48px 的点击与划词（对齐 readest 的顶部感应带）。 */}
        {!chromeShown && (
          <>
            <div className="absolute inset-x-0 top-0 z-10 h-12" onMouseEnter={() => setChromeVisible(true)} />
            <div className="absolute inset-x-0 bottom-0 z-10 h-12" onMouseEnter={() => setChromeVisible(true)} />
          </>
        )}

        {/* 顶栏浮层 */}
        <div
          className={cn(
            // 过渡列表写 translate 而非 transform：Tailwind v4 的 translate-y-* 落的是 `translate`
            // 属性（不是 `transform`），写成 transform 的话滑入滑出是瞬移、只有 opacity 在渐变。
            'absolute inset-x-0 top-0 z-20 transition-[translate,opacity] duration-200 ease-out',
            chromeShown ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-full opacity-0',
          )}
          onMouseLeave={hideChrome}
        >
          {/* 对照翻译：顶栏开关真驱动 useInlineTranslation；不可译版式（PDF）禁用按钮。 */}
          <ReaderHeaderBar
            title={book.title}
            author={book.author}
            bookmarked={bookmarked}
            translationOn={translationEnabled}
            translatable={translatable}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            onToggleBookmark={toggleBookmark}
            onToggleTranslation={() => setTranslationEnabled((v) => !v)}
            onOpenSettings={() => setSettingsOpen(true)}
            onBackToShelf={() => navigate('/reading')}
          />
        </div>

        {/* 底栏浮层 */}
        <div
          className={cn(
            // 过渡列表写 translate 的理由同顶栏。
            'absolute inset-x-0 bottom-0 z-20 transition-[translate,opacity] duration-200 ease-out',
            chromeShown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-full opacity-0',
          )}
          onMouseLeave={hideChrome}
        >
          <ReaderFooterBar
            fraction={fraction}
            canPrev={fraction > EPS}
            canNext={fraction < 1 - EPS}
            canPrevChapter={prevChapterMark !== undefined}
            canNextChapter={nextChapterMark !== undefined}
            ttsOpen={tts.active}
            onPrevPage={goPrevPage}
            onNextPage={goNextPage}
            onPrevChapter={goPrevChapter}
            onNextChapter={goNextChapter}
            onSeekFraction={seekFraction}
            onToggleTts={tts.toggleTts}
          />
        </div>
      </div>

      <TtsFullPlayer
        open={ttsExpanded && tts.active}
        onOpenChange={setTtsExpanded}
        book={book.title}
        chapter={currentChapterLabel}
        playing={tts.playing}
        elapsed={tts.elapsed}
        duration={tts.duration}
        measuredFraction={tts.bufferedFraction}
        hasTimeline
        repeating={tts.repeating}
        rate={tts.rate}
        voiceId={tts.voiceId}
        onTogglePlay={tts.togglePlay}
        onPrevSentence={tts.prevSentence}
        onNextSentence={tts.nextSentence}
        onToggleRepeat={tts.toggleRepeat}
        onSeek={tts.seek}
        onRateChange={tts.setRate}
        onVoiceChange={tts.setVoice}
      />

      {/* 写 / 编辑笔记对话框（划词写笔记 / 笔记锚点气泡 / 标注条「编辑」唤起）：activeNoteId 驱动开合。 */}
      <NoteDialog
        annotation={activeNote}
        page={activeNote ? pageOfCfi(activeNote.cfi) : null}
        onSave={updateNote}
        onRemove={removeAnnotationById}
        onClose={() => setActiveNoteId(null)}
      />

      {/* 全局设置弹窗（顶栏「设置」唤起，直接定位「阅读」分区）：阅读器在 AppShell 之外，
          故复用同一个组件在此挂一份实例——改字号/字体族即时重排，就在弹窗后面看得见。 */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} initialSection="reading" />
    </div>
  )
}

/**
 * 开书前的兜底屏：取行中 / 取行出错 / 书不在书架（无行或墓碑）。文件缺失的兜底在 FoliateView 的错误态里。
 * 「取数失败」与「没这本书」必须分开说：把 DB/IPC 异常也讲成「已被删除」，是让用户去删书重导一本
 * 其实还在的书。
 */
function ReaderFallback({
  loading,
  error,
  onBackToShelf,
}: {
  loading: boolean
  error: unknown
  onBackToShelf: () => void
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-page-bg">
      {loading ? (
        <span className="text-sm text-text-muted">正在打开书…</span>
      ) : (
        <>
          <p className="text-sm font-medium text-text-primary">
            {error ? '书籍加载失败' : '这本书不在书架里'}
          </p>
          <p className="max-w-md text-center text-xs text-text-muted">
            {error ? (error instanceof Error ? error.message : String(error)) : '它可能已经被删除了。'}
          </p>
          <Button variant="secondary" size="sm" onClick={onBackToShelf}>
            返回书架
          </Button>
        </>
      )}
    </div>
  )
}
