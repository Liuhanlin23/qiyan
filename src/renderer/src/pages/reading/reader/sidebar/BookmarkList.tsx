import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark as BookmarkIcon, BookmarkPlus, Check, Pencil, Trash2, X } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { BookmarkRecord, CfiRange, TocNode } from '@/reading'
import { useBookmarks } from '../annotationStore'
import { ChapterGroupList } from './ChapterGroupList'
import { RowAction } from '../components/RowAction'
import { SidebarEmptyState } from './SidebarEmptyState'
import { groupByChapter } from './grouping'
import { formatDay, itemsInRange, pageLabel } from '../util'

/**
 * 左侧栏「书签」页签 —— 当前书全部书签的导航视图。按章分组、组内按位置排；条目显示定位文字标题
 * + 页码 · 日期（页码由 cfi 对当前分页表现算，不落库）；**落在当前屏可见范围内**的书签标「当前」（判定见
 * `util.itemsInRange`，与顶栏书签键同一套；读者不在任何书签页上时整列无高亮）。点条目跳回该页
 * （`onNavigate`）；悬停浮出改名（就地编辑，`onRename`）/ 删除（`onRemove`）。
 * 空态给一枚「为本页加书签」按钮（`onAddBookmark`，等价于顶栏书签键）。
 */

export interface BookmarkListProps {
  /** 当前书的目录树：每条书签按 cfi 现算所属章（不存章名，见 grouping.ts）。 */
  toc: TocNode[]
  /** 当前屏可见范围 [start, end)（引擎 relocate 的区间 CFI 端点）；null=引擎还没抛过位置则不高亮任何条目。 */
  visibleRange: CfiRange | null
  /** cfi → 当前排版下的页号（分页表现算，null=未就绪/解析不到则不显页码）。 */
  pageOfCfi: (cfi: string) => number | null
  onNavigate: (b: BookmarkRecord) => void
  onRename: (id: string, title: string) => void
  onRemove: (id: string) => void
  /** 空态「为本页加书签」：在当前阅读点加一条书签。 */
  onAddBookmark: () => void
}

export function BookmarkList({
  toc,
  visibleRange,
  pageOfCfi,
  onNavigate,
  onRename,
  onRemove,
  onAddBookmark,
}: BookmarkListProps): React.JSX.Element {
  const bookmarks = useBookmarks()
  const groups = useMemo(() => groupByChapter(bookmarks, toc), [bookmarks, toc])
  // 本屏书签（同屏多条则全亮）。每条要解析一次 CFI（vendor compare 两侧都 parse），几十条书签就是
  // 几百微秒——而 Reader 因顶栏显隐 / 划词浮层等与位置无关的原因也会重渲本组件，故按可见范围端点 memo。
  const onPage = useMemo(
    () => new Set(itemsInRange(bookmarks, visibleRange).map((b) => b.id)),
    [bookmarks, visibleRange],
  )
  // 自动滚到本页的第一条（没有则不滚）。
  const currentId = bookmarks.find((b) => onPage.has(b.id))?.id ?? null

  const currentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' })
  }, [currentId])

  if (bookmarks.length === 0) {
    return (
      <SidebarEmptyState
        icon={<BookmarkIcon className="size-6" />}
        title="还没有书签"
        action={
          <Button variant="secondary" size="sm" onClick={onAddBookmark}>
            <BookmarkPlus className="size-4" />
            为本页加书签
          </Button>
        }
      />
    )
  }

  return (
    <ChapterGroupList
      groups={groups}
      renderItem={(b) => {
        return (
          <BookmarkRow
            key={b.id}
            bookmark={b}
            page={pageOfCfi(b.cfi)}
            current={onPage.has(b.id)}
            rowRef={b.id === currentId ? currentRef : undefined}
            onNavigate={() => onNavigate(b)}
            onRename={(title) => onRename(b.id, title)}
            onRemove={() => onRemove(b.id)}
          />
        )
      }}
    />
  )
}

/** 一条书签：图标 + 标题 + 页码 · 日期；悬停浮出改名/删除；点行跳转；改名进就地编辑。当前条高亮。 */
function BookmarkRow({
  bookmark,
  page,
  current,
  rowRef,
  onNavigate,
  onRename,
  onRemove,
}: {
  bookmark: BookmarkRecord
  /** 现算页号（null=分页表未就绪则不显）。 */
  page: number | null
  current: boolean
  rowRef?: React.Ref<HTMLDivElement>
  onNavigate: () => void
  onRename: (title: string) => void
  onRemove: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(bookmark.title)

  const beginEdit = (): void => {
    setDraft(bookmark.title)
    setEditing(true)
  }
  const save = (): void => {
    const next = draft.trim()
    if (next) onRename(next)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="rounded-lg bg-bg-300 p-2">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            else if (e.key === 'Escape') setEditing(false)
          }}
          className="h-8"
        />
        <div className="mt-1.5 flex justify-end gap-1">
          <Button variant="ghost" size="iconSm" aria-label="取消" onClick={() => setEditing(false)}>
            <X className="size-4" />
          </Button>
          <Button variant="ghost" size="iconSm" aria-label="保存" disabled={!draft.trim()} onClick={save}>
            <Check className="size-4" />
          </Button>
        </div>
      </div>
    )
  }

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
        'group flex cursor-pointer items-start gap-2 rounded-lg p-2 transition-colors',
        current ? 'bg-bg-400' : 'hover:bg-bg-300',
      )}
    >
      <BookmarkIcon className={cn('mt-0.5 size-4 shrink-0', current ? 'text-text-accent' : 'text-text-muted')} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13px] leading-snug text-text-secondary">{bookmark.title}</p>
        <span className="text-[11px] tabular-nums text-text-muted">
          {[pageLabel(page), formatDay(bookmark.createdAt)]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <RowAction label="改名" onClick={beginEdit}>
          <Pencil className="size-3.5" />
        </RowAction>
        <RowAction label="删除书签" danger onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </RowAction>
      </div>
    </div>
  )
}
