import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Minus, Plus, Search, WifiOff } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Badge, Button, Card, Input, ToggleGroup, ToggleGroupItem, type BadgeProps } from '@/components/ui'
import { TopBar } from '@/components/layout/TopBar'
import { useAsyncData } from '@/hooks/useAsyncData'
import * as wordbook from '@/wordbook'
import type { WordSegment } from '@/wordbook'
import { toast } from '@/lib/toast'

/**
 * 选词（词书详情，新建，路由 /wordbook/books/:bookId，蓝本 pages/demos/WordbookPickWordsDemo）：
 * 全局词库模型下的加词主入口。进书在线拉整本词条（fetchBookEntries，内存持有、离开即弃）；
 * 「已加入」徽标 = 响应 dictId 集合经 getWordSegments 批量判定（分块 IN，不逐词点查）。
 * 三态筛选（全部/未加入/已加入，默认未加入）+ 前缀搜索 + 逐词勾选（shift 区间连选）+ 全选 +
 * sticky 行动栏「加入学习」→ addWords（建 state=0 行入流 + 自动补缺）。已入库词展示状态徽标、不可再选。
 * 离线/请求失败：整页「需要联网」。
 */

/** 词的全局归属态：none=未加入词库；其余=已加入且携带该词的四段状态。 */
type Member = 'none' | WordSegment
type Filter = 'all' | 'none' | 'joined'

/** 已加入的词按四段挂徽标，配色对齐首页分布/词表段。 */
const SEGMENT_BADGE: Record<WordSegment, { variant: BadgeProps['variant']; label: string }> = {
  new: { variant: 'neutral', label: '未学习' },
  memorizing: { variant: 'accent', label: '记忆中' },
  due: { variant: 'warning', label: '待复习' },
  mastered: { variant: 'success', label: '已标熟' },
}

function matchFilter(member: Member, f: Filter): boolean {
  if (f === 'all') return true
  if (f === 'none') return member === 'none'
  return member !== 'none'
}

