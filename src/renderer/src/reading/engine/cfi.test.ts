// CFI 归章的单测：钉住「标注/书签不存章名、渲染时按 cfi 现算所属章」这条设计。
// 归错章 = 侧栏分组错乱，而这段是二分查找，边界（首章之前、末章之后、章内子项）光看代码看不出对错。
//
// 用的 CFI 形状与真书一致：章起始 CFI 是 spine 级（`/6/4`），标注 CFI 带章内路径（`/6/4!/4/2...`）。
import { describe, expect, it } from 'vitest'
import { cfiRangeEndpoints, compareCfi, findTocItemByCfi, isCfiInSection } from './cfi'
import type { TocNode } from './foliateEngine'

const node = (label: string, cfi: string | null, subitems: TocNode[] = []): TocNode => ({
  label,
  href: cfi ? `${label}.xhtml` : undefined,
  fractionStart: null,
  cfi,
  subitems,
})

const TOC = [node('第一章', 'epubcfi(/6/4)'), node('第二章', 'epubcfi(/6/8)'), node('第三章', 'epubcfi(/6/12)')]

const inSection = (section: number, offset = 2) => `epubcfi(/6/${section}!/4/${offset}/1:0)`

describe('compareCfi', () => {
  it('按文档序比较；章起始 CFI 排在该章内任何位置之前', () => {
    expect(compareCfi('epubcfi(/6/4)', 'epubcfi(/6/8)')).toBeLessThan(0)
    expect(compareCfi('epubcfi(/6/4)', inSection(4))).toBeLessThan(0)
    expect(compareCfi(inSection(8), 'epubcfi(/6/4)')).toBeGreaterThan(0)
    expect(compareCfi(inSection(4, 2), inSection(4, 6))).toBeLessThan(0)
  })

  // 排序里一条脏数据不该把整个侧栏列表炸掉（同步拉来的行、旧版本写的串都可能不合形状）。
  it('形状异常不抛异常', () => {
    expect(() => compareCfi('不是 CFI', inSection(4))).not.toThrow()
    expect(() => compareCfi('epubcfi(', '')).not.toThrow()
  })
})

// 翻入一章时只补画该章的标注。边界写反（右边界含进下一章起始、或左边界漏掉章首）不会报错、
// 也不会画错东西——只会多画/漏画，肉眼在真书上极难发现，故在这里钉死。
describe('isCfiInSection', () => {
  it('区间是左闭右开：章首算本章，下一章起始不算', () => {
    expect(isCfiInSection('epubcfi(/6/8)', 'epubcfi(/6/8)', 'epubcfi(/6/12)')).toBe(true)
    expect(isCfiInSection(inSection(8), 'epubcfi(/6/8)', 'epubcfi(/6/12)')).toBe(true)
    expect(isCfiInSection('epubcfi(/6/12)', 'epubcfi(/6/8)', 'epubcfi(/6/12)')).toBe(false)
    expect(isCfiInSection(inSection(4), 'epubcfi(/6/8)', 'epubcfi(/6/12)')).toBe(false)
  })

  it('末章（end=null）右边界开到书尾', () => {
    expect(isCfiInSection(inSection(12), 'epubcfi(/6/12)', null)).toBe(true)
    expect(isCfiInSection(inSection(8), 'epubcfi(/6/12)', null)).toBe(false)
  })
})

describe('findTocItemByCfi', () => {
  it('落在哪一章就归哪一章（含末章）', () => {
    expect(findTocItemByCfi(TOC, inSection(4))?.label).toBe('第一章')
    expect(findTocItemByCfi(TOC, inSection(8))?.label).toBe('第二章')
    expect(findTocItemByCfi(TOC, inSection(12))?.label).toBe('第三章')
  })

  it('章内有子项时下钻到最深的那一层', () => {
    const toc = [
      node('第一章', 'epubcfi(/6/4)'),
      node('第二章', 'epubcfi(/6/8)', [node('2.1 节', 'epubcfi(/6/8)'), node('2.2 节', 'epubcfi(/6/10)')]),
    ]
    expect(findTocItemByCfi(toc, inSection(10))?.label).toBe('2.2 节')
  })

  // 真书里 cfi 为 null 的目录项很常见（href 缺失 / 解析不到章序号）。vendor 的 compare('', x) 恒返回 -1，
  // 这类项若参与二分就成了「永远排最前」的哨兵，会被当成候选章吃掉正确归章。
  it('null-cfi 目录项不参与归章（夹在两章之间也不吃掉正确的章）', () => {
    const toc = [
      node('第一章', 'epubcfi(/6/4)'),
      node('封面图', null),
      node('第二章', 'epubcfi(/6/8)'),
      node('版权页', null),
      node('第三章', 'epubcfi(/6/12)'),
    ]
    expect(findTocItemByCfi(toc, inSection(4))?.label).toBe('第一章')
    expect(findTocItemByCfi(toc, inSection(8))?.label).toBe('第二章')
    expect(findTocItemByCfi(toc, inSection(12))?.label).toBe('第三章')
  })

  it('首章之前 / 空目录 → 归不到章（由页面归入「未分组」）', () => {
    expect(findTocItemByCfi(TOC, 'epubcfi(/6/2!/4/2/1:0)')).toBeNull()
    expect(findTocItemByCfi([], inSection(4))).toBeNull()
    expect(findTocItemByCfi(TOC, '')).toBeNull()
  })
})

// 可见范围端点：relocate 的 loc.cfi 是「屏首→屏末」的区间 CFI，拆出的 [start, end]
// 端点就是当前屏可见范围。拆错端点，顶栏书签键与侧栏「当前」的区间判定整个失准。
describe('cfiRangeEndpoints', () => {
  it('区间 CFI 拆成 [start, end] 两个端点 CFI，start 在 end 之前', () => {
    const r = cfiRangeEndpoints('epubcfi(/6/4!/4/10,/1:2,/3:5)')
    expect(r).not.toBeNull()
    expect(compareCfi(r!.start, r!.end)).toBeLessThan(0)
    // 端点值 = 公共前缀拼上各自的局部路径
    expect(compareCfi(r!.start, 'epubcfi(/6/4!/4/10/1:2)')).toBe(0)
    expect(compareCfi(r!.end, 'epubcfi(/6/4!/4/10/3:5)')).toBe(0)
  })

  it('非区间 CFI：两端点相同（可见范围塌缩为一点，仍是合法的半开区间输入）', () => {
    const r = cfiRangeEndpoints('epubcfi(/6/4!/4/10/1:2)')
    expect(r).not.toBeNull()
    expect(compareCfi(r!.start, r!.end)).toBe(0)
  })

  it('形状异常的输入不抛（最坏返回 null 或塌缩端点，不炸掉 relocate 链路）', () => {
    expect(() => cfiRangeEndpoints('not-a-cfi')).not.toThrow()
    expect(() => cfiRangeEndpoints('')).not.toThrow()
  })
})
