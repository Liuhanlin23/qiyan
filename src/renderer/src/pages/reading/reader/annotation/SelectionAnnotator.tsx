import { useEffect, useRef, useState } from 'react'
import type {
  AnnotationRecord,
  EngineSelection,
  FoliateEngine,
  HandlePoint,
  HighlightColor,
  HighlightStyle,
  LookupTermVerdict,
} from '@/reading'
import { cleanLookupTerm, judgeLookupTerm } from '@/reading'
import { cn } from '@/lib/cn'
import { toast } from '@/lib/toast'
import { AnnotationPopup } from './AnnotationPopup'
import { TranslatorPopup } from './TranslatorPopup'
import { DictPopup } from './DictPopup'
import { WordDetailPopup } from './WordDetailPopup'
import { HIGHLIGHT_INK, OVERLAY_STYLE } from '../constants'
import type { TranslationProvider } from '../translation/providerMemory'
import { readHighlightMemory, storeHighlightMemory, type HighlightMemory } from './highlightMemory'
import { useViewportAnchor } from './useViewportAnchor'
import { relativeDay } from '../util'
import {
  createAnnotation,
  findAnnotationByCfi,
  getAnnotation,
  removeAnnotation,
  updateAnnotation,
  useAnnotations,
} from '../annotationStore'

/**
 * 真引擎上的划词与标注编排层 —— 把 foliate 的划词/命中事件桥到 `AnnotationPopup`，并用引擎的
 * overlayer 把高亮真正画到正文上。
 *
 * 职责：
 *  - 监听 `engine.onSelect`：有选区就在其下方浮出工具栏；选区清空即收浮层。浮层常开，只有
 *    点书里空白 / 翻页才收（不因点色板致 iframe 失焦而误关）。
 *  - 「高亮」两级交互：点一下即以会话记忆的线型+色落一条真 overlay；微调条切线型/换色就地重绘同一条；
 *    再点删除即移除。线型/色的会话级全局记忆存在本层。
 *  - 命中已有高亮（`engine.onAnnotationClick`）：不带笔记 → 进编辑态 **并在两端浮出可拖把手**，拖动即
 *    扩/缩高亮范围（readest range editor）；带笔记 → 显示笔记预览气泡，点「写笔记」在左侧栏标注页展开编辑器。
 *  - 复制走真剪贴板；写笔记 = 落一条高亮 + 在左侧栏标注页就地展开这条的笔记编辑器（`onOpenNote`）；查词/翻译/朗读/
 *    搜索按本篇边界只到「触发 + 反馈」。
 *
 * 标注数据落**本地库**：一条标注经共享的 [annotationStore](./annotationStore.ts) 写进 user_book_annotation，
 * 各面板从同一 store 读取。一条标注用**稳定 id**（UUID）作身份、CFI 作 overlay key：拖把手时 CFI 会变，
 * 稳定 id 让浮层不随之重挂、也让记录以 id 定位；位置语义一律走 cfi 现算（所属章、排序、「当前位置」判定、
 * 列表里那句「p N」）——落笔不带页码，页码是排版投影、不落库（db/05）。
 */

/**
 * 高亮原文摘录的入口上限。`text` 落 MySQL `TEXT`（物理上限 65535 字节），超限的行会被服务端守卫拒收
 * → 本地有、永不同步。它只是显示用摘录（列表本就走 snippet），故落笔时直接截断，不让用户攒出永不同步的数据。
 */
const HIGHLIGHT_TEXT_MAX_LEN = 2000
const clipText = (v: string): string => v.slice(0, HIGHLIGHT_TEXT_MAX_LEN)

/**
 * 浮层目标：跟随一次划词，或点中一条已有高亮进编辑态（按稳定 id 引用，浮层锚点在点击处）。
 * 锚点一律是「下沿 y + 该行高度 height」，浮层翻到上方时靠 height 让开被锚住的那行。
 */
type PopupTarget =
  | { kind: 'selection'; sel: EngineSelection }
  | { kind: 'edit'; id: string; x: number; y: number; height: number }

