// 正文底边距的换算口径单测。它同时兜两件事：底部留白带（页码住在里面）永远留得出、朗读会话期间
// 再多让出一个迷你条的高度——算少了正文最后一行会被页码或迷你条压住，算多了正文平白矮一截。
import { describe, expect, it } from 'vitest'
import { readerMarginBottomPx } from './constants'

describe('readerMarginBottomPx', () => {
  it('页边距小于底带高时取底带高（页码才有地方住）', () => {
    expect(readerMarginBottomPx(32, false)).toBe(48)
  })

  it('页边距大于底带高时取页边距（底部不比其它边窄）', () => {
    expect(readerMarginBottomPx(60, false)).toBe(60)
  })

  it('朗读激活时在此之上再让出一个迷你条高', () => {
    expect(readerMarginBottomPx(48, true)).toBe(104)
  })

  // 条高是**叠加**在 max 结果之外的，不参与取大：迷你条坐在留白带之上，占的是额外的一层。
  it('迷你条高叠在取大结果之外，不参与取大', () => {
    expect(readerMarginBottomPx(60, true)).toBe(116)
  })
})
