import { useEffect, useMemo, useRef } from 'react'
import { Highlighter, PenLine, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { AnnotationRecord, CfiRange, TocNode } from '@/reading'
import { useAnnotations } from '../annotationStore'
import { ChapterGroupList } from './ChapterGroupList'
import { RowAction } from '../components/RowAction'
import { SidebarEmptyState } from './SidebarEmptyState'
import { groupByChapter } from './grouping'
import { formatDay, highlightTextClass, itemsInRange, pageLabel, snippet } from '../util'

/**
 * 左侧栏「标注」页签 —— 当前书**全部高亮**的导航视图。按章分组、组内按位置排；每条把原文
 * 按其色+线型（填充/下划线/波浪）画出来，带笔记的显笔记预览，末行显页码 · 日期（页码由 cfi 对当前
 * 分页表现算，不落库）；**落在当前屏可见范围内**的标注标「当前」（判定见 `util.itemsInRange`，与书签列表
 * 同一套；同屏几条就全亮，屏上没有标注时整列无高亮）。
 * 点条目跳回原文（`onNavigate`）；悬停浮出编辑（弹笔记对话框 `onEdit`）/ 删除（`onRemove`，连高亮一起删）。
 * 数据来自共享 [annotationStore](./annotationStore.ts)（库驱动）——划词新高亮会即时进这个列表。
 */

export interface AnnotationListProps {
  /** 当前书的目录树：每条标注按 cfi 现算所属章（不存章名，见 grouping.ts）。 */
  toc: TocNode[]
  /** 当前屏可见范围 [start, end)（引擎 relocate 的区间 CFI 端点）；null=引擎还没抛过位置则不高亮任何条目。 */
  visibleRange: CfiRange | null
  /** cfi → 当前排版下的页号（分页表现算，null=未就绪/解析不到则不显页码）。 */
  pageOfCfi: (cfi: string) => number | null
  /** 点条目：跳回该高亮原文。 */
  onNavigate: (a: AnnotationRecord) => void
  /** 悬停「编辑」：弹出笔记对话框写这条。 */
  onEdit: (id: string) => void
  /** 悬停「删除」：删这条标注（连正文高亮一起）。 */
  onRemove: (id: string) => void
}

export function AnnotationList({
  toc,
  visibleRange,
  pageOfCfi,
  onNavigate,
  onEdit,
  onRemove,
}: AnnotationListProps): React.JSX.Element {
  const annotations = useAnnotations()
  const groups = useMemo(() => groupByChapter(annotations, toc), [annotations, toc])
  // 本屏标注（同屏多条则全亮）。每条要解析一次 CFI（vendor compare 两侧都 parse），几十条标注就是
  // 几百微秒——而 Reader 因顶栏显隐 / 划词浮层等与位置无关的原因也会重渲本组件，故按可见范围端点 memo。
  const onPage = useMemo(
    () => new Set(itemsInRange(annotations, visibleRange).map((a) => a.id)),
    [annotations, visibleRange],
  )
  // 自动滚到本屏的第一条（没有则不滚）。
  const currentId = annotations.find((a) => onPage.has(a.id))?.id ?? null

  // 切到本页签 / 当前条变化时，把「当前」条滚进视野中部。
  const currentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' })
  }, [currentId])

  if (annotations.length === 0) {
    return <SidebarEmptyState icon={<Highlighter className="size-6" />} title="还没有标注" />
  }

  return (
    <ChapterGroupList
      groups={groups}
      renderItem={(a) => (
        <AnnotationRow
          key={a.id}
          annotation={a}
          page={pageOfCfi(a.cfi)}
          current={onPage.has(a.id)}
          rowRef={a.id === currentId ? currentRef : undefined}
          onNavigate={() => onNavigate(a)}
          onEdit={() => onEdit(a.id)}
          onRemove={() => onRemove(a.id)}
        />
      )}
    />
  )
}

/** 一条标注卡：笔记预览（有则）+ 按色/线型画出的原文 + 页码 · 日期；悬停浮出编辑/删除；当前条高亮。 */
function AnnotationRow({
  annotation,
  page,
  current,
  rowRef,
  onNavigate,
  onEdit,
  onRemove,
}: {
  annotation: AnnotationRecord
  /** 现算页号（null=分页表未就绪则不显）。 */
  page: number | null
  current: boolean
  rowRef?: React.Ref<HTMLDivElement>
  onNavigate: () => void
  onEdit: () => void
  onRemove: () => void
}): React.JSX.Element {
  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onNavigate()
        }
      }}
      className={cn(
        'group cursor-pointer rounded-lg p-2 transition-colors',
        current ? 'bg-bg-400' : 'hover:bg-bg-300',
      )}
    >
      {annotation.note && (
        <p className="mb-1 line-clamp-2 text-[13px] leading-relaxed text-text-secondary">{annotation.note}</p>
      )}
      <p className="line-clamp-3 text-[13px] leading-snug">
        <span className={highlightTextClass(annotation.color, annotation.style)}>
          {snippet(annotation.text, 120)}
        </span>
      </p>
      <div className="mt-1.5 flex h-5 items-center justify-between">
        <span className="text-[11px] tabular-nums text-text-muted">
          {[pageLabel(page), formatDay(annotation.createdAt)]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <RowAction label="编辑笔记" onClick={onEdit}>
            <PenLine className="size-3.5" />
          </RowAction>
          <RowAction label="删除标注" danger onClick={onRemove}>
            <Trash2 className="size-3.5" />
          </RowAction>
        </div>
      </div>
    </div>
  )
}
