import { describe, expect, it } from 'vitest'
import {
  bufferedPercent,
  type DisplayedPlayback,
  formatClock,
  percentToSeconds,
  playbackLabels,
  sameDisplayedPlayback,
} from './playback'

describe('playbackLabels', () => {
  it('给出已播 / 剩余两个钟点串与百分比', () => {
    expect(playbackLabels(75, 300)).toEqual({ elapsed: '1:15', remaining: '-3:45', percent: 25 })
  })

  it('剩余始终带负号，哪怕只剩 0 秒', () => {
    expect(playbackLabels(300, 300).remaining).toBe('-0:00')
  })

  it('时长为 0 时不除零：百分比 0、两端都是 0:00', () => {
    expect(playbackLabels(0, 0)).toEqual({ elapsed: '0:00', remaining: '-0:00', percent: 0 })
  })

  it('已播超出时长时夹到末尾，不出现 100% 以上或正的剩余', () => {
    const labels = playbackLabels(400, 300)
    expect(labels.percent).toBe(100)
    expect(labels.elapsed).toBe('5:00')
    expect(labels.remaining).toBe('-0:00')
  })

  it('已播为负时夹到 0（seek 的中间态可能瞬时越界）', () => {
    expect(playbackLabels(-5, 300)).toEqual({ elapsed: '0:00', remaining: '-5:00', percent: 0 })
  })

  it('超过一小时的章节走 h:mm:ss', () => {
    expect(playbackLabels(3661, 7322).elapsed).toBe('1:01:01')
  })

  it('百分比不取整，进度线按亚像素推进不跳格', () => {
    expect(playbackLabels(1, 3).percent).toBeCloseTo(33.333, 3)
  })
})

describe('percentToSeconds', () => {
  it('把 0–100 的滑块值换成章内秒数', () => {
    expect(percentToSeconds(50, 300)).toBe(150)
  })

  it('两端夹取，滑到底不越界', () => {
    expect(percentToSeconds(-10, 300)).toBe(0)
    expect(percentToSeconds(140, 300)).toBe(300)
  })

  it('时长为 0 时恒为 0', () => {
    expect(percentToSeconds(50, 0)).toBe(0)
  })
})

describe('bufferedPercent', () => {
  it('合成领先播放时，缓冲段停在合成到的位置', () => {
    expect(bufferedPercent(20, 0.6)).toBe(60)
  })

  it('合成落后于播放时取播放头——缓冲段绝不缩到播放头后面', () => {
    expect(bufferedPercent(70, 0.4)).toBe(70)
  })

  it('比例越界时夹取：>1 封顶 100，负数当 0', () => {
    expect(bufferedPercent(30, 1.4)).toBe(100)
    expect(bufferedPercent(30, -0.2)).toBe(30)
  })

  it('还没开始播也没合成时是 0，不留一截幽灵缓冲', () => {
    expect(bufferedPercent(0, 0)).toBe(0)
  })
})

describe('formatClock', () => {
  it('不足一小时用 m:ss', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(600)).toBe('10:00')
  })

  it('超过一小时用 h:mm:ss，分钟补零', () => {
    expect(formatClock(3661)).toBe('1:01:01')
    expect(formatClock(7200)).toBe('2:00:00')
  })

  it('负数与小数收敛到合法时钟', () => {
    expect(formatClock(-5)).toBe('0:00')
    expect(formatClock(59.6)).toBe('1:00')
  })
})

describe('sameDisplayedPlayback', () => {
  const base: DisplayedPlayback = {
    status: 'playing',
    sentenceIndex: 3,
    elapsed: 12.34,
    duration: 600,
    bufferedFraction: 0.25,
    repeating: false,
    rate: 1,
  }

  it('没有前一帧时判为不同（首帧必须进 UI）', () => {
    expect(sameDisplayedPlayback(null, base)).toBe(false)
  })

  it('时刻只差毫秒：判为相同（rAF 每帧都在推进 elapsed）', () => {
    expect(sameDisplayedPlayback(base, { ...base, elapsed: 12.348 })).toBe(true)
  })

  it('时刻跨过 0.1s：判为不同', () => {
    expect(sameDisplayedPlayback(base, { ...base, elapsed: 12.44 })).toBe(false)
  })

  it('缓冲段微增不足千分之一：判为相同', () => {
    expect(sameDisplayedPlayback(base, { ...base, bufferedFraction: 0.2503 })).toBe(true)
  })

  it('缓冲段推进到下一格：判为不同', () => {
    expect(sameDisplayedPlayback(base, { ...base, bufferedFraction: 0.26 })).toBe(false)
  })

  it('播放态变化：判为不同', () => {
    expect(sameDisplayedPlayback(base, { ...base, status: 'paused' })).toBe(false)
  })

  it('当前句变化：判为不同（音色名跟着句语言走）', () => {
    expect(sameDisplayedPlayback(base, { ...base, sentenceIndex: 4 })).toBe(false)
  })

  it('总时长回填：判为不同', () => {
    expect(sameDisplayedPlayback(base, { ...base, duration: 640 })).toBe(false)
  })

  it('倍速变化：判为不同', () => {
    expect(sameDisplayedPlayback(base, { ...base, rate: 1.5 })).toBe(false)
  })

  it('复读态变化：判为不同', () => {
    expect(sameDisplayedPlayback(base, { ...base, repeating: true })).toBe(false)
  })
})
