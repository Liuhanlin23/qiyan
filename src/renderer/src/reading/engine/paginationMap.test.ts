// location 刻度分页表的单测：钉住「全 app 页码出自单一 size 域算术」的四件根本承诺——
//  ① 开书即全书精确（sections size 开书即知，无收敛期、无重估）；
//  ② 三条页码路径（observe 屏首 / cfi 异步 / fraction 同步）共享同一算术，边界上不分叉；
//  ③ 屏首页码与 pageOfCfi 同源（同一函数同一缓存），relocate 的视觉估计仅作解析回来前的占位；
//  ④ 排版无关：没有 invalidate，缓存永不失效。
// 算错了在界面上就是书签行 p N ≠ 页码条（本次要修的 bug 本尊），光读代码看不出来。
import { describe, expect, it, vi } from 'vitest'
import { createPaginationMap, type PaginationMapControl } from './paginationMap'

// 四章书：解压字节 3000 / 6000 / 4500 / 1500，共 15000 字节 ⇒ 1500 一格共 10 页。
// 章起始比例形状同 view.getSectionFractions()：长度 = 章数 + 1，末位 1。
const SIZE_TOTAL = 15000
const FRACTIONS = [0, 3000 / 15000, 9000 / 15000, 13500 / 15000, 1]

const noDeps = {
  sectionIndexOfCfi: () => null,
  pageOfCfiAsync: async () => null,
}

function opened(): PaginationMapControl {
  const map = createPaginationMap(noDeps)
  map.reset(FRACTIONS, SIZE_TOTAL)
  return map
}

describe('PaginationMap 就绪与当前页', () => {
  it('reset 喂空数据（固定版式给不出 size 域）不就绪：页码一律 null', () => {
    const map = createPaginationMap(noDeps)
    map.reset([], 0)
    expect(map.ready).toBe(false)
    expect(map.totalPages).toBeNull()
    expect(map.currentPage).toBeNull()
    expect(map.pageOfFraction(0.5)).toBeNull()
    expect(map.pageOfCfi('epubcfi(/6/4)')).toBeNull()
  })

  it('reset 喂有效数据即就绪：总页数 = ceil(sizeTotal / 1500)，开书即全书精确、无收敛期', () => {
    const map = opened()
    expect(map.ready).toBe(true)
    expect(map.totalPages).toBe(10)
    expect(map.currentPage).toBeNull() // 尚未 observe：还不知道读者在哪，不能编一个页号
  })

  it('observe 喂 relocate 的 location（0 基屏首）：currentPage = current + 1，越界钳进 total', () => {
    const map = opened()
    map.observe({ current: 0, atEnd: false, startCfi: null })
    expect(map.currentPage).toBe(1)
    map.observe({ current: 6, atEnd: false, startCfi: null })
    expect(map.currentPage).toBe(7)
    // sizeTotal 整除 1500 时书尾 current 可到 10，+1 = 11 越过 total，必须钳回
    map.observe({ current: 10, atEnd: false, startCfi: null })
    expect(map.currentPage).toBe(10)
  })

  it('书尾钳制：atEnd 时 currentPage 恒 = 总页数（哪怕 location 还差一格）', () => {
    const map = opened()
    map.observe({ current: 8, atEnd: true, startCfi: null })
    expect(map.currentPage).toBe(10)
  })

  it('observe 带屏首 cfi：先给视觉估计占位，字符计数解析回来后 currentPage 换为同源精确值并广播', async () => {
    const pageOfCfiAsync = vi.fn(async () => 4) // 字符计数域：这一屏首在第 4 页
    const map = createPaginationMap({ sectionIndexOfCfi: () => 1, pageOfCfiAsync })
    map.reset(FRACTIONS, SIZE_TOTAL)
    const onChange = vi.fn()
    map.onChange(onChange)

    // 视觉估计 = current + 1 = 5，与字符计数在刻度边界分叉的场景
    map.observe({ current: 4, atEnd: false, startCfi: 'epubcfi(/6/4!/4/2/1:10)' })
    expect(map.currentPage).toBe(5) // 解析没回来前：视觉估计占位
    await vi.waitFor(() => expect(map.currentPage).toBe(4)) // 字符计数域赢，即唯一事实源
    // observe 本身广播一次，解析回填必须再广播一次——Reader 靠第二次才会重取精确值
    expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(pageOfCfiAsync).toHaveBeenCalledWith('epubcfi(/6/4!/4/2/1:10)')
  })

  it('翻回已解析过的屏：currentPage 直接命中缓存，无占位窗口', async () => {
    const pageOfCfiAsync = vi.fn(async () => 4)
    const map = createPaginationMap({ sectionIndexOfCfi: () => 1, pageOfCfiAsync })
    map.reset(FRACTIONS, SIZE_TOTAL)
    map.observe({ current: 4, atEnd: false, startCfi: 'epubcfi(/6/4!/4/2/1:10)' })
    await vi.waitFor(() => expect(map.currentPage).toBe(4))
    map.observe({ current: 7, atEnd: false, startCfi: 'epubcfi(/6/4!/4/8/1:0)' }) // 翻走
    await vi.waitFor(() => expect(pageOfCfiAsync).toHaveBeenCalledTimes(2))
    map.observe({ current: 4, atEnd: false, startCfi: 'epubcfi(/6/4!/4/2/1:10)' }) // 翻回
    expect(map.currentPage).toBe(4) // 同步命中缓存，没有占位闪烁
    expect(pageOfCfiAsync).toHaveBeenCalledTimes(2) // 不为翻回重新解析
  })

  it('底栏与书签同源：同一位置经两个出口问，最终答案恒相同', async () => {
    const pageOfCfiAsync = vi.fn(async () => 4)
    const map = createPaginationMap({ sectionIndexOfCfi: () => 1, pageOfCfiAsync })
    map.reset(FRACTIONS, SIZE_TOTAL)
    const cfi = 'epubcfi(/6/4!/4/2/1:10)'
    map.observe({ current: 4, atEnd: false, startCfi: cfi }) // 底栏出口
    map.pageOfCfi(cfi) // 书签出口（同一 key 命中同一缓存）
    await vi.waitFor(() => expect(map.currentPage).toBe(4))
    expect(map.pageOfCfi(cfi)).toBe(map.currentPage) // 同函数同点，恒等
  })

  it('屏首解析失败：维持视觉估计占位，不反复排队', async () => {
    const pageOfCfiAsync = vi.fn(async () => {
      throw new Error('这一章文档读不出来')
    })
    const map = createPaginationMap({ sectionIndexOfCfi: () => 1, pageOfCfiAsync })
    map.reset(FRACTIONS, SIZE_TOTAL)
    map.observe({ current: 4, atEnd: false, startCfi: 'bad' })
    await vi.waitFor(() => expect(pageOfCfiAsync).toHaveBeenCalledTimes(1))
    expect(map.currentPage).toBe(5) // 失败缓存 null → 一直用视觉估计
    map.observe({ current: 6, atEnd: false, startCfi: 'bad2' })
    map.observe({ current: 4, atEnd: false, startCfi: 'bad' }) // 同 cfi 再来不重排队
    await vi.waitFor(() => expect(pageOfCfiAsync).toHaveBeenCalledTimes(2)) // 只多了 bad2 一次
  })

  it('atEnd 书尾钳制优先于屏首缓存值', async () => {
    const pageOfCfiAsync = vi.fn(async () => 9)
    const map = createPaginationMap({ sectionIndexOfCfi: () => 1, pageOfCfiAsync })
    map.reset(FRACTIONS, SIZE_TOTAL)
    map.observe({ current: 8, atEnd: true, startCfi: 'epubcfi(/6/8!/4/2/1:0)' })
    await vi.waitFor(() => expect(pageOfCfiAsync).toHaveBeenCalled())
    expect(map.currentPage).toBe(10) // atEnd 恒 = 总页数，缓存的 9 不越权
  })
})

