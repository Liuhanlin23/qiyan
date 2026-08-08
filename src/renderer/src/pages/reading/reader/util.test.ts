// 页码标签的口径单测。页码为 location 字符刻度后，「没有页码」不再由哨兵值 0 表示，而是 null——
// 判错这一条，分页表未就绪的那一瞬间侧栏就会冒出「p 0」这种书里不存在的页。
import { describe, expect, it } from 'vitest'
import { itemsInRange, pageIndicatorLabel, pageLabel } from './util'

describe('pageLabel', () => {
  it('分页表未就绪 / cfi 解析不到（null）时不出页码标签', () => {
    expect(pageLabel(null)).toBeNull()
  })

  it('有页号就出「p N」，且原样呈现——页号出自分页表，天然在书内，不再二次钳制', () => {
    expect(pageLabel(1)).toBe('p 1')
    expect(pageLabel(427)).toBe('p 427')
  })
})

// 右下角页码那行字的口径单测。格式恒为 `x / y`（斜杠两侧带空格，对齐 readest），不再按底栏开合
// 在 `x` 与 `x / y` 之间切换；页码信息缺任一半（分页表未就绪 / PDF）都回落百分比——回落条件只看
// current 的话，总页数未回填的那一瞬间会显出 `12 / null` 这种字面量。
describe('pageIndicatorLabel', () => {
  it('页码齐全时给「x / y」（斜杠两侧带空格）', () => {
    expect(pageIndicatorLabel(12, 345, 0.5)).toBe('12 / 345')
  })

  it('总页数缺失时回落百分比', () => {
    expect(pageIndicatorLabel(12, null, 0.37)).toBe('37%')
  })

  it('当前页缺失时回落百分比，且四舍五入到整数', () => {
    expect(pageIndicatorLabel(null, 345, 0.374)).toBe('37%')
  })
})

// 书签 / 标注「在不在当前屏」的口径单测（两个列表与顶栏书签键共用这一个判定）。
// 判定按 cfi ∈ 可见范围 [start, end)，与页码域彻底脱钩：右边界判成闭区间的话，本屏末界恰好是下屏首
// 字符时，同一条会在相邻两屏都亮。**返回的是集合不是一条**——同屏几条就该亮几条。
describe('itemsInRange', () => {
  const range = { start: 'epubcfi(/6/4!/4/10/1:0)', end: 'epubcfi(/6/4!/4/20/1:0)' }
  const marks = [
    { id: 'before', cfi: 'epubcfi(/6/4!/4/2/1:0)' },
    { id: 'atStart', cfi: 'epubcfi(/6/4!/4/10/1:0)' },
    { id: 'inside', cfi: 'epubcfi(/6/4!/4/12/1:3)' },
    { id: 'atEnd', cfi: 'epubcfi(/6/4!/4/20/1:0)' },
  ]

  it('半开区间 [start, end)：恰好等于 start 的含、恰好等于 end 的不含，屏前的不含', () => {
    expect(itemsInRange(marks, range).map((b) => b.id)).toEqual(['atStart', 'inside'])
  })

  // 双栏一屏里两条高亮都得亮——只挑「最近的一条」是本判定要根治的老毛病。
  it('同屏多条全部命中（不挑一条）', () => {
    const spread = [
      { id: 'left', cfi: 'epubcfi(/6/4!/4/11/1:5)' },
      { id: 'right', cfi: 'epubcfi(/6/4!/4/18/1:2)' },
    ]
    expect(itemsInRange(spread, range).map((a) => a.id)).toEqual(['left', 'right'])
  })

  it('条目是区间 CFI 时按其起点判定（书签起点 = 落签时屏首字符，标注即划选区间）', () => {
    const interval = [{ id: 'x', cfi: 'epubcfi(/6/4!/4/12,/1:0,/3:8)' }]
    expect(itemsInRange(interval, range).map((b) => b.id)).toEqual(['x'])
  })

  it('range 为 null（引擎还没抛过位置）不判定，一律作本屏无条目', () => {
    expect(itemsInRange(marks, null)).toEqual([])
  })
})
