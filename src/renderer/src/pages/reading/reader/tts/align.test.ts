import { describe, expect, it } from 'vitest'
import { isCjk, normalizeSynthText } from './align'

describe('脚本判定', () => {
  it('isCjk 命中中日韩，放过纯拉丁', () => {
    expect(isCjk('你好')).toBe(true)
    expect(isCjk('こんにちは')).toBe(true)
    expect(isCjk('안녕')).toBe(true)
    expect(isCjk('hello world')).toBe(false)
  })
})

describe('normalizeSynthText', () => {
  it('折叠空白并去首尾', () => {
    expect(normalizeSynthText('  a\n\t b   c ')).toBe('a b c')
  })
})
