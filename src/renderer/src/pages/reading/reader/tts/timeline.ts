/**
 * 章内时间轴 —— 把引擎枚举出的句序列烘成一条「虚拟音频时间轴」（tts.md §进度与时长）。
 * 纯函数无 DOM。时长三层估算：实测（applyMeasuredDuration 回填）> 按音色字符速率校准
 *（updateCalibration 随播放累计）> 按文字系统默认速率。间隙固定值、按句/段区分（不开放调节）。
 */
import { isCjk, normalizeSynthText } from './align'

/** 固定句间隙 / 段间隙（秒，rate=1.0 域；播放时按倍速缩放）。 */
export const SENTENCE_GAP = 0.28
export const PARAGRAPH_GAP = 0.62

/** 默认朗读速率（Edge 神经语音常见值）：英文按词、中文按字。 */
const WORDS_PER_SECOND_EN = 2.6
const CHARS_PER_SECOND_ZH = 4.5
/** 极短句下限：合成音频至少有起播开销。 */
const MIN_SENTENCE_SEC = 0.4
/** 校准累计达到这么多字才信它（几句之内的样本波动太大）。 */
const CALIBRATION_MIN_CHARS = 40

/** 是否值得送 Edge 合成：纯符号分隔线（***、— · —）合成必失败，入会话前过滤掉。 */
export function isSpeakable(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

/** 一款音色的实测速率累计（chars/seconds 相除即字符速率）。 */
export interface VoiceCalibration {
  chars: number
  seconds: number
}

/** 音色 id → 校准累计。由 hook 持有、跨章会话存活（App 运行期内存态）。 */
export type CalibrationMap = Map<string, VoiceCalibration>

/** 一句实测完成后记账（累计而非覆盖，样本越多越稳）。非正时长 / 空文本不记。 */
export function updateCalibration(
  map: CalibrationMap,
  voiceId: string,
  text: string,
  measuredSec: number,
): void {
  if (!(measuredSec > 0)) return
  const chars = normalizeSynthText(text).length
  if (!chars) return
  const cur = map.get(voiceId) ?? { chars: 0, seconds: 0 }
  map.set(voiceId, { chars: cur.chars + chars, seconds: cur.seconds + measuredSec })
}

/** 不设下限的逐层估算：校准可信则按该音色实测速率，否则按文字系统默认（中文按字、英文按词）。 */
function rawDuration(t: string, cal: VoiceCalibration | undefined): number {
  if (cal && cal.chars >= CALIBRATION_MIN_CHARS && cal.seconds > 0) {
    return t.length / (cal.chars / cal.seconds)
  }
  if (isCjk(t)) {
    return t.replace(/\s/g, '').length / CHARS_PER_SECOND_ZH
  }
  return t.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND_EN
}

/** 估一句话读完要多久（秒，rate=1.0 域）。下限是「估算」这件事的属性，故只在这里夹一次。 */
export function estimateDuration(
  text: string,
  voiceId: string,
  calibration: CalibrationMap,
): number {
  const t = normalizeSynthText(text)
  return Math.max(MIN_SENTENCE_SEC, rawDuration(t, calibration.get(voiceId)))
}

/** 时间轴上的一句：offset 是句起点（秒），gap 是句尾到下一句起点的间隙（末句 0）。 */
export interface TimelineSentence {
  index: number
  text: string
  blockIndex: number
  offset: number
  duration: number
  /** 是否已用实测音频时长回填（回填后不再被覆盖）。 */
  measured: boolean
  gap: number
}

/** 烘时间轴的输入：一句的内容与归属，时间字段由 `buildTimeline` 填。 */
type TimelineItem = Pick<TimelineSentence, 'text' | 'blockIndex'>

/** 把句序列烘成时间轴：同块句间隙、跨块段间隙、末句无间隙。 */
export function buildTimeline(
  items: readonly TimelineItem[],
  estimate: (item: TimelineItem) => number,
): TimelineSentence[] {
  const out: TimelineSentence[] = []
  let at = 0
  items.forEach((it, i) => {
    const next = items[i + 1]
    const gap = next ? (next.blockIndex === it.blockIndex ? SENTENCE_GAP : PARAGRAPH_GAP) : 0
    const duration = estimate(it)
    out.push({
      index: i,
      text: it.text,
      blockIndex: it.blockIndex,
      offset: at,
      duration,
      measured: false,
      gap,
    })
    at += duration + gap
  })
  return out
}

/**
 * 用实测音频时长回填某句并重算后续 offset（tts.md：实测值随播放逐句回填修正）。
 * 已实测的句不覆盖；非法时长（NaN/≤0）原样返回同一引用（调用方免于无谓重渲）。
 *
 * 回填只影响这句起往后：前缀整段按引用留用，逐句回填才不会每次都换掉全表的对象身份。
 */
export function applyMeasuredDuration(
  timeline: readonly TimelineSentence[],
  index: number,
  seconds: number,
): readonly TimelineSentence[] {
  const target = timeline[index]
  if (!target || target.measured || !Number.isFinite(seconds) || seconds <= 0) return timeline
  const out = timeline.slice(0, index)
  let at = target.offset
  for (let i = index; i < timeline.length; i++) {
    const s = timeline[i]!
    const duration = i === index ? seconds : s.duration
    out.push({ ...s, duration, measured: s.measured || i === index, offset: at })
    at += duration + s.gap
  }
  return out
}

/** 整条时间轴总时长（到末句读完为止，不含末句后的间隙）。 */
export function totalDuration(timeline: readonly TimelineSentence[]): number {
  const last = timeline[timeline.length - 1]
  return last ? last.offset + last.duration : 0
}

/**
 * 章内时刻 → 句下标：二分取最后一个 `offset ≤ time` 的句。落在句尾间隙里算前一句
 *（间隙是这句的余韵，高亮不该提前跳走）；越界取端点；空表 -1。
 */
export function sentenceIndexAtTime(timeline: readonly TimelineSentence[], timeSec: number): number {
  if (!timeline.length) return -1
  let lo = 0
  let hi = timeline.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (timeline[mid]!.offset <= timeSec) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
