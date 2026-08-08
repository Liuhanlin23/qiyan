import { useNavigate } from 'react-router-dom'
import { ChevronLeft, CircleCheck, MoreHorizontal, SquarePen } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui'

/**
 * 学习页顶栏 —— 左上角返回 + 今日剩余三计数「新 N · 学 N · 复 N」（study.md「学习页顶栏」）+ 右侧动作（笔记 + 更多(⋯)）。
 * 语义「今天还剩」，当前卡所属类别下划线高亮（anki reviewer 同款）；三数全零 = 今日完成。
 * 「更多」下拉含 标记掌握（二次确认由页面弹）；练习页不放「移除学习」（词表/今日/查词词卡才有，避免学习中途误删）。
 */

export function PracticeTopBar({
  counts,
  current,
  onNote,
  onMaster,
}: {
  counts: { new: number; learning: number; review: number }
  current?: 'new' | 'learning' | 'review'
  onNote: () => void
  onMaster: () => void
}): React.JSX.Element {
  const navigate = useNavigate()
  return (
    <header className="flex shrink-0 items-center gap-3 px-6 py-3">
      <Button
        variant="ghost"
        size="iconSm"
        aria-label="返回"
        className="text-text-secondary"
        onClick={() => navigate('/wordbook')}
      >
        <ChevronLeft className="size-[18px]" />
      </Button>
      <div className="flex items-center gap-3 text-sm font-semibold text-text-primary">
        <span className={cn(current === 'new' && 'underline underline-offset-4')}>
          新 <span className="tabular-nums">{counts.new}</span>
        </span>
        <span className="text-text-muted">·</span>
        <span className={cn(current === 'learning' && 'underline underline-offset-4')}>
          学 <span className="tabular-nums">{counts.learning}</span>
        </span>
        <span className="text-text-muted">·</span>
        <span className={cn(current === 'review' && 'underline underline-offset-4')}>
          复 <span className="tabular-nums">{counts.review}</span>
        </span>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="iconSm" aria-label="笔记" className="text-text-secondary" onClick={onNote}>
          <SquarePen className="size-[18px]" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label="更多操作" title="更多" className="text-text-secondary">
              <MoreHorizontal className="size-[18px]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[9rem]">
            <DropdownMenuItem onSelect={onMaster}>
              <CircleCheck className="size-4" />
              标记掌握
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
