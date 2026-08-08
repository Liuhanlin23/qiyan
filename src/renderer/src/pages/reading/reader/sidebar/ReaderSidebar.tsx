import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Bookmark, BookOpen, ChevronRight, Highlighter, List } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { AnnotationRecord, BookmarkRecord, CfiRange, TocNode } from '@/reading'
import { AnnotationList } from './AnnotationList'
import { BookmarkList } from './BookmarkList'

/**
 * 阅读器左侧栏 —— 当前这本书的导航面板（不是换书入口）：目录 / 标注 / 书签三页签。
 * 目录页签走引擎 `getTOC`；标注 / 书签读共享 annotationStore（划词高亮即时进列表）。
 * 开合走顶栏侧栏键，隐藏式折叠（宽度动画在父层）。
 */

type Tab = 'toc' | 'annotations' | 'bookmarks'

export interface ReaderSidebarProps {
  className?: string
  /** 侧栏是否展开（用于「打开时自动定位到当前章」）。 */
  open: boolean
  /** 目录树（引擎 `getTOC()`）。 */
  toc: TocNode[]
  /** 当前所在章的 href（引擎 relocate 的 `tocItem.href`），用于高亮；null=未知。 */
  currentHref: string | null
  /** 读者当前页号（分页表现算）；null=分页表未就绪，则不显目录「当前位置」行。 */
  currentPage: number | null
  /** 当前屏可见范围 [start, end)（引擎 relocate 的区间 CFI 端点）：标注 / 书签「当前」判定共用；null=引擎还没抛过位置。 */
  visibleRange: CfiRange | null
  /** 全书比例 → 页号（分页表现算）：目录每章起始页取 `pageOfFraction(fractionStart)`。 */
  pageOfFraction: (fraction: number) => number | null
  /** cfi → 页号（分页表现算）：标注 / 书签条目上那句「p N」。 */
  pageOfCfi: (cfi: string) => number | null
  /** 点目录项跳转到该章。 */
  onNavigate: (href: string) => void
  /** 点「当前位置」行跳回当前阅读点。 */
  onNavigateToCurrent: () => void
  /** 标注：点条目跳回原文 / 悬停编辑（弹笔记对话框）/ 删除（连高亮）。 */
  onNavigateAnnotation: (a: AnnotationRecord) => void
  onEditAnnotation: (id: string) => void
  onRemoveAnnotation: (id: string) => void
  /** 书签：点条目跳转 / 改名 / 删除 / 空态加书签。 */
  onNavigateBookmark: (b: BookmarkRecord) => void
  onRenameBookmark: (id: string, title: string) => void
  onRemoveBookmark: (id: string) => void
  onAddBookmark: () => void
}

export function ReaderSidebar({
  className,
  open,
  toc,
  currentHref,
  currentPage,
  visibleRange,
  pageOfFraction,
  pageOfCfi,
  onNavigate,
  onNavigateToCurrent,
  onNavigateAnnotation,
  onEditAnnotation,
  onRemoveAnnotation,
  onNavigateBookmark,
  onRenameBookmark,
  onRemoveBookmark,
  onAddBookmark,
}: ReaderSidebarProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('toc')

  return (
    <aside className={cn('flex flex-col bg-page-bg', className)}>
      {/* 头部：三页签（开合走顶栏侧栏键，此处不再放收起叉号） */}
      <div className="flex h-12 shrink-0 items-center px-2">
        <ToggleGroup
          className="h-8 flex-1"
          value={tab}
          onValueChange={(v) => v && setTab(v as Tab)}
        >
          <ToggleGroupItem value="toc" className="flex-1 px-2" aria-label="目录">
            <List className="size-4" />
            <span className="text-xs">目录</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="annotations" className="flex-1 px-2" aria-label="标注">
            <Highlighter className="size-4" />
            <span className="text-xs">标注</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="bookmarks" className="flex-1 px-2" aria-label="书签">
            <Bookmark className="size-4" />
            <span className="text-xs">书签</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* 页签内容 */}
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'toc' ? (
          <TocTree
            open={open}
            toc={toc}
            currentHref={currentHref}
            currentPage={currentPage}
            pageOfFraction={pageOfFraction}
            onNavigate={onNavigate}
            onNavigateToCurrent={onNavigateToCurrent}
          />
        ) : tab === 'annotations' ? (
          <AnnotationList
            toc={toc}
            visibleRange={visibleRange}
            pageOfCfi={pageOfCfi}
            onNavigate={onNavigateAnnotation}
            onEdit={onEditAnnotation}
            onRemove={onRemoveAnnotation}
          />
        ) : (
          <BookmarkList
            toc={toc}
            visibleRange={visibleRange}
            pageOfCfi={pageOfCfi}
            onNavigate={onNavigateBookmark}
            onRename={onRenameBookmark}
            onRemove={onRemoveBookmark}
            onAddBookmark={onAddBookmark}
          />
        )}
      </div>
    </aside>
  )
}

