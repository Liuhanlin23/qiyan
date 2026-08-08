/**
 * 书封占位 —— 品牌底 + 书名首字。首版朗读播放器不接真实封面图（tts.md 无此项），先占位。
 * 尺寸/圆角由调用方经 className 给（不同版式的播放器封面大小不一样）。
 */
import { cn } from '@/lib/cn'

export function Cover({ book, className }: { book: string; className?: string }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-14 shrink-0 place-items-center rounded-md bg-fill-brand text-lg font-semibold text-on-brand',
        className,
      )}
    >
      {book.slice(0, 1)}
    </span>
  )
}
