import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, FileX, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Badge, Button, ConfirmDialog } from '@/components/ui'
import { BookCover } from '@/components/common/BookCover'
import { EmptyState } from '@/components/common/EmptyState'
import { TopBar } from '@/components/layout/TopBar'
import { useAsyncData } from '@/hooks/useAsyncData'
import { cn } from '@/lib/cn'
import { toast } from '@/lib/toast'
import * as reading from '@/reading'
import type { ShelfBook } from '@/reading'

/**
 * 书架首页（阅读 Tab 落地页）：一张自适应书封网格，数据来自本地 user_book 表（滤墓碑）。
 *
 * 「添加」→ 系统文件对话框选一本 EPUB → 按内容 hash 认身份 → 拷进 `books/<hash>/` → 解析元数据入库；
 * 同一本书重复导入按 hash 认出来，不会多出一行。点书进独立整屏阅读页 /reader/:bookHash，
 * 删除则连本机文件一起清掉（标注/进度保留，重导入即复活，见持久化设计 §3.3）。
 *
 * 排序「最近阅读」优先（读过的按最后阅读时间，没读过的退回加入序）；读过的书在标题右侧显百分比、
 * 书封 CTA 变「继续阅读」。封面图取导入时从书里抽出来的 `books/<hash>/cover.png`，没有则退回文字书封。
 *
 * 书文件本身不进同步（已拍板不做），别端导入的书在本机只有元数据：这类**幽灵书**（`hasFile === false`）
 * 在格子上标「文件不在本机」且不可点开，删除入口照常可用；不设专属导入入口——走正常「添加」
 * 选同一文件（hash 相同）即幂等转正（见 handleImport 的 exists 分支）。
 */

export default function Reading(): React.JSX.Element {
  const navigate = useNavigate()
  const shelf = useAsyncData(() => reading.listShelf(), [])
  const books = shelf.data ?? []
  const [importing, setImporting] = useState(false)
  // 待确认删除的书；null = 无确认框。
  const [pendingDelete, setPendingDelete] = useState<ShelfBook | null>(null)
  // 书名快照：对话框有退场动画，关闭瞬间 pendingDelete 已清空，直接读它会让描述里的书名闪成空。
  const pendingTitleRef = useRef('')
  if (pendingDelete) pendingTitleRef.current = pendingDelete.title

  const handleImport = async (): Promise<void> => {
    setImporting(true)
    try {
      const result = await reading.importBook()
      if (result.status === 'canceled') return
      if (result.status === 'exists') {
        // 也要 reload：域层的幂等拷贝会把「行在、文件被手删」的幽灵书文件补回来，
        // 不重算 hasFile 的话格子还压着暗、点不开。
        await shelf.reload()
        toast.info(`《${result.book.title}》已在书架`)
        return
      }
      await shelf.reload()
      toast.info(result.status === 'restored' ? `《${result.title}》已回到书架` : `已添加《${result.title}》`)
    } catch (e) {
      toast.error(`导入失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async (book: ShelfBook): Promise<void> => {
    try {
      await reading.deleteBook(book.bookHash)
    } catch (e) {
      toast.error(`删除失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      // 失败也要 reload：删除分两步（置墓碑 + 删文件目录），墓碑可能已经落成功、只是删文件炸了，
      // 不刷新书架就还挂着那本其实已经删掉的书。
      await shelf.reload()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar segments={['阅读']} />
      {/* 头部：添加自定义图书 */}
      <header className="shrink-0">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-8 pb-2 pt-6">
          <div className="flex items-baseline gap-2.5" />
          <Button
            variant="secondary"
            size="sm"
            className="!min-w-0"
            loading={importing}
            onClick={() => void handleImport()}
          >
            <Plus className="size-4" />
            添加
          </Button>
        </div>
      </header>

      {/* 书封网格 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-8 pb-12 pt-4">
          {/* 首次加载先不渲染，避免空态在有书时闪一下（本地库查询很快）。 */}
          {shelf.loading && !shelf.data ? null : shelf.error ? (
            // 取数失败必须与「书架真的空着」分开说：把 DB/IPC 异常渲染成「点添加放一本进来」，
            // 是在让用户以为自己的书没了。
            <EmptyState
              variant="detail"
              className="min-h-96"
              icon={<TriangleAlert className="size-6 text-text-muted" />}
              title="书架没能读出来"
              subtitle={shelf.error instanceof Error ? shelf.error.message : String(shelf.error)}
            >
              <Button variant="secondary" size="sm" onClick={() => void shelf.reload()}>
                重试
              </Button>
            </EmptyState>
          ) : books.length === 0 ? null : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-7">
              {books.map((book) => (
                <ShelfCell
                  key={book.bookHash}
                  book={book}
                  onOpen={() => navigate(`/reader/${book.bookHash}`)}
                  onRequestDelete={() => setPendingDelete(book)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="从书架删除这本书？"
        description={`《${pendingTitleRef.current}》的书文件会从本机删除，其它设备上也会一并移除。你的标注与阅读进度会保留，重新导入同一本书即可恢复。`}
        confirmText="删除"
        confirmVariant="danger"
        onConfirm={() => {
          if (pendingDelete) void handleDelete(pendingDelete)
        }}
      />
    </div>
  )
}

// ─────────────────────────── 单本书 cell ───────────────────────────

/**
 * 网格单元：书封 + 标题（读过的带百分比）+ 作者；整块可点，悬停书封上浮并露出 CTA，右上角露出删除键。
 * 幽灵书（文件不在本机）：书封压暗、不出 CTA、整块不可点，作者下面补一枚「文件不在本机」标签。
 */
function ShelfCell({
  book,
  onOpen,
  onRequestDelete,
}: {
  book: ShelfBook
  onOpen: () => void
  onRequestDelete: () => void
}): React.JSX.Element {
  // 进度只在读过之后才有（无进度行 = fraction 为 null）；向下取整，读了一点点也不显示 0% 之外的虚高。
  const percent = book.fraction == null ? null : Math.floor(book.fraction * 100)
  return (
    <div className="group relative flex flex-col gap-2.5">
      <button
        type="button"
        disabled={!book.hasFile}
        onClick={onOpen}
        className={cn('flex flex-col gap-2.5 text-left', book.hasFile && 'btn-squish')}
      >
        {/* 悬停整体上浮 + 加深投影，并从底部露出 clay CTA。 */}
        <BookCover
          title={book.title}
          src={book.coverUrl}
          size="fill"
          className={cn(
            'transition duration-200',
            book.hasFile ? 'group-hover:-translate-y-1 group-hover:shadow-lg' : 'opacity-50',
          )}
         
        />

        <div className="flex flex-col gap-1 px-0.5">
          <div className="flex items-start gap-1.5">
            <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug text-text-primary">
              {book.title}
            </h3>
            {percent != null && (
              <span className="mt-px shrink-0 text-xs font-semibold tabular-nums text-text-muted">{percent}%</span>
            )}
          </div>
          <span className="truncate text-xs text-text-muted">{book.author}</span>
          {!book.hasFile && (
            <Badge variant="neutral" className="w-fit" title="通过「添加」重新导入同一文件即可阅读">
              <FileX className="size-3" />
              文件不在本机
            </Badge>
          )}
        </div>
      </button>

      {/* 删除键：悬停/聚焦才现身，浮在书封右上角。独立于上面的整块按钮（按钮不能嵌按钮）。 */}
      <Button
        variant="ghost"
        size="iconXs"
        aria-label={`删除《${book.title}》`}
        onClick={onRequestDelete}
        className="absolute right-1.5 top-1.5 bg-surface-1 opacity-0 shadow-card-ring transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}