describe('PaginationMap.pageOfFraction', () => {
  it('两端与章边界：0 → 1、1 → total（钳制）、章起始比例 → 该章起始页', () => {
    const map = opened()
    expect(map.pageOfFraction(0)).toBe(1)
    expect(map.pageOfFraction(1)).toBe(10) // floor(15000/1500)+1 = 11，钳回 total
    expect(map.pageOfFraction(FRACTIONS[1])).toBe(3) // 3000 字节起 ⇒ 第 3 页
    expect(map.pageOfFraction(FRACTIONS[2])).toBe(7) // 9000 字节起 ⇒ 第 7 页
    expect(map.pageOfFraction(FRACTIONS[3])).toBe(10)
  })

  it('越界比例钳进书内，NaN 给 null（引擎偶发上报 >1 时不能算出书里没有的页）', () => {
    const map = opened()
    expect(map.pageOfFraction(-1)).toBe(1)
    expect(map.pageOfFraction(1.2)).toBe(10)
    expect(map.pageOfFraction(Number.NaN)).toBeNull()
  })

  it('章首 fraction 与 observe 口径一致：比例是除出来的小数，×sizeTotal 的浮点渣不能把边界页算低一页', () => {
    // starts[1] = 3/7：×7000 = 2999.999…（IEEE754），裸 floor 得 1、页号 2；
    // 而 relocate 在同一位置报 current = floor(3000/1500) = 2、页号 3。目录章起始页与页码条必须同数。
    const map = createPaginationMap(noDeps)
    map.reset([0, 3 / 7, 1], 7000)
    expect(map.pageOfFraction(3 / 7)).toBe(3)
  })
})

