import { describe, expect, it } from 'vitest'
import {
  MAX_TTS_LOCATIONS,
  sanitizeTtsLocations,
  sanitizeTtsRate,
  sanitizeTtsVoice,
  upsertTtsLocation,
} from './ttsMemory'
import { DEFAULT_VOICE } from './voices'

describe('sanitizeTtsRate', () => {
  it('夹取到 0.5–3，非数 / NaN 回默认 1', () => {
    expect(sanitizeTtsRate(1.5)).toBe(1.5)
    expect(sanitizeTtsRate(0.1)).toBe(0.5)
    expect(sanitizeTtsRate(99)).toBe(3)
    expect(sanitizeTtsRate('fast')).toBe(1)
    expect(sanitizeTtsRate(Number.NaN)).toBe(1)
  })
})

describe('sanitizeTtsVoice', () => {
  it('认目录内的音色 id，其余一律回默认', () => {
    expect(sanitizeTtsVoice('en-GB-RyanNeural')).toBe('en-GB-RyanNeural')
    expect(sanitizeTtsVoice('no-such')).toBe(DEFAULT_VOICE)
    // 旧版按语言存的 { en, zh } 对象、以及已下架的中文音色：都不认，回默认
    expect(sanitizeTtsVoice({ en: 'en-US-AvaNeural' })).toBe(DEFAULT_VOICE)
    expect(sanitizeTtsVoice('zh-CN-XiaoxiaoNeural')).toBe(DEFAULT_VOICE)
  })
})

describe('sanitizeTtsLocations', () => {
  it('丢弃坏形状条目并按 hash 去重（保先出现的）', () => {
    expect(
      sanitizeTtsLocations([
        { hash: 'a', cfi: 'epubcfi(/6/4!/1:0)' },
        { hash: 'a', cfi: 'epubcfi(/6/6!/1:0)' },
        { hash: '', cfi: 'x' },
        { hash: 'b' },
        'junk',
      ]),
    ).toEqual([{ hash: 'a', cfi: 'epubcfi(/6/4!/1:0)' }])
  })

  it('非数组回空', () => {
    expect(sanitizeTtsLocations({ a: 1 })).toEqual([])
  })
})

describe('upsertTtsLocation', () => {
  it('新条目置顶，同书旧条目去掉', () => {
    const next = upsertTtsLocation(
      [
        { hash: 'a', cfi: '1' },
        { hash: 'b', cfi: '2' },
      ],
      'b',
      '3',
    )
    expect(next).toEqual([
      { hash: 'b', cfi: '3' },
      { hash: 'a', cfi: '1' },
    ])
  })

  it('超容量截断，最老的掉出', () => {
    const full = Array.from({ length: MAX_TTS_LOCATIONS }, (_, i) => ({
      hash: `h${i}`,
      cfi: `c${i}`,
    }))
    const next = upsertTtsLocation(full, 'new', 'c')
    expect(next).toHaveLength(MAX_TTS_LOCATIONS)
    expect(next[0]).toEqual({ hash: 'new', cfi: 'c' })
    expect(next.some((e) => e.hash === `h${MAX_TTS_LOCATIONS - 1}`)).toBe(false)
  })
})
