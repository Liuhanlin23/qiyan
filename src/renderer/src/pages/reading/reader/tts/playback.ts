/**
 * 播放器读数 —— 把「已播秒数 / 总时长」换成播放器要显示的量。
 * 单独抽出来是因为播放中它每帧都在算：所有夹取与除零兜底集中在这里，组件里不再写条件。
 */

export interface PlaybackLabels {
  /** 已播时刻，`m:ss` / `h:mm:ss`。 */
  elapsed: string
  /** 剩余时长，恒带负号前缀（播放器惯例：`-3:45`）。 */
  remaining: string
  /** 已播占比 0–100，直接当进度线宽度百分比用；**不取整**，否则低速时进度线会一格一格跳。 */
  percent: number
}

/** 把秒格式化成 `m:ss` / `h:mm:ss`（播放器时长展示用）。 */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return h > 0 ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`
}

/** 滑块值（0–100）换算成章内秒数，两端夹取。 */
export function percentToSeconds(percent: number, durationSec: number): number {
  const total = Math.max(0, durationSec)
  return Math.min(Math.max(0, (percent / 100) * total), total)
}

/**
 * 缓冲段（已合成、还没播到）占比 0–100。
 * 取 max 是硬约束：合成比例来自另一路估算，落后于播放头时若直接用，缓冲段会缩到播放头后面，
 * 看起来像「播过的又没缓冲」。
 */
export function bufferedPercent(playedPercent: number, measuredFraction: number): number {
  const measured = Math.min(Math.max(0, measuredFraction), 1) * 100
  return Math.max(playedPercent, measured)
}

export function playbackLabels(elapsedSec: number, durationSec: number): PlaybackLabels {
  const total = Math.max(0, durationSec)
  const played = Math.min(Math.max(0, elapsedSec), total)
  return {
    elapsed: formatClock(played),
    remaining: `-${formatClock(total - played)}`,
    percent: total > 0 ? (played / total) * 100 : 0,
  }
}

/** tts.md：倍速 0.5–3×，默认 1.0。0.05 步进让 0.75 / 1.25 / 1.75 这些常用档都落得上。 */
export const RATE_MIN = 0.5
export const RATE_MAX = 3
export const RATE_STEP = 0.05

/** `1×` / `1.25×` —— 去掉 `1.00×` 这种没意义的尾零。 */
export function formatRate(rate: number): string {
  return `${parseFloat(rate.toFixed(2))}×`
}

/** 播放器实际显示的那几个量（会话快照的子集，结构兼容即可传）。 */
export interface DisplayedPlayback {
  status: string
  sentenceIndex: number
  elapsed: number
  duration: number
  bufferedFraction: number
  repeating: boolean
  rate: number
}

/** 时刻的显示精度：0.1s。读数本身只到秒，进度线一帧才走千分之几像素。 */
const TIME_QUANTUM = 0.1
/** 缓冲段的显示精度：千分之一（约等于 1000px 宽进度条上的一个像素）。 */
const FRACTION_QUANTUM = 0.001

const sameAt = (a: number, b: number, quantum: number): boolean =>
  Math.round(a / quantum) === Math.round(b / quantum)

/**
 * 两帧快照在播放器上「看起来一样」吗 —— 会话的时间回调由 rAF 驱动（约 60Hz），
 * 但显示量远没那么细：不量化的话每帧都要重渲整棵播放器子树。无前一帧恒判不同（首帧必须进 UI）。
 */
export function sameDisplayedPlayback(
  prev: DisplayedPlayback | null,
  next: DisplayedPlayback,
): boolean {
  return (
    prev !== null &&
    prev.status === next.status &&
    prev.sentenceIndex === next.sentenceIndex &&
    prev.duration === next.duration &&
    prev.repeating === next.repeating &&
    prev.rate === next.rate &&
    sameAt(prev.elapsed, next.elapsed, TIME_QUANTUM) &&
    sameAt(prev.bufferedFraction, next.bufferedFraction, FRACTION_QUANTUM)
  )
}
