import { describe, expect, it, vi } from 'vitest'
import { generateSecMsGec, genSSML, parseAudioMetadataBody } from './edgeTts'

describe('genSSML', () => {
  it('把纯文本包进带音色/语速/语言的 SSML 信封', () => {
    const ssml = genSSML('en-US', 'Hello world', 'en-US-AndrewNeural', 1)
    expect(ssml).toContain('xml:lang="en-US"')
    expect(ssml).toContain('name="en-US-AndrewNeural"')
    expect(ssml).toContain('rate="1"')
    expect(ssml).toContain('Hello world')
  })

  it('转义 XML 特殊字符，避免正文里的 & < > 破坏 SSML', () => {
    const ssml = genSSML('en-US', 'Tom & Jerry <3', 'v', 1)
    expect(ssml).toContain('Tom &amp; Jerry &lt;3')
  })
})

describe('parseAudioMetadataBody', () => {
  it('只取 WordBoundary，跳过其它类型；缺 Duration 补 0', () => {
    const body = JSON.stringify({
      Metadata: [
        { Type: 'WordBoundary', Data: { Offset: 1000, Duration: 500, text: { Text: 'Hello' } } },
        { Type: 'SentenceBoundary', Data: { Offset: 0, text: { Text: 'x' } } },
        { Type: 'WordBoundary', Data: { Offset: 2000, text: { Text: 'world' } } },
      ],
    })
    expect(parseAudioMetadataBody(body)).toEqual([
      { offset: 1000, duration: 500, text: 'Hello' },
      { offset: 2000, duration: 0, text: 'world' },
    ])
  })

  it('坏 JSON 返回空数组而非抛错', () => {
    expect(parseAudioMetadataBody('not json')).toEqual([])
  })
})

describe('generateSecMsGec', () => {
  it('输出 64 位大写 hex', () => {
    expect(generateSecMsGec()).toMatch(/^[0-9A-F]{64}$/)
  })

  it('同一 5 分钟桶内稳定、跨桶变化（服务端按同规则校验的前提）', () => {
    vi.useFakeTimers()
    try {
      // 1770000000s 可被 300 整除，落在某桶起点。
      const base = 1_770_000_000_000
      vi.setSystemTime(base)
      const a = generateSecMsGec()
      vi.setSystemTime(base + 150_000) // 同桶（+150s）
      const b = generateSecMsGec()
      vi.setSystemTime(base + 300_000) // 跨桶（+300s）
      const c = generateSecMsGec()
      expect(a).toBe(b)
      expect(a).not.toBe(c)
    } finally {
      vi.useRealTimers()
    }
  })
})
