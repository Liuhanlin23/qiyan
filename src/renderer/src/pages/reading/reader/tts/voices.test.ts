import { describe, expect, it } from 'vitest'
import { DEFAULT_VOICE, findVoice, TTS_VOICES, VOICE_GROUPS, voiceName } from './voices'

describe('TTS_VOICES', () => {
  it('只收英语音色（美音 / 英音），id 唯一且与 locale 前缀自洽', () => {
    expect(new Set(TTS_VOICES.map((v) => v.id)).size).toBe(TTS_VOICES.length)
    for (const v of TTS_VOICES) {
      expect(['en-US', 'en-GB']).toContain(v.locale)
      expect(v.id.startsWith(`${v.locale}-`)).toBe(true)
    }
  })

  it('默认音色在目录内', () => {
    expect(findVoice(DEFAULT_VOICE)).toBeDefined()
  })
})

describe('VOICE_GROUPS', () => {
  it('每款音色恰好出现一次，且组内 locale 一致', () => {
    const all = VOICE_GROUPS.flatMap((g) => g.voices)
    expect(all.length).toBe(TTS_VOICES.length)
    expect(new Set(all.map((v) => v.id)).size).toBe(TTS_VOICES.length)
    for (const g of VOICE_GROUPS) {
      expect(g.voices.every((v) => v.locale === g.locale)).toBe(true)
    }
  })

  it('组标签按 locale 映射（美音 / 英音）', () => {
    const labelOf = (locale: string): string | undefined =>
      VOICE_GROUPS.find((g) => g.locale === locale)?.label
    expect(labelOf('en-US')).toBe('英语 · 美音')
    expect(labelOf('en-GB')).toBe('英语 · 英音')
  })
})

describe('voiceName', () => {
  it('返回音色显示名，未知 id 返回 undefined（由调用方兜底）', () => {
    expect(voiceName('en-US-AndrewNeural')).toBe('Andrew（美 · 男）')
    expect(voiceName('no-such-voice')).toBeUndefined()
  })
})
