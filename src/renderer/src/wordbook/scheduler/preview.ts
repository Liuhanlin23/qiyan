// 评分按钮下次间隔预览（study.md「学习流程」）：ts-fsrs repeat() 取三档下次到期，按 anki 答题按钮时长规则
// 中文化（参照 anki rslib/scheduler/timespan.rs answer_button_time）。以 study.md「学习流程」间隔显示口径为准：
// <折叠前缀只用于分钟以下；秒/分/天取整，时/月/年保留 1 位小数。此处只产文案，不碰 UI。
import { previewDueDates, type RateGrade } from './fsrs'
import type { WordRecord } from '../types'
import { Rating } from 'ts-fsrs'

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const YEAR = 365 * DAY
const MONTH = YEAR / 12 // = 365/12 天，对齐 anki MONTH 常量

/** 1 位小数（四舍五入后固定一位，如 2 → "2.0"）。 */
function oneDecimal(x: number): string {
  return (Math.round(x * 10) / 10).toFixed(1)
}

/**
 * 间隔（ms）→ 中文时长文案（anki 答题按钮规则）：
 * <1分钟 / X分钟 / X.X小时 / X天 / X.X个月 / X.X年。
 */
export function formatInterval(ms: number): string {
  if (ms < MIN) return '<1分钟'
  if (ms < HOUR) return `${Math.round(ms / MIN)}分钟`
  if (ms < DAY) return `${oneDecimal(ms / HOUR)}小时`
  const days = ms / DAY
  if (days < 30) return `${Math.round(days)}天`
  if (days < 365) return `${oneDecimal(ms / MONTH)}个月`
  return `${oneDecimal(ms / YEAR)}年`
}

export interface IntervalPreview {
  again: string
  hard: string
  good: string
}

/** 三档下次间隔文案（state=0 走空卡、state=4 断言禁入，见 fsrs.previewDueDates）。 */
export function previewIntervals(word: WordRecord, now: number): IntervalPreview {
  const due = previewDueDates(word, now)
  const fmt = (g: RateGrade): string => formatInterval(due[g] - now)
  return {
    again: fmt(Rating.Again),
    hard: fmt(Rating.Hard),
    good: fmt(Rating.Good),
  }
}
