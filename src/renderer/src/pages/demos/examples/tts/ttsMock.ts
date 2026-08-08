/**
 * 朗读 demo 的假时间轴 —— 把几段正文烘成一条「章内虚拟音频」，供播放器 demo 驱动句高亮与进度。
 *
 * 时长按 tts.md §进度与时长 的第三层兜底估算（按文字系统的默认速率）——demo 没有实测音频可回填。
 */
import { isCjk } from '../../../reading/reader/tts/align'

/** 朗读速率（原始 1.0× 音频）：英文按词、中文按字，取 Edge 神经语音的常见速度。 */
const WORDS_PER_SECOND_EN = 2.6
const CHARS_PER_SECOND_ZH = 4.5

/** 固定间隙（秒）—— tts.md 定的「不开放调节，用固定默认值」。 */
export const SENTENCE_GAP = 0.28
export const PARAGRAPH_GAP = 0.62

export interface MockSentence {
  /** 稳定 id（`p{段}s{句}`），高亮 key 与 layoutId 用。 */
  id: string
  /** 所属段落下标。 */
  paraIndex: number
  /** 句文本（已折叠空白）。 */
  text: string
  /** 句在章内时间轴上的起点（秒）。 */
  offset: number
  /** 句时长（秒，不含尾部间隙）。 */
  duration: number
  /** 句尾到下一句起点的间隙（秒）；末句为 0。 */
  gap: number
}

/**
 * 按句末标点切句：`.!?` 与 `。！？…` 及其后随的引号 / 括号一并归入前句，再吞掉后随空白。
 * 无句末标点的残尾（最后一句没写标点）也单独成句，不丢内容。
 *
 * 中西标点两套规则：ASCII `.!?` **必须**后随空白或串尾，否则 `3.5` 会被切成两句；
 * 全角 `。！？…` 后面本就不跟空格（中文不用空格分句），故不设此要求。
 * 已知限制：`Mr.` 这类英文缩写会被误判为句末 —— demo 正文回避即可，不为它引缩写词表。
 */
export function splitSentences(paragraph: string): string[] {
  const text = paragraph.replace(/\s+/g, ' ').trim()
  if (!text) return []
  const out: string[] = []
  // 句末标点 + 紧随的收尾符号（引号/括号）。
  const re = /(?:[.!?]+["'”’）)\]】》]*(?=\s|$)|[。！？…]+["'”’）)\]】》]*)/g
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length
    const piece = text.slice(cursor, end).trim()
    if (piece) out.push(piece)
    cursor = end
  }
  const tail = text.slice(cursor).trim()
  if (tail) out.push(tail)
  return out
}

/** 估一句话读完要多久（秒，1.0× 原始音频）。中文按字数、英文按词数。 */
export function estimateDuration(sentence: string): number {
  if (isCjk(sentence)) {
    const chars = sentence.replace(/\s/g, '').length
    return Math.max(0.4, chars / CHARS_PER_SECOND_ZH)
  }
  const words = sentence.split(/\s+/).filter(Boolean).length
  return Math.max(0.4, words / WORDS_PER_SECOND_EN)
}

/** 把段落数组烘成一条章内时间轴（句首尾相接，段间留更大间隙）。 */
export function buildTimeline(paragraphs: readonly string[]): MockSentence[] {
  const out: MockSentence[] = []
  let at = 0
  paragraphs.forEach((para, paraIndex) => {
    const sentences = splitSentences(para)
    sentences.forEach((text, sIndex) => {
      const duration = estimateDuration(text)
      const lastOfPara = sIndex === sentences.length - 1
      const lastOfChapter = lastOfPara && paraIndex === paragraphs.length - 1
      const gap = lastOfChapter ? 0 : lastOfPara ? PARAGRAPH_GAP : SENTENCE_GAP
      out.push({
        id: `p${paraIndex}s${sIndex}`,
        paraIndex,
        text,
        offset: at,
        duration,
        gap,
      })
      at += duration + gap
    })
  })
  return out
}

/** 整条时间轴的总时长（秒），含句 / 段间隙。 */
export function totalDuration(timeline: readonly MockSentence[]): number {
  const last = timeline[timeline.length - 1]
  return last ? last.offset + last.duration : 0
}

/**
 * 章内时刻 → 句下标。落在句尾间隙里算**仍属前一句**（间隙是这句的余韵，不该让高亮提前跳走）。
 * 早于首句返回 0，超出末句返回末句 —— demo 里时间轴不可能出界，兜底取端点而非 -1。
 */
export function sentenceIndexAtTime(timeline: readonly MockSentence[], timeSec: number): number {
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

/**
 * 句复读的时间钳制：读到当前句末尾就把时刻弹回句首。
 * 句尾按 `duration` 而非 `duration + gap` 算——复读一句时没必要把句间静音也重放一遍。
 */
export function repeatClamp(timeSec: number, sentence: MockSentence): number {
  const end = sentence.offset + sentence.duration
  return timeSec >= end ? sentence.offset : timeSec
}

/**
 * demo 专用：假会话没有真的合成队列，用「合成头恒领先播放头 leadSec 秒」伪造一个。
 * 真引擎接上来时换成它上报的已合成比例即可。
 */
export function syntheticBufferFraction(
  elapsedSec: number,
  durationSec: number,
  leadSec: number,
): number {
  if (durationSec <= 0) return 0
  return Math.min(1, (Math.max(0, elapsedSec) + leadSec) / durationSec)
}
