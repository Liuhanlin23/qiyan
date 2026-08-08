// 校准钟单调护栏单测（sync.md §1 校准时钟）：本地时钟回拨时 calibratedNowSync 也不得回退——
// 否则新编辑的 editTime 反而变小，被服务端 LWW（>=）拒绝、客户端 reconcile 回旧值静默丢编辑。
// 业务语义（写路径打 editTime 必须严格单调）变了这测试就该失败（规则 7）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calibratedNowSync } from './clock'

describe('calibratedNowSync 单调护栏（防时钟回拨丢数据）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('本地时钟回拨（先大后小）时连续调用严格递增', () => {
    const spy = vi.spyOn(Date, 'now')
    spy.mockReturnValueOnce(10_000) // 正常
    spy.mockReturnValueOnce(9_000) // 回拨
    spy.mockReturnValueOnce(9_001) // 仍落后于首次
    const a = calibratedNowSync()
    const b = calibratedNowSync()
    const c = calibratedNowSync()
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })

  it('时钟正常前进时贴合真实时间（护栏不抬高）', () => {
    const spy = vi.spyOn(Date, 'now')
    spy.mockReturnValueOnce(1_000_000)
    spy.mockReturnValueOnce(1_000_050)
    const a = calibratedNowSync()
    const b = calibratedNowSync()
    expect(b).toBe(a + 50) // 正常前进按真实增量，不被护栏干预
  })
})