// ── 目录树 ──────────────────────────────────────────────────────────────────

/** 扁平化后的一行：目录项，或注入在当前章下的「当前位置」行。`key` 是树中位置路径（稳定，与 href 无关）。 */
type Row =
  | { kind: 'item'; node: TocNode; depth: number; key: string; hasChildren: boolean; expanded: boolean }
  | { kind: 'current'; depth: number; key: string }

/** 按展开集把目录树摊平成一维行（深度优先）。key 用树中位置路径，稳定唯一。 */
function flatten(nodes: TocNode[], expanded: Set<string>, depth: number, prefix: string, out: Row[]): void {
  nodes.forEach((node, i) => {
    const key = prefix ? `${prefix}.${i}` : `${i}`
    const hasChildren = node.subitems.length > 0
    const isExpanded = expanded.has(key)
    out.push({ kind: 'item', node, depth, key, hasChildren, expanded: isExpanded })
    if (hasChildren && isExpanded) flatten(node.subitems, expanded, depth + 1, key, out)
  })
}

/** 找到 href 对应节点的 key 链（从根到该节点，末位是它自己）；找不到返回 null。 */
function pathToHref(nodes: TocNode[], href: string, prefix: string): string[] | null {
  for (let i = 0; i < nodes.length; i++) {
    const key = prefix ? `${prefix}.${i}` : `${i}`
    if (nodes[i].href === href) return [key]
    const sub = pathToHref(nodes[i].subitems, href, key)
    if (sub) return [key, ...sub]
  }
  return null
}