describe('PaginationMap.pageOfCfi', () => {
  it('先给该章起始页顶上，异步解析回来落缓存 + 广播 onChange，缓存命中不再重算', async () => {
    const pageOfCfiAsync = vi.fn(async () => 5)
    const map = createPaginationMap({ sectionIndexOfCfi: () => 1, pageOfCfiAsync })
    map.reset(FRACTIONS, SIZE_TOTAL)
    const onChange = vi.fn()
    map.onChange(onChange)

    expect(map.pageOfCfi('epubcfi(/6/4!/4/2)')).toBe(3) // 第二章起始页（尚未解析）
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(map.pageOfCfi('epubcfi(/6/4!/4/2)')).toBe(5) // 解析回来的最终页号
    expect(pageOfCfiAsync).toHaveBeenCalledTimes(1) // 结果进缓存，重渲染不再重排队
  })

  it('解析失败缓存 null：停在该章起始页，不反复重排队（侧栏每帧重渲染不会把队列灌爆）', async () => {
    const pageOfCfiAsync = vi.fn(async () => {
      throw new Error('这一章的文档读不出来')
    })
    const map = createPaginationMap({ sectionIndexOfCfi: () => 1, pageOfCfiAsync })
    map.reset(FRACTIONS, SIZE_TOTAL)

    expect(map.pageOfCfi('bad')).toBe(3)
    await vi.waitFor(() => expect(pageOfCfiAsync).toHaveBeenCalledTimes(1))
    expect(map.pageOfCfi('bad')).toBe(3)
    expect(map.pageOfCfi('bad')).toBe(3)
    expect(pageOfCfiAsync).toHaveBeenCalledTimes(1)
  })

  it('屏首 cfi 插队头：不被侧栏排队的书签 cfi 卡在后面', async () => {
    const order: string[] = []
    const pageOfCfiAsync = vi.fn(async (cfi: string) => {
      order.push(cfi)
      return 2
    })
    const map = createPaginationMap({ sectionIndexOfCfi: () => 0, pageOfCfiAsync })
    map.reset(FRACTIONS, SIZE_TOTAL)
    map.pageOfCfi('bm-1') // 侧栏书签 1：入队并启动 drain（已开始解析）
    map.pageOfCfi('bm-2') // 侧栏书签 2：排在队里
    map.observe({ current: 0, atEnd: false, startCfi: 'screen-start' })
    await vi.waitFor(() => expect(order).toHaveLength(3))
    expect(order).toEqual(['bm-1', 'screen-start', 'bm-2']) // 正在解析的不打断，屏首插到剩余队列最前
  })

  it('屏首解析完成即时广播，不等队列见底', async () => {
    // 队尾的 bm-2 永不返回（模拟冷章慢解析）：只有「屏首一解析完就广播」才能让底栏拿到 2，
    // 攒到队列见底再广播的实现在这里一次也播不出来。
    let releaseBm2 = (): void => {}
    const emits: number[] = []
    const pageOfCfiAsync = vi.fn(async (cfi: string) => {
      if (cfi === 'bm-2') await new Promise<void>((r) => (releaseBm2 = r))
      return cfi === 'screen-start' ? 2 : 3
    })
    const map = createPaginationMap({ sectionIndexOfCfi: () => 0, pageOfCfiAsync })
    map.reset(FRACTIONS, SIZE_TOTAL)
    map.pageOfCfi('bm-1') // 侧栏书签 1：已在解析
    map.pageOfCfi('bm-2') // 侧栏书签 2：排队，轮到它就会卡住
    map.observe({ current: 0, atEnd: false, startCfi: 'screen-start' }) // 插到 bm-2 前面
    map.onChange(() => emits.push(map.currentPage ?? -1))

    await vi.waitFor(() => expect(emits).toContain(2)) // 队列还堵着，底栏已拿到精确值
    expect(map.pageOfCfi('bm-2')).toBe(1) // 队尾仍未落缓存（给的是该章起始页），确证没等见底
    releaseBm2()
  })

  it('未就绪（固定版式）不给页码也不排队解析——没有 size 域，解析回来也无处安放', () => {
    const pageOfCfiAsync = vi.fn(async () => 5)
    const map = createPaginationMap({ sectionIndexOfCfi: () => 1, pageOfCfiAsync })
    map.reset([], 0)
    expect(map.pageOfCfi('epubcfi(/6/4)')).toBeNull()
    expect(pageOfCfiAsync).not.toHaveBeenCalled()
  })
})

describe('PaginationMap.onChange', () => {
  it('observe 位置变化即广播，同位置重喂不白刷（重排 relocate 多抛几次不抖侧栏）', () => {
    const map = opened()
    const onChange = vi.fn()
    map.onChange(onChange)
    map.observe({ current: 2, atEnd: false, startCfi: null })
    expect(onChange).toHaveBeenCalledTimes(1)
    map.observe({ current: 2, atEnd: false, startCfi: null })
    expect(onChange).toHaveBeenCalledTimes(1)
    map.observe({ current: 3, atEnd: false, startCfi: null })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('只看显示值：屏首 cfi 换了但页号没动（一格刻度跨两屏）不白刷整个阅读器', () => {
    const map = opened()
    const onChange = vi.fn()
    map.onChange(onChange)
    map.observe({ current: 2, atEnd: false, startCfi: 'epubcfi(/6/4!/4/2/1:0)' })
    expect(onChange).toHaveBeenCalledTimes(1)
    // 翻一屏但没跨刻度：current 不动、startCfi 换了，页号仍是 3——广播了也只是重渲出同一个数
    map.observe({ current: 2, atEnd: false, startCfi: 'epubcfi(/6/4!/4/2/1:700)' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(map.currentPage).toBe(3)
  })
})
