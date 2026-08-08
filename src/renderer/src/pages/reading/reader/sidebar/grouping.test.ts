// 侧栏分组的单测：钉住「组间按目录先序、组内按真实阅读位置」这条展示口径。
// 记录本身不存章名，分组全靠这段现算——排错了侧栏就串章，光看代码看不出来。
import { describe, expect, it } from 'vitest'
import type { TocNode } from '@/reading'
import { groupByChapter } from './grouping'

const chapter = (label: string, cfi: string): TocNode => ({
  label,
  href: `${label}.xhtml`,
  fractionStart: null,
  cfi,
  subitems: [],
})

const TOC = [chapter('第一章', 'epubcfi(/6/4)'), chapter('第二章', 'epubcfi(/6/8)')]

/** 一条标注/书签：只有分组用得着的字段。 */
const at = (id: string, section: number, offset: number) => ({
  id,
  cfi: `epubcfi(/6/${section}!/4/${offset}/1:0)`,
})

describe('groupByChapter', () => {
  it('按 cfi 归章，组间按目录先序、组内按真实位置排', () => {
    // 故意打乱输入序：第二章的先给、第一章两条倒着给。
    const groups = groupByChapter([at('b', 8, 2), at('a2', 4, 6), at('a1', 4, 2)], TOC)
    expect(groups.map((g) => g.label)).toEqual(['第一章', '第二章'])
    expect(groups[0].items.map((i) => i.id)).toEqual(['a1', 'a2'])
    expect(groups[1].items.map((i) => i.id)).toEqual(['b'])
  })

  it('归不到章的落「未分组」，且排在最后', () => {
    const groups = groupByChapter([at('before', 2, 2), at('a', 4, 2)], TOC)
    expect(groups.map((g) => g.label)).toEqual(['第一章', '未分组'])
  })

  // key 是渲染用的稳定身份：同名章必须各成一组且 key 不撞，否则 React 复用错节点（条目串章显示）。
  it('同名章各自成组，key 不冲突', () => {
    const toc = [chapter('第一节', 'epubcfi(/6/4)'), chapter('第一节', 'epubcfi(/6/8)')]
    const groups = groupByChapter([at('a', 4, 2), at('b', 8, 2)], toc)
    expect(groups.map((g) => g.label)).toEqual(['第一节', '第一节'])
    expect(new Set(groups.map((g) => g.key)).size).toBe(2)
  })

  it('没有目录时全部落「未分组」（不因此丢条目）', () => {
    const groups = groupByChapter([at('a', 4, 2), at('b', 8, 2)], [])
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'b'])
  })
})
