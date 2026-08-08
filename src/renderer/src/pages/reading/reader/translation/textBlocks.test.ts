// 懒翻译窗口的单测：钉住「向前 1 段、向后 2 段、夹到文档边界、可见集为空即不译」这条口径——
// 它决定翻页时提前译多少、会不会越界取 undefined 段落塞进队列（node 环境即可，纯索引计算不碰 DOM）。
import { describe, expect, it } from 'vitest'
import { lookAheadRange } from './textBlocks'

describe('lookAheadRange', () => {
  it('可见 [5,8] → 前取 1 后取 2 段，得 [4,10]', () => {
    expect(lookAheadRange(20, 5, 8)).toEqual({ start: 4, end: 10 })
  })

  it('贴边不越界：首段前不到 -1、末段后不超 len-1', () => {
    expect(lookAheadRange(10, 0, 9)).toEqual({ start: 0, end: 9 })
  })

  it('可见集为空（哨兵 first=len, last=-1）返回 null', () => {
    expect(lookAheadRange(10, 10, -1)).toBeNull()
  })

  it('空文档返回 null', () => {
    expect(lookAheadRange(0, 0, -1)).toBeNull()
  })
})