function TocTree({
  open,
  toc,
  currentHref,
  currentPage,
  pageOfFraction,
  onNavigate,
  onNavigateToCurrent,
}: {
  open: boolean
  toc: TocNode[]
  currentHref: string | null
  currentPage: number | null
  pageOfFraction: (fraction: number) => number | null
  onNavigate: (href: string) => void
  onNavigateToCurrent: () => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // 当前章的 key 链（含自身）；祖先链用于自动展开，末位 key 用作高亮/滚动目标。
  const currentPath = useMemo(
    () => (currentHref ? pathToHref(toc, currentHref, '') : null),
    [toc, currentHref],
  )

  // 「打开时/换章时自动定位」：把当前章的祖先链并入展开集（追加式，不动用户已有的展开/折叠）。
  useEffect(() => {
    if (!currentPath || currentPath.length <= 1) return
    const ancestors = currentPath.slice(0, -1)
    setExpanded((prev) => {
      if (ancestors.every((k) => prev.has(k))) return prev
      const next = new Set(prev)
      ancestors.forEach((k) => next.add(k))
      return next
    })
  }, [currentPath])

  // 摊平 + 在当前章下注入「当前位置」行（放在当前章之后，不影响其余项索引）。
  const rows = useMemo(() => {
    const flat: Row[] = []
    flatten(toc, expanded, 0, '', flat)
    const activeKey = currentPath?.at(-1)
    if (activeKey && currentPage != null) {
      const at = flat.findIndex((r) => r.kind === 'item' && r.key === activeKey)
      if (at >= 0) {
        const depth = (flat[at] as Extract<Row, { kind: 'item' }>).depth + 1
        flat.splice(at + 1, 0, { kind: 'current', depth, key: `${activeKey}::current` })
      }
    }
    return flat
  }, [toc, expanded, currentPath, currentPage])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 12,
    getItemKey: (index) => rows[index].key,
  })

  // 只在「打开侧栏 / 换章」时把当前章滚到视口中部——刻意不依赖 rows，否则用户展开无关章节会被拽回当前章。
  // 用 ref 读最新 rows，rAF 等自动展开把当前章行并入列表后再滚。
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const activeKey = currentPath?.at(-1)
  useEffect(() => {
    if (!open || !activeKey) return
    const raf = requestAnimationFrame(() => {
      const idx = rowsRef.current.findIndex((r) => r.kind === 'item' && r.key === activeKey)
      if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'center' })
    })
    return () => cancelAnimationFrame(raf)
  }, [open, activeKey, virtualizer])

  const toggle = (key: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (toc.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="text-xs leading-relaxed text-text-muted">这本书没有目录</p>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2" role="tree">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index]
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              {row.kind === 'current' ? (
                <CurrentRow depth={row.depth} page={currentPage} onClick={onNavigateToCurrent} />
              ) : (
                <TocRow
                  node={row.node}
                  depth={row.depth}
                  hasChildren={row.hasChildren}
                  expanded={row.expanded}
                  active={!!row.node.href && row.node.href === currentHref}
                  page={row.node.fractionStart == null ? null : pageOfFraction(row.node.fractionStart)}
                  onToggle={() => toggle(row.key)}
                  onNavigate={onNavigate}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 一个目录项行：缩进 + 展开箭头（有子项）+ 标题（截断）+ 起始页号（有则显）。当前章高亮。 */
function TocRow({
  node,
  depth,
  hasChildren,
  expanded,
  active,
  page,
  onToggle,
  onNavigate,
}: {
  node: TocNode
  depth: number
  hasChildren: boolean
  expanded: boolean
  active: boolean
  page: number | null
  onToggle: () => void
  onNavigate: (href: string) => void
}): React.JSX.Element {
  const clickable = !!node.href
  return (
    <div
      role="treeitem"
      aria-current={active ? 'true' : undefined}
      aria-expanded={hasChildren ? expanded : undefined}
      onClick={clickable ? () => onNavigate(node.href as string) : undefined}
      className={cn(
        'flex min-h-[34px] items-center gap-1 rounded-md py-1.5 pr-2 text-left transition-colors',
        clickable && 'cursor-pointer',
        active ? 'bg-bg-400 text-text-primary' : clickable && 'hover:bg-bg-300',
      )}
      style={{ paddingInlineStart: `${depth * 14 + 4}px` }}
      title={node.label}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={expanded ? '折叠' : '展开'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className="grid size-5 shrink-0 place-items-center rounded text-text-muted hover:text-text-primary"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
        </button>
      ) : (
        <span className="size-5 shrink-0" aria-hidden />
      )}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm',
          active ? 'font-medium text-text-primary' : 'text-text-secondary',
        )}
      >
        {node.label}
      </span>
      {page != null && (
        <span className="shrink-0 pl-1 text-xs tabular-nums text-text-muted">{page}</span>
      )}
    </div>
  )
}

/** 「当前位置」注入行：显示读者当前全书页号，点击跳回当前阅读点。 */
function CurrentRow({
  depth,
  page,
  onClick,
}: {
  depth: number
  page: number | null
  onClick: () => void
}): React.JSX.Element {
  return (
    <div
      role="treeitem"
      aria-current="true"
      onClick={onClick}
      className="flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-text-accent transition-colors hover:bg-bg-300"
      style={{ paddingInlineStart: `${depth * 14 + 4}px` }}
      title="当前位置"
    >
      <BookOpen className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">当前位置</span>
      {page != null && <span className="shrink-0 pl-1 text-xs tabular-nums">{page}</span>}
    </div>
  )
}
