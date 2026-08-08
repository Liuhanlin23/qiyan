import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { WifiOff } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, Card } from '@/components/ui'
import { TopBar } from '@/components/layout/TopBar'
import { BookCover } from '@/components/common/BookCover'
import { useAsyncData } from '@/hooks/useAsyncData'
import * as wordbook from '@/wordbook'
import type { OfficialBook } from '@/wordbook'

/**
 * 词书目录（路由 /wordbook/books）：官方词书按分类树（两级）在线浏览——不落本地库
 * （cache/wordbook.md「不缓存」拍板）。书卡展示封面/标题/简介/共 N 词（wordCount）；点书进选词页。
 * 目录页只展示 N，「已入库 X」在选词页内精确判定。离线/请求失败整页「需要联网」空态（best-effort 降级）。
 */

export default function WordBooks(): React.JSX.Element {
  const navigate = useNavigate()
  const cats = useAsyncData(() => wordbook.fetchCategories(), [])

  const [topId, setTopId] = useState<number | null>(null) // null = 全部
  const [subId, setSubId] = useState<number | null>(null)

  const categories = cats.data ?? []
  const top = categories.find((c) => c.id === topId) ?? null
  const children = top?.children ?? []
  const effectiveCategoryId = subId ?? topId ?? undefined

  const books = useAsyncData(() => wordbook.fetchOfficialBooks(effectiveCategoryId), [effectiveCategoryId])

  // 分类树拉取失败（离线）→ 整页「需要联网」。
  if (cats.error) return <OfflinePage onRetry={() => void cats.reload()} />

  return (
    <div className="flex h-full flex-col">
      <TopBar segments={['单词本', '选词']} backTo="/wordbook" />

      {/* 分类筛选 —— 一级恒显、二级在有子级时展开，同处一条描边工具条内，与下方书网格左对齐（px-6） */}
      <div className="shrink-0 px-6 pt-4">
        {/* 一级分类 */}
        <div className="flex flex-wrap items-center gap-2">
          <Chip active={topId === null} onClick={() => { setTopId(null); setSubId(null) }}>
            全部
          </Chip>
          {categories.map((c) => (
            <Chip key={c.id} active={topId === c.id} onClick={() => { setTopId(c.id); setSubId(null) }}>
              {c.title}
            </Chip>
          ))}
        </div>

        {/* 二级分类（选中的一级有子级时） */}
        {children.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border-100 pt-2.5">
            <Chip active={subId === null} onClick={() => setSubId(null)} size="sm">
              全部
            </Chip>
            {children.map((c) => (
              <Chip key={c.id} active={subId === c.id} onClick={() => setSubId(c.id)} size="sm">
                {c.title}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
        <BookGrid
          books={books.data ?? []}
          loading={books.loading}
          error={books.error != null}
          onOpen={(b) => navigate(`/wordbook/books/${b.id}`, { state: { title: b.title } })}
        />
      </main>
    </div>
  )
}

function BookGrid({
  books,
  loading,
  error,
  onOpen,
}: {
  books: OfficialBook[]
  loading: boolean
  error: boolean
  onOpen: (b: OfficialBook) => void
}): React.JSX.Element {
  if (error) {
    return <p className="pt-16 text-center text-sm text-text-muted">当前分类加载失败，请检查网络后重试。</p>
  }
  if (loading && books.length === 0) {
    return <p className="pt-16 text-center text-sm text-text-muted">加载中…</p>
  }
  if (books.length === 0) {
    return <p className="pt-16 text-center text-sm text-text-muted">该分类下暂无词书。</p>
  }
  return (
    <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))]">
      {books.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onOpen(b)}
          className="btn-squish group flex items-center gap-4 rounded-card bg-surface-1 p-4 text-left shadow-card-ring transition-colors hover:bg-bg-200"
        >
          <BookCover title={b.title} size="md" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-text-primary">{b.title}</h3>
            {b.description && <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{b.description}</p>}
            <p className="mt-1.5 text-xs text-text-muted tabular-nums">共 {b.wordCount.toLocaleString()} 词</p>
          </div>
        </button>
      ))}
    </div>
  )
}

function Chip({
  active,
  onClick,
  size = 'md',
  children,
}: {
  active: boolean
  onClick: () => void
  size?: 'md' | 'sm'
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'btn-squish shrink-0 rounded-full font-medium transition-colors',
        size === 'sm' ? 'px-3 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
        active ? 'bg-fill-primary text-on-primary' : 'bg-bg-neutral-chip text-text-secondary hover:bg-bg-300'
      )}
    >
      {children}
    </button>
  )
}

function OfflinePage({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <TopBar segments={['单词本', '选词']} backTo="/wordbook" />
      <div className="grid flex-1 place-items-center px-6">
        <Card className="flex max-w-md flex-col items-center gap-3 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-card bg-bg-neutral text-text-muted">
            <WifiOff className="size-7" />
          </span>
          <h3 className="text-xl font-medium text-text-primary">需要联网</h3>
          <Button variant="secondary" onClick={onRetry}>
            重试
          </Button>
        </Card>
      </div>
    </div>
  )
}