export default function PickWords(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { bookId } = useParams()
  const id = Number(bookId)
  const title = (location.state as { title?: string } | null)?.title ?? '选词'

  const entriesState = useAsyncData(() => wordbook.fetchBookEntries(id), [id])
  const entries = useMemo(() => entriesState.data ?? [], [entriesState.data])
  const dictIds = useMemo(() => entries.map((e) => e.dictId), [entries])

  // 已加入判定：整本词条 dictId 批量查段（分块 IN）；加入后 reload 刷新徽标。
  const segState = useAsyncData(
    () => (dictIds.length ? wordbook.getWordSegments(dictIds) : Promise.resolve(new Map<number, WordSegment>())),
    [dictIds],
  )
  const segments = segState.data ?? new Map<number, WordSegment>()

  const [filter, setFilter] = useState<Filter>('none')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [joining, setJoining] = useState(false)
  const lastIndex = useRef<number | null>(null)
  // 筛选/搜索变化 → 可见行下标重排，shift 连选锚点作废，重置以免跨筛选态选错区间。
  useEffect(() => {
    lastIndex.current = null
  }, [filter, query])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries
      .map((e) => ({ dictId: e.dictId, term: e.term, member: (segments.get(e.dictId) ?? 'none') as Member }))
      .filter((w) => matchFilter(w.member, filter) && (q === '' || w.term.toLowerCase().startsWith(q)))
  }, [entries, segments, filter, query])

  // 滚动虚拟化会高频重渲染，这几个 O(n) 计算须 memo，否则每帧都要遍历整本词。
  const selectable = useMemo(() => visible.filter((w) => w.member === 'none'), [visible])
  const selectedVisible = useMemo(
    () => selectable.reduce((n, w) => (selected.has(w.dictId) ? n + 1 : n), 0),
    [selectable, selected],
  )
  const allState: 'off' | 'on' | 'partial' =
    selectedVisible === 0 ? 'off' : selectedVisible === selectable.length ? 'on' : 'partial'

  // 词表虚拟滚动：整本几千词只渲染视口内 ~30 行，全选时也只更新这些行的真实 DOM。
  const scrollRef = useRef<HTMLElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 12,
    paddingStart: 12,
    paddingEnd: 12,
    getItemKey: (index) => visible[index].dictId,
  })

  /** 勾选一行：仅未加入的词可选；shift + 上次点选处 → 区间统一置选/取消。 */
  function toggleAt(index: number, shift: boolean): void {
    const item = visible[index]
    if (!item || item.member !== 'none') return
    setSelected((prev) => {
      const next = new Set(prev)
      if (shift && lastIndex.current !== null) {
        const [a, b] = [lastIndex.current, index].sort((x, y) => x - y)
        const turnOn = !next.has(item.dictId)
        for (let i = a; i <= b; i++) {
          const w = visible[i]
          if (w?.member !== 'none') continue
          if (turnOn) next.add(w.dictId)
          else next.delete(w.dictId)
        }
      } else if (next.has(item.dictId)) {
        next.delete(item.dictId)
      } else {
        next.add(item.dictId)
      }
      return next
    })
    lastIndex.current = index
  }

  function toggleSelectAll(): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allState === 'on') selectable.forEach((w) => next.delete(w.dictId))
      else selectable.forEach((w) => next.add(w.dictId))
      return next
    })
  }

  /** 加入学习：addWords 建 state=0 行入流 + 自动补缺；刷新徽标、清空选择（停「未加入」段时加入项随即消失）。 */
  async function commit(): Promise<void> {
    if (selected.size === 0 || joining) return
    setJoining(true)
    try {
      await wordbook.addWords([...selected])
      setSelected(new Set())
      lastIndex.current = null
      await segState.reload()
    } catch {
      toast.error('加入失败，请稍后重试')
    } finally {
      setJoining(false)
    }
  }

  // 词条在线拉取失败（离线）→ 整页「需要联网」。
  if (entriesState.error) return <OfflinePage title={title} onRetry={() => void entriesState.reload()} />

  return (
    <div className="flex h-full flex-col">
      <TopBar segments={['单词本', '选词', title]} backTo="/wordbook/books" />

      {/* 筛选 + 搜索 */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-200 px-4">
        <ToggleGroup value={filter} onValueChange={(v) => v && setFilter(v as Filter)}>
          <ToggleGroupItem value="all">全部</ToggleGroupItem>
          <ToggleGroupItem value="none">未加入</ToggleGroupItem>
          <ToggleGroupItem value="joined">已加入</ToggleGroupItem>
        </ToggleGroup>
        <div className="relative ml-auto w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索单词"
            className="h-9 rounded-lg pl-9"
          />
        </div>
      </header>

      {/* 词数统计：常驻筛选栏下，不随词表滚动 */}
      <div className="flex shrink-0 items-center gap-2.5 px-5 pb-1 pt-3">
        <span className="h-4 w-[3px] rounded-full bg-fill-brand" />
        <span className="text-sm font-semibold tabular-nums text-text-primary">{visible.length} 词</span>
      </div>

      {/* 词表（虚拟滚动） */}
      <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2">
        {entriesState.loading && entries.length === 0 ? (
          <p className="px-3 pt-12 text-center text-sm text-text-muted">加载中…</p>
        ) : visible.length === 0 ? (
          <p className="px-3 pt-12 text-center text-sm text-text-muted">
            {filter === 'none' ? '这本书的词都加入词库了' : '没有匹配的单词'}
          </p>
        ) : (
          <ul className="relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const w = visible[vi.index]
              return (
                <li
                  key={vi.key}
                  data-index={vi.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute inset-x-0 top-0"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  <PickRow
                    term={w.term}
                    member={w.member}
                    checked={selected.has(w.dictId)}
                    onToggle={(shift) => toggleAt(vi.index, shift)}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {/* sticky 行动栏 */}
      <footer className="sticky bottom-0 z-10 flex shrink-0 items-center gap-4 bg-page-bg px-4 py-3">
        <button
          type="button"
          onClick={toggleSelectAll}
          disabled={selectable.length === 0}
          className="btn-squish group flex items-center gap-2 text-sm text-text-secondary disabled:opacity-40"
        >
          <PickBox state={allState} />
          全选未加入
        </button>
        <span className="ml-auto text-sm text-text-secondary">
          已选 <span className="font-semibold tabular-nums text-text-primary">{selected.size}</span> 词
        </span>
        <Button variant="brand" disabled={selected.size === 0} loading={joining} onClick={() => void commit()} className="gap-1.5">
          <Plus />
          加入学习
        </Button>
      </footer>
    </div>
  )
}

/** 单个词条行：未加入 = 可点勾选；已加入 = 不可点、挂状态徽标并淡化。 */
function PickRow({
  term,
  member,
  checked,
  onToggle,
}: {
  term: string
  member: Member
  checked: boolean
  onToggle: (shift: boolean) => void
}): React.JSX.Element {
  const owned = member !== 'none'
  const boxState: PickBoxState = owned ? 'owned' : checked ? 'on' : 'off'

  const inner = (
    <>
      <PickBox state={boxState} />
      <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', owned ? 'text-text-secondary' : 'text-text-primary')}>
        {term}
      </span>
      {owned && <Badge variant={SEGMENT_BADGE[member].variant}>{SEGMENT_BADGE[member].label}</Badge>}
    </>
  )

  if (owned) {
    return <div className="flex items-center gap-3 rounded-lg px-3 py-2">{inner}</div>
  }
  return (
    <button
      type="button"
      onClick={(e) => onToggle(e.shiftKey)}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-bg-300"
    >
      {inner}
    </button>
  )
}

type PickBoxState = 'off' | 'on' | 'partial' | 'owned'

/** 自绘勾选框：off 空框 / on 黑底勾 / partial 黑底横杠 / owned 灰底勾（已在库、不可再选）。 */
function PickBox({ state }: { state: PickBoxState }): React.JSX.Element {
  if (state === 'off') {
    return <span className="size-5 shrink-0 rounded-md border-2 border-border-300 transition-colors group-hover:border-border-400" />
  }
  if (state === 'owned') {
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-md bg-bg-400 text-text-muted">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    )
  }
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-md bg-fill-primary text-on-primary">
      {state === 'partial' ? <Minus className="size-3.5" strokeWidth={3} /> : <Check className="size-3.5" strokeWidth={3} />}
    </span>
  )
}

function OfflinePage({ title, onRetry }: { title: string; onRetry: () => void }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <TopBar segments={['单词本', '选词', title]} backTo="/wordbook/books" />
      <div className="grid flex-1 place-items-center px-6">
        <Card className="flex max-w-md flex-col items-center gap-3 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-card bg-bg-neutral text-text-muted">
            <WifiOff className="size-7" />
          </span>
          <div className="space-y-1">
            <h3 className="text-xl font-medium text-text-primary">需要联网</h3>
            <p className="text-sm text-text-secondary">词条为在线浏览，请连网后重试。</p>
          </div>
          <Button variant="secondary" onClick={onRetry}>
            重试
          </Button>
        </Card>
      </div>
    </div>
  )
}