export interface SelectionAnnotatorProps {
  engine: FoliateEngine
  /** 写笔记 / 点笔记气泡时调用：打开左侧栏标注页并把这条标注就地展开笔记编辑器。 */
  onOpenNote?: (id: string) => void
  /** 划词浮层「朗读」：从选中处所在句往下读。 */
  onSpeakSelection?: () => void
  /** 编辑态浮层「朗读」：从该标注处往下读（无活选区，按 CFI 定位）。 */
  onSpeakCfi?: (cfi: string) => void
  /** 句子翻译引擎（设备级记忆，宿主持有；见 translation/providerMemory）。 */
  translationProvider: TranslationProvider
  /** 在翻译框里切了引擎：上抛给宿主写记忆，对照翻译的后续段落也随之改用新引擎。 */
  onTranslationProviderChange: (p: TranslationProvider) => void
}

export function SelectionAnnotator({
  engine,
  onOpenNote,
  onSpeakSelection,
  onSpeakCfi,
  translationProvider,
  onTranslationProviderChange,
}: SelectionAnnotatorProps): React.JSX.Element | null {
  // 全局记忆：默认线型 + 每种线型各自记住的上次用色，跨会话落 localStorage。
  // 惰性初始化：直接写 useRef(readHighlightMemory()) 会每次渲染都读一遍 localStorage + JSON.parse，
  // 结果除首帧外全被丢弃。`mem` 是本次渲染的读取入口（remember 会换掉 ref 里的对象）。
  const memRef = useRef<HighlightMemory | null>(null)
  const mem = (memRef.current ??= readHighlightMemory())

  const [target, setTarget] = useState<PopupTarget | null>(null)
  // 句子翻译框：点工具栏「翻译」后浮出的独立弹层（原文快照 + 锚点），与工具栏互斥显示。
  const [translateTarget, setTranslateTarget] = useState<{ text: string; x: number; y: number; height: number } | null>(null)
  // 查词精简卡：点工具栏「查词」后浮出的独立弹层（查询词快照 + 判定 + 锚点），与工具栏互斥显示。
  const [dictTarget, setDictTarget] = useState<{
    term: string
    verdict: Exclude<LookupTermVerdict, 'none'>
    x: number
    y: number
    height: number
  } | null>(null)
  // 完整词条浮窗：精简卡里点「查看完整词条」后浮出，居中不贴选区；关掉退回精简卡（故与精简卡并存）。
  const [fullTerm, setFullTerm] = useState<string | null>(null)
  const [noteBubble, setNoteBubble] = useState<{ id: string; x: number; y: number; height: number; note: string; createdAt: number } | null>(null)
  // 范围编辑：正在编辑的标注 id + 两端把手位置（窗口坐标）。null=当前无范围编辑。
  const [rangeEdit, setRangeEdit] = useState<{ id: string; start: HandlePoint; end: HandlePoint } | null>(null)

  const remember = (color: HighlightColor, style: HighlightStyle): void => {
    // 连改两次（换色再换线型）中间不一定重渲染，故取 ref 上的最新值而不是本次渲染的 mem。
    const cur = memRef.current ?? mem
    memRef.current = { style, colors: { ...cur.colors, [style]: color } }
    storeHighlightMemory(memRef.current)
  }
  // 落笔/重绘一条：同 CFI 会先移除旧 overlay 再画（引擎 addAnnotation 语义）。
  // 带笔记的高亮在末端同色画一枚笔记锚点（restyle 时锚点也随之更新色）。
  const paint = (rec: AnnotationRecord): void => {
    void engine.drawAnnotation({ value: rec.cfi, style: OVERLAY_STYLE[rec.style], color: HIGHLIGHT_INK[rec.color] })
    if (rec.note.trim()) void engine.drawNote(rec.cfi, HIGHLIGHT_INK[rec.color])
  }
  // 收浮层：清状态 + 结束范围编辑 + 让引擎清掉原生选区。
  const close = (): void => {
    setTarget(null)
    setTranslateTarget(null)
    setDictTarget(null)
    setFullTerm(null)
    setNoteBubble(null)
    setRangeEdit(null)
    engine.endRangeEdit()
    engine.clearSelection()
  }
  // 点「翻译」：收起工具栏 / 把手，浮出独立翻译框（不 clearSelection，翻译基于选区文字快照）。
  const openTranslate = (text: string, x: number, y: number, height: number): void => {
    setTarget(null)
    setNoteBubble(null)
    setRangeEdit(null)
    setDictTarget(null)
    setFullTerm(null)
    engine.endRangeEdit()
    setTranslateTarget({ text, x, y, height })
  }
  // 点「查词」：收起工具栏 / 把手，浮出独立查词卡（同翻译，基于查询词快照，不 clearSelection）。
  const openLookup = (
    term: string,
    verdict: Exclude<LookupTermVerdict, 'none'>,
    x: number,
    y: number,
    height: number,
  ): void => {
    setTarget(null)
    setNoteBubble(null)
    setRangeEdit(null)
    setTranslateTarget(null)
    engine.endRangeEdit()
    setDictTarget({ term, verdict, x, y, height })
  }

  useEffect(() => {
    const offSelect = engine.onSelect((sel) => {
      // 任何选区变化都结束上一次范围编辑（离开某条高亮）、收掉翻译框 / 查词浮层。
      setNoteBubble(null)
      setRangeEdit(null)
      setTranslateTarget(null)
      setDictTarget(null)
      setFullTerm(null)
      engine.endRangeEdit()
      setTarget(sel ? { kind: 'selection', sel } : null)
    })
    const offClick = engine.onAnnotationClick((hit) => {
      const rec = findAnnotationByCfi(hit.value)
      if (!rec) return
      setTranslateTarget(null)
      setDictTarget(null)
      setFullTerm(null)
      if (hit.isNote) {
        // 点在笔记锚点上：弹笔记预览气泡（点气泡去笔记本）。
        setTarget(null)
        setRangeEdit(null)
        engine.endRangeEdit()
        setNoteBubble({ id: rec.id, x: hit.x, y: hit.y, height: hit.height, note: rec.note, createdAt: rec.createdAt })
      } else {
        // 点在高亮本体上：进编辑态 + 两端浮出可拖把手（无论有无笔记；笔记只在锚点上点开）。
        setNoteBubble(null)
        setTarget({ kind: 'edit', id: rec.id, x: hit.x, y: hit.y, height: hit.height })
        // 脏 CFI（同步拉来的坏行）解析不了 → 引擎返回 null：工具栏照常可用（改色 / 删除等），
        // 只是把手出不来，toast 讲清楚为什么不能调范围。
        const h = engine.beginRangeEdit(rec.cfi)
        if (!h) toast.warning('定位不到这条标注的范围，无法调整')
        setRangeEdit(h ? { id: rec.id, start: h.start, end: h.end } : null)
      }
    })
    return () => {
      offSelect()
      offClick()
    }
  }, [engine])

  // 宿主这一层的「收浮层」：点书页以外的地方（侧栏 / 顶底栏 / 笔记本）或按 Esc。
  // 书页 iframe 内的点击走引擎（只有它分得清点的是空白还是选区），而宿主这层此前根本没有出口——
  // 浮层会一直贴在正文上，点哪都不消失。浮层自身与把手带 data-annotation-layer 标记，不算「点外面」。
  const popupOpen = !!target || !!noteBubble || !!translateTarget || !!dictTarget || !!fullTerm
  useEffect(() => {
    if (!popupOpen) return
    // 浮层内部弹出的 Radix 模态（完整词条里的「移除学习」二次确认、笔记编辑框）挂在 body 直下的
    // Portal 里，不在浮层子树内。它开着时这一层必须让位：否则点它的确认 / 取消会被当成「点外面」、
    // 按 Esc 会连同整套浮层一起收掉——用户只是想关掉那个小弹窗。
    const modalOpen = (): boolean =>
      !!document.querySelector('[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]')
    // 浮层里的下拉（词卡的「简明 / 柯林斯」来源切换、「⋯更多操作」）同样走 Portal 挂在 body 直下，
    // DOM 上不在浮层子树里 —— 只认 data-annotation-layer 子树的话，点菜单项就成了「点外面」，浮层
    // 应声而收。Radix 的 popper 内容统一裹在 data-radix-popper-content-wrapper 里，认这个标记即可
    // 一次覆盖下拉 / Select / Popover / Tooltip 全家；反过来让共用词卡去贴本层的私有标记是反向依赖，
    // 且每新增一个下拉就会再漏一次。
    const inLayer = (el: EventTarget | null): boolean =>
      !!(el as Element | null)?.closest?.('[data-annotation-layer],[data-radix-popper-content-wrapper]')
    const onPointerDown = (e: PointerEvent): void => {
      if (inLayer(e.target)) return
      if (modalOpen()) return
      close()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !modalOpen()) close()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [popupOpen, engine])

  // 正在范围编辑的那条被删了（从侧栏 / 笔记本删的，本层收不到）→ 收把手并结束会话。
  // 不收就是两端把手继续挂在正文上，拖它等于往一条已删的记录上写。
  const annotations = useAnnotations()
  useEffect(() => {
    if (rangeEdit && !annotations.some((a) => a.id === rangeEdit.id)) {
      setRangeEdit(null)
      engine.endRangeEdit()
    }
  }, [annotations, rangeEdit, engine])

  // 拖动中的最新范围（尚未落库）：一次拖动有几十上百个 pointermove，每帧 updateAnnotation 就是
  // 每帧一趟串行 IPC 写 + 一次 store emit（侧栏整份重新 groupByChapter）。拖动只走引擎视觉，
  // 抬手才落一次库；拖动期间列表不跟着刷是预期。
  const pendingRangeRef = useRef<{ id: string; cfi: string; text: string } | null>(null)

  // 拖动某端把手：按当前标注的线型/色重绘范围，回填 CFI/文字与把手位置。
  const onHandleDrag = (edge: 'start' | 'end', clientX: number, clientY: number): void => {
    if (!rangeEdit) return
    const rec = getAnnotation(rangeEdit.id)
    if (!rec) return
    // 拖动中 store 里还是老 CFI，故上一帧画在哪要从 pending 取（否则第二帧起就擦不掉旧笔记锚点）。
    const oldCfi = pendingRangeRef.current?.cfi ?? rec.cfi
    const h = engine.dragRangeEdit(edge, clientX, clientY, OVERLAY_STYLE[rec.style], HIGHLIGHT_INK[rec.color])
    if (!h) return
    // CFI 变了且这条带笔记：把笔记锚点迁到新 CFI。
    if (rec.note.trim() && oldCfi !== h.value) {
      void engine.eraseNote(oldCfi)
      void engine.drawNote(h.value, HIGHLIGHT_INK[rec.color])
    }
    pendingRangeRef.current = { id: rec.id, cfi: h.value, text: clipText(h.text) }
    setRangeEdit((prev) => (prev ? { ...prev, start: h.start, end: h.end } : prev))
  }

  // 抬手：把这次拖动的最终范围落一次库。没拖动过（只是点了下把手）则什么也不做。
  const onHandleDragEnd = (): void => {
    const pending = pendingRangeRef.current
    pendingRangeRef.current = null
    if (pending) updateAnnotation(pending.id, { cfi: pending.cfi, text: pending.text })
  }

  return (
    <>
      {target?.kind === 'selection' &&
        (() => {
          const sel = target.sel
          const existing = findAnnotationByCfi(sel.cfi)
          // 取词判定：引擎已把清洗后的词随选区带来，这里只决定给不给「查词」入口。
          const verdict = judgeLookupTerm(sel.lookupTerm)
          return (
            <AnnotationPopup
              key={sel.cfi}
              anchor={{ x: sel.x, y: sel.y, height: sel.height }}
              existingHighlight={existing ? { id: existing.id, color: existing.color, style: existing.style } : undefined}
              initialStyle={mem.style}
              initialStyleColors={mem.colors}
              onHighlight={(color, style) => {
                remember(color, style)
                const cur = findAnnotationByCfi(sel.cfi)
                if (cur) {
                  updateAnnotation(cur.id, { color, style })
                  paint({ ...cur, color, style })
                  return cur.id
                }
                const rec = createAnnotation({
                  cfi: sel.cfi,
                  text: clipText(sel.text),
                  color,
                  style,
                  note: '',
                })
                paint(rec)
                return rec.id
              }}
              onRestyleHighlight={(id, color, style) => {
                remember(color, style)
                const rec = getAnnotation(id)
                if (rec) {
                  updateAnnotation(id, { color, style })
                  paint({ ...rec, color, style })
                }
              }}
              onRemoveHighlight={(id) => {
                const rec = getAnnotation(id)
                if (rec) {
                  void engine.eraseAnnotation(rec.cfi)
                  // 笔记锚点是与高亮分开的一层 overlay，得成对擦（对齐 Reader.removeAnnotationById）；
                  // 只擦高亮会在正文留下点不动的幽灵气泡，直到该章 overlay 重建才消失。纯高亮时是 no-op。
                  void engine.eraseNote(rec.cfi)
                }
                removeAnnotation(id)
              }}
              onTranslate={() => openTranslate(sel.text, sel.x, sel.y, sel.height)}
              // verdict='none'（清洗后取不出词）时不传 = 工具栏隐藏「查词」。
              onLookup={
                verdict === 'none'
                  ? undefined
                  : () => openLookup(sel.lookupTerm, verdict, sel.x, sel.y, sel.height)
              }
              onWriteNote={() => {
                const cur = findAnnotationByCfi(sel.cfi)
                const style = cur?.style ?? mem.style
                const color = cur?.color ?? mem.colors[style]
                // 已是高亮就沿用它（只统一色/线型），否则先落一条再开笔记本。
                const rec =
                  cur ??
                  createAnnotation({
                    cfi: sel.cfi,
                    text: clipText(sel.text),
                    color,
                    style,
                    note: '',
                  })
                if (cur) updateAnnotation(cur.id, { color, style })
                paint({ ...rec, color, style })
                close()
                onOpenNote?.(rec.id)
              }}
              onCopy={() => {
                void navigator.clipboard?.writeText(sel.text)
                toast.info('已复制到剪贴板')
                close()
              }}
              onSpeak={() => {
                // 先读选区再 close：close 可能连带清选区，顺序反了起点就丢了
                onSpeakSelection?.()
                close()
              }}
            />
          )
        })()}

      {target?.kind === 'edit' &&
        (() => {
          const rec = getAnnotation(target.id)
          if (!rec) return null
          // 编辑态没有活选区，查的是标注文字本身，清洗后即可查。
          const editTerm = cleanLookupTerm(rec.text)
          const editVerdict = judgeLookupTerm(editTerm)
          return (
            <AnnotationPopup
              key={`edit-${rec.id}`}
              anchor={{ x: target.x, y: target.y, height: target.height }}
              existingHighlight={{ id: rec.id, color: rec.color, style: rec.style }}
              // 编辑态也要带上各线型的记忆色，否则在这里切线型会退回出厂黄（与选区浮层的行为不一致）。
              initialStyle={rec.style}
              initialStyleColors={mem.colors}
              onHighlight={() => rec.id /* 已是高亮；编辑态删后即关，不在此重建 */}
              onRestyleHighlight={(id, color, style) => {
                remember(color, style)
                const r = getAnnotation(id)
                if (r) {
                  updateAnnotation(id, { color, style })
                  paint({ ...r, color, style })
                  // 轻推重渲染，让两端把手跟随新色（rangeEdit 未变，仅触发读新色）。
                  setRangeEdit((prev) => (prev ? { ...prev } : prev))
                }
              }}
              onRemoveHighlight={(id) => {
                const r = getAnnotation(id)
                if (r) {
                  void engine.eraseAnnotation(r.cfi)
                  void engine.eraseNote(r.cfi)
                }
                removeAnnotation(id)
                close()
              }}
              onTranslate={() => openTranslate(rec.text, target.x, target.y, target.height)}
              onLookup={
                editVerdict === 'none'
                  ? undefined
                  : () => openLookup(editTerm, editVerdict, target.x, target.y, target.height)
              }
              onWriteNote={() => {
                close()
                onOpenNote?.(rec.id)
              }}
              onCopy={() => {
                void navigator.clipboard?.writeText(rec.text)
                toast.info('已复制到剪贴板')
                close()
              }}
              onSpeak={() => {
                onSpeakCfi?.(rec.cfi)
                close()
              }}
            />
          )
        })()}

      {/* 范围编辑把手（两端可拖，扩/缩高亮）。把手取该高亮的墨色，与正文高亮一致。 */}
      {rangeEdit &&
        (() => {
          const ink = HIGHLIGHT_INK[getAnnotation(rangeEdit.id)?.color ?? 'yellow']
          return (
            <>
              <RangeHandle
                edge="start"
                pos={rangeEdit.start}
                color={ink}
                onDrag={onHandleDrag}
                onDragEnd={onHandleDragEnd}
              />
              <RangeHandle
                edge="end"
                pos={rangeEdit.end}
                color={ink}
                onDrag={onHandleDrag}
                onDragEnd={onHandleDragEnd}
              />
            </>
          )
        })()}

      {/* 笔记预览气泡（点笔记锚点弹出） */}
      {noteBubble && (
        <NoteBubble
          note={noteBubble.note}
          createdAt={noteBubble.createdAt}
          x={noteBubble.x}
          y={noteBubble.y}
          height={noteBubble.height}
          onOpen={() => {
            const id = noteBubble.id
            setNoteBubble(null)
            onOpenNote?.(id)
          }}
        />
      )}

      {/* 句子翻译框（点工具栏「翻译」浮出；text 作 key，换句即重挂重译） */}
      {translateTarget && (
        <TranslatorPopup
          key={translateTarget.text}
          text={translateTarget.text}
          x={translateTarget.x}
          y={translateTarget.y}
          height={translateTarget.height}
          provider={translationProvider}
          onProviderChange={onTranslationProviderChange}
        />
      )}

      {/* 查词精简卡（点工具栏「查词」浮出；term 作 key，换词即重挂重查）。
          未收录 / 太长时点「翻译这段」就地切到翻译框——查不到时用户要的本就是翻译。 */}
      {dictTarget && (
        <DictPopup
          key={dictTarget.term}
          term={dictTarget.term}
          verdict={dictTarget.verdict}
          x={dictTarget.x}
          y={dictTarget.y}
          height={dictTarget.height}
          onTranslate={() =>
            openTranslate(dictTarget.term, dictTarget.x, dictTarget.y, dictTarget.height)
          }
          onOpenFull={() => setFullTerm(dictTarget.term)}
          // 完整词条窗盖上来时藏起本卡（保持挂载，退回时不重查、不闪 loading）。
          hidden={!!fullTerm}
        />
      )}

      {/* 完整词条浮窗（精简卡里点「查看完整词条」浮出）：非模态、居中，关掉退回精简卡。 */}
      {fullTerm && <WordDetailPopup key={fullTerm} term={fullTerm} onClose={() => setFullTerm(null)} />}
    </>
  )
}

/** 笔记预览气泡 —— 显示笔记 + 相对时间；整体可点，点它在左侧栏标注页就地展开这条的编辑器。贴锚点浮出并夹进视口。 */
function NoteBubble({
  note,
  createdAt,
  x,
  y,
  height,
  onOpen,
}: {
  note: string
  createdAt: number
  x: number
  y: number
  /** 笔记锚点矩形高度：气泡翻到上方时据此让开锚点那行。 */
  height: number
  onOpen: () => void
}): React.JSX.Element {
  const { ref, left, top } = useViewportAnchor<HTMLButtonElement>(x, y, height)
  return (
    <button
      ref={ref}
      data-annotation-layer=""
      type="button"
      className="anim-pop btn-squish fixed z-50 block w-[260px] -translate-x-1/2 rounded-card bg-surface-3 p-3 text-left shadow-popover transition-colors hover:bg-surface-2"
      style={{ left, top }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onOpen}
    >
      <p className="text-[13px] leading-relaxed text-text-secondary">{note}</p>
      <p className="mt-1.5 text-[11px] text-text-muted">{relativeDay(createdAt)}</p>
    </button>
  )
}

/**
 * 范围编辑把手 —— 一条竖线光标 + 圆头，贴在高亮某端。start 圆头在上、end 圆头在下；
 * 按住拖动即把该端移到光标落点（父层据此重算高亮范围）。
 */
function RangeHandle({
  edge,
  pos,
  color,
  onDrag,
  onDragEnd,
}: {
  edge: 'start' | 'end'
  pos: HandlePoint
  /** 把手墨色（= 该高亮的 HIGHLIGHT_INK；画在书 iframe 外的宿主元素上，用字面色值与正文高亮对齐）。 */
  color: string
  onDrag: (edge: 'start' | 'end', clientX: number, clientY: number) => void
  /** 抬手：本次拖动结束（父层据此把最终范围落一次库）。 */
  onDragEnd: () => void
}): React.JSX.Element {
  const dragging = useRef(false)
  // 抬手与「指针被系统取消」走同一条收尾：范围只在收尾时落库，漏掉 cancel 就是这次拖动白拖。
  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    dragging.current = false
    onDragEnd()
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* 已释放 */
    }
  }
  return (
    <div
      // 按把手不算「点浮层外面」（否则一按下就把编辑态连同把手一起收掉，根本拖不动）。
      data-annotation-layer=""
      className="fixed z-50 flex -translate-x-1/2 cursor-ew-resize touch-none justify-center"
      style={{ left: pos.x, top: edge === 'start' ? pos.y : pos.y - pos.height, height: pos.height, width: 16 }}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        dragging.current = true
      }}
      onPointerMove={(e) => {
        if (dragging.current) onDrag(edge, e.clientX, e.clientY)
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* 竖线光标 */}
      <span className="block h-full w-0.5" style={{ backgroundColor: color }} />
      {/* 圆头：start 在上端、end 在下端 */}
      <span
        className={cn(
          'absolute left-1/2 size-3.5 -translate-x-1/2 rounded-full shadow-sm',
          edge === 'start' ? 'bottom-full' : 'top-full',
        )}
        style={{ backgroundColor: color }}
      />
    </div>
  )
}
