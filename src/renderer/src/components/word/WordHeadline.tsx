import { cn } from '@/lib/cn'

/**
 * 词卡标题行 —— 单词大字（点击朗读）+ 词性。
 * 抽自三页词卡词头：WordDetail(单词本右栏) / WordLookup(查词) / WordStudy(学习)。
 * 大字点击回调由父组件注入（WordCard 传 handleSpeak，走 CDN 真人音频）；不传则点击静默。
 *
 * 两档字号：`lg` 整页词卡（默认），`sm` 给贴选区的阅读精简卡——380px 浮层放整页字号会把释义挤下屏。
 *
 * partOfSpeech 可选：不提供则不渲染。
 */

/** 词头字号档：整页词卡 / 浮层精简卡。 */
const SIZES = {
  lg: 'font-serif text-4xl font-semibold text-text-primary sm:text-5xl',
  sm: 'font-serif text-2xl font-semibold text-text-primary',
} as const

interface WordHeadlineProps {
  word: string
  /** 词性（如 "n.", "v.", "adj."） */
  partOfSpeech?: string
  /** 点击单词时的回调（通常是朗读）；不提供则点击静默 */
  onWordClick?: () => void
  /** 字号档（additive，默认 'lg' 即既有行为） */
  size?: keyof typeof SIZES
  /**
   * 是否在单词按钮点击时 stopPropagation（additive，默认 false 即既有行为）。
   * 学习页把单词卡区包在「点击揭晓」容器里，单词点击需拦截冒泡以免误揭晓。
   */
  stopClickPropagation?: boolean
}

export function WordHeadline({
  word,
  partOfSpeech,
  onWordClick,
  size = 'lg',
  stopClickPropagation = false,
}: WordHeadlineProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        if (stopClickPropagation) e.stopPropagation()
        onWordClick?.()
      }}
      className="btn-squish self-start text-left"
      aria-label={`朗读 ${word}`}
    >
      <span className={cn('break-words', SIZES[size])}>{word}</span>
      {partOfSpeech && <span className="ml-2 font-serif text-sm italic text-text-muted">{partOfSpeech}</span>}
    </button>
  )
}
