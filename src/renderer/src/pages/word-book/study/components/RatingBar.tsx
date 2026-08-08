import { cn } from '@/lib/cn'
import type { IntervalPreview } from '@/wordbook'

/**
 * 学习页底部三档评分条 —— 不认识 / 模糊 / 认识，仅揭晓后出现。
 * 各档上方的下次间隔为真实预览（study.md「学习流程」，ts-fsrs repeat 预演，格式对齐 Anki 答题按钮）——由页面传入 preview。
 */

export type RatingKey = 'again' | 'hard' | 'good'

const RATINGS: { key: RatingKey; label: string; dot: string }[] = [
  { key: 'again', label: '不认识', dot: 'bg-fill-danger' },
  { key: 'hard', label: '模糊', dot: 'bg-fill-warning' },
  { key: 'good', label: '认识', dot: 'bg-fill-success' },
]

export function RatingBar({
  onRate,
  preview,
  disabled = false,
}: {
  onRate: (key: RatingKey) => void
  preview: IntervalPreview
  /** 评分在途时禁用（防连点连跳卡）。 */
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="shrink-0 bg-bg-100">
      <div className="mx-auto flex max-w-2xl">
        {RATINGS.map((r) => (
          <button
            key={r.key}
            type="button"
            disabled={disabled}
            onClick={() => onRate(r.key)}
            className="btn-squish flex flex-1 flex-col items-center gap-1 py-4 disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="text-xs text-text-muted">{preview[r.key]}</span>
            <span className="text-base font-semibold text-text-primary">{r.label}</span>
            <span className={cn('h-[3px] w-5 rounded-full', r.dot)} />
          </button>
        ))}
      </div>
    </div>
  )
}
