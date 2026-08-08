/**
 * 朗读 demo 的阅读器外壳 —— 顶栏（书名 / 章节）+ 正文槽位，纯 CDS。
 * 只负责把播放器放进「像真阅读页」的环境里看效果，不含任何朗读逻辑。
 */
import { cn } from '@/lib/cn'
import { SAMPLE_BOOK, SAMPLE_CHAPTER } from './sampleChapter'

export function ReaderFrame({
  children,
  note,
  className,
}: {
  children: React.ReactNode
  /** 顶栏右侧的槽位：一句说明，或 demo 自己的调参控件。 */
  note: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('relative flex h-[calc(100vh-3.25rem)] flex-col bg-page-bg', className)}>
      <header className="flex shrink-0 items-baseline gap-3 px-10 pt-6 pb-2">
        <h1 className="text-sm font-medium text-text-primary">{SAMPLE_BOOK}</h1>
        <span className="text-sm text-text-muted">{SAMPLE_CHAPTER}</span>
        <div className="ml-auto text-xs text-text-muted">{note}</div>
      </header>
      {children}
    </div>
  )
}
