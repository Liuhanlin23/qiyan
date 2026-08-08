import { describe, expect, it } from 'vitest'
import {
  applyMeasuredDuration,
  buildTimeline,
  type CalibrationMap,
  estimateDuration,
  isSpeakable,
  PARAGRAPH_GAP,
  SENTENCE_GAP,
  sentenceIndexAtTime,
  totalDuration,
  updateCalibration,
} from './timeline'

const cal = (): CalibrationMap => new Map()
const item = (text: string, blockIndex: number) => ({ text, blockIndex })

/** 三句两块、每句恒 2 秒的基准轴；buildTimeline / applyMeasuredDuration 都是纯函数，可跨 describe 共用。 */
const tl = buildTimeline([item('One.', 0), item('Two.', 0), item('Three.', 1)], () => 2)

describe('isSpeakable', () => {
  it('含字母或数字即可朗读，纯符号分隔线不送合成', () => {
    expect(isSpeakable('Hello.')).toBe(true)
    expect(isSpeakable('第 3 章')).toBe(true)
    expect(isSpeakable('***')).toBe(false)
    expect(isSpeakable('— · —')).toBe(false)
  })
})

describe('estimateDuration', () => {
  it('无校准时英文按词数、中文按字数，极短句有 0.4s 下限', () => {
    const en = 'one two three four five six seven eight nine ten eleven twelve thirteen'
    expect(estimateDuration(en, 'v', cal())).toBeCloseTo(13 / 2.6, 5)
    expect(estimateDuration('今天天气很好今天天气很好', 'v', cal())).toBeCloseTo(12 / 4.5, 5)
    expect(estimateDuration('Go.', 'v', cal())).toBe(0.4)
  })

  it('校准累计达阈值（40 字）后按该音色实测速率', () => {
    const m = cal()
    updateCalibration(m, 'v', 'x'.repeat(50), 10) // 5 字/秒
    expect(estimateDuration('y'.repeat(20), 'v', m)).toBeCloseTo(20 / 5, 5)
  })

  it('校准不足阈值时仍用默认速率', () => {
    const m = cal()
    updateCalibration(m, 'v', 'x'.repeat(10), 2)
    expect(estimateDuration('one two', 'v', m)).toBeCloseTo(2 / 2.6, 5)
  })
})

describe('updateCalibration', () => {
  it('多次记账累计而非覆盖', () => {
    const m = cal()
    updateCalibration(m, 'v', 'x'.repeat(30), 6)
    updateCalibration(m, 'v', 'y'.repeat(30), 6)
    expect(m.get('v')).toEqual({ chars: 60, seconds: 12 })
  })

  it('非正时长或空文本不记账', () => {
    const m = cal()
    updateCalibration(m, 'v', 'abc', 0)
    updateCalibration(m, 'v', '   ', 3)
    expect(m.has('v')).toBe(false)
  })
})

describe('buildTimeline', () => {
  it('offset 链 = 前句 offset + duration + gap', () => {
    expect(tl.map((s) => s.offset)).toEqual([
      0,
      2 + SENTENCE_GAP,
      2 + SENTENCE_GAP + 2 + PARAGRAPH_GAP,
    ])
  })

  it('同块句间隙、跨块段间隙、末句 0', () => {
    expect(tl.map((s) => s.gap)).toEqual([SENTENCE_GAP, PARAGRAPH_GAP, 0])
  })

  it('初始一律未实测，index 顺排', () => {
    expect(tl.every((s) => !s.measured)).toBe(true)
    expect(tl.map((s) => s.index)).toEqual([0, 1, 2])
  })
})

describe('applyMeasuredDuration', () => {
  it('回填实测时长并重算后续 offset', () => {
    const next = applyMeasuredDuration(tl, 0, 3)
    expect(next[0]).toMatchObject({ duration: 3, measured: true })
    expect(next[1]!.offset).toBeCloseTo(3 + SENTENCE_GAP, 10)
    expect(next[2]!.offset).toBeCloseTo(3 + SENTENCE_GAP + 2 + PARAGRAPH_GAP, 10)
  })

  it('已实测的句不被再次覆盖', () => {
    const once = applyMeasuredDuration(tl, 0, 3)
    const twice = applyMeasuredDuration(once, 0, 9)
    expect(twice[0]!.duration).toBe(3)
  })

  it('非法时长（NaN / ≤0）原样返回同一引用', () => {
    expect(applyMeasuredDuration(tl, 1, Number.NaN)).toBe(tl)
    expect(applyMeasuredDuration(tl, 1, 0)).toBe(tl)
  })
})

describe('totalDuration / sentenceIndexAtTime', () => {
  it('总时长到末句读完为止', () => {
    const last = tl[tl.length - 1]!
    expect(totalDuration(tl)).toBeCloseTo(last.offset + last.duration, 10)
  })

  it('总时长不含末句 gap（手工构造 gap>0 的末句守住实现）', () => {
    const custom = [
      {
        index: 0,
        text: 'a',
        blockIndex: 0,
        offset: 0,
        duration: 2,
        measured: false,
        gap: 5,
      },
    ]
    expect(totalDuration(custom)).toBe(2)
  })

  it('间隙归前句、恰达句首即切换、越界取端点、空表 -1', () => {
    expect(sentenceIndexAtTime(tl, 0)).toBe(0)
    expect(sentenceIndexAtTime(tl, 2 + SENTENCE_GAP / 2)).toBe(0)
    expect(sentenceIndexAtTime(tl, tl[1]!.offset)).toBe(1)
    expect(sentenceIndexAtTime(tl, 999)).toBe(2)
    expect(sentenceIndexAtTime([], 1)).toBe(-1)
  })
})
