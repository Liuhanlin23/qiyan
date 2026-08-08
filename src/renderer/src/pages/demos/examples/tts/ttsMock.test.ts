import { describe, expect, it } from 'vitest'
import {
  PARAGRAPH_GAP,
  SENTENCE_GAP,
  buildTimeline,
  estimateDuration,
  repeatClamp,
  sentenceIndexAtTime,
  splitSentences,
  syntheticBufferFraction,
  totalDuration,
} from './ttsMock'

describe('splitSentences', () => {
  it('按 .!? 切英文句，标点归前句', () => {
    expect(splitSentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?'])
  })

  it('句末引号 / 括号跟着前句走，不单独成句', () => {
    expect(splitSentences('He said "run away." Then he left.')).toEqual([
      'He said "run away."',
      'Then he left.',
    ])
  })

  it('切中文句号 / 问号 / 感叹号', () => {
    expect(splitSentences('今天很好。你呢？走吧！')).toEqual(['今天很好。', '你呢？', '走吧！'])
  })

  it('小数点不切句（后面不是空白）', () => {
    expect(splitSentences('It costs 3.5 dollars today.')).toEqual(['It costs 3.5 dollars today.'])
  })

  it('省略号与连续标点算一个句末', () => {
    expect(splitSentences('Wait... Now go.')).toEqual(['Wait...', 'Now go.'])
  })

  it('无句末标点的残尾也成句，不丢内容', () => {
    expect(splitSentences('First one. and a tail without period')).toEqual([
      'First one.',
      'and a tail without period',
    ])
  })

  it('折叠换行与多空格', () => {
    expect(splitSentences('  A\n\n  b   c.  ')).toEqual(['A b c.'])
  })

  it('空白段落产出空数组', () => {
    expect(splitSentences('   \n  ')).toEqual([])
  })

  // 已知限制：英文缩写点会被误判为句末（demo 正文回避缩写即可）。
  it('已知限制：Mr. 这类缩写会被切开', () => {
    expect(splitSentences('Mr. Smith left.')).toEqual(['Mr.', 'Smith left.'])
  })
})

describe('estimateDuration', () => {
  it('英文按词数：13 词约 5 秒', () => {
    const s = 'one two three four five six seven eight nine ten eleven twelve thirteen'
    expect(estimateDuration(s)).toBeCloseTo(13 / 2.6, 5)
  })

  it('中文按字数，且不计空白', () => {
    expect(estimateDuration('今天 天气 很好')).toBeCloseTo(6 / 4.5, 5)
  })

  it('极短句有 0.4 秒下限', () => {
    expect(estimateDuration('Go.')).toBe(0.4)
    expect(estimateDuration('好')).toBe(0.4)
    // 刚好越过下限的就不再被钳制。
    expect(estimateDuration('好。')).toBeCloseTo(2 / 4.5, 5)
  })
})

describe('buildTimeline', () => {
  const paras = ['One. Two.', 'Three.']
  const timeline = buildTimeline(paras)

  it('逐句展开所有段落', () => {
    expect(timeline.map((s) => s.text)).toEqual(['One.', 'Two.', 'Three.'])
    expect(timeline.map((s) => s.paraIndex)).toEqual([0, 0, 1])
  })

  it('id 稳定且带段 / 句序号', () => {
    expect(timeline.map((s) => s.id)).toEqual(['p0s0', 'p0s1', 'p1s0'])
  })

  it('句间用句间隙、段末用段间隙、章末无间隙', () => {
    expect(timeline[0]!.gap).toBe(SENTENCE_GAP)
    expect(timeline[1]!.gap).toBe(PARAGRAPH_GAP)
    expect(timeline[2]!.gap).toBe(0)
  })

  it('offset 首句为 0，其余等于前句 offset + duration + gap', () => {
    expect(timeline[0]!.offset).toBe(0)
    for (let i = 1; i < timeline.length; i++) {
      const prev = timeline[i - 1]!
      expect(timeline[i]!.offset).toBeCloseTo(prev.offset + prev.duration + prev.gap, 10)
    }
  })

  it('总时长到末句读完为止，不含末句后的间隙', () => {
    const last = timeline[timeline.length - 1]!
    expect(totalDuration(timeline)).toBeCloseTo(last.offset + last.duration, 10)
  })

  it('空输入产出空时间轴，总时长为 0', () => {
    expect(buildTimeline([])).toEqual([])
    expect(totalDuration([])).toBe(0)
  })
})

describe('sentenceIndexAtTime', () => {
  const timeline = buildTimeline(['One. Two.', 'Three.'])

  it('0 时刻落在首句', () => {
    expect(sentenceIndexAtTime(timeline, 0)).toBe(0)
  })

  it('恰好等于某句起点时命中该句', () => {
    expect(sentenceIndexAtTime(timeline, timeline[1]!.offset)).toBe(1)
    expect(sentenceIndexAtTime(timeline, timeline[2]!.offset)).toBe(2)
  })

  it('落在句尾间隙里仍算前一句（高亮不提前跳走）', () => {
    const s0 = timeline[0]!
    const inGap = s0.offset + s0.duration + s0.gap / 2
    expect(sentenceIndexAtTime(timeline, inGap)).toBe(0)
  })

  it('起点前一瞬仍属前一句', () => {
    expect(sentenceIndexAtTime(timeline, timeline[1]!.offset - 0.001)).toBe(0)
  })

  it('超出总时长落在末句', () => {
    expect(sentenceIndexAtTime(timeline, totalDuration(timeline) + 99)).toBe(2)
  })

  it('空时间轴返回 -1', () => {
    expect(sentenceIndexAtTime([], 1)).toBe(-1)
  })
})

describe('syntheticBufferFraction', () => {
  it('合成头 = 播放头 + 领先秒数，换算成 0–1 比例', () => {
    expect(syntheticBufferFraction(50, 200, 30)).toBeCloseTo(0.4, 6)
  })

  it('领先到章尾就封顶 1，不会顶出进度线', () => {
    expect(syntheticBufferFraction(190, 200, 30)).toBe(1)
  })

  it('时长为 0 时不除零', () => {
    expect(syntheticBufferFraction(0, 0, 30)).toBe(0)
  })

  it('已播为负（seek 中间态）时按 0 算', () => {
    expect(syntheticBufferFraction(-10, 200, 30)).toBeCloseTo(0.15, 6)
  })
})

describe('repeatClamp', () => {
  const sentence = { offset: 10, duration: 4 } as Parameters<typeof repeatClamp>[1]

  it('句子还没读完时原样放行', () => {
    expect(repeatClamp(12, sentence)).toBe(12)
  })

  it('读到句尾就弹回句首，开始下一遍', () => {
    expect(repeatClamp(14, sentence)).toBe(10)
  })

  it('一帧跨过整句（低帧率 / 高倍速）也只弹回句首，不越到下一句', () => {
    expect(repeatClamp(20, sentence)).toBe(10)
  })

  it('句尾按时长算、不含尾部间隙——复读不拖着那段静音', () => {
    const withGap = { offset: 10, duration: 4, gap: 3 } as Parameters<typeof repeatClamp>[1]
    expect(repeatClamp(14.5, withGap)).toBe(10)
  })

  it('时刻早于句首（刚 seek 过来）时不动它', () => {
    expect(repeatClamp(9, sentence)).toBe(9)
  })
})
