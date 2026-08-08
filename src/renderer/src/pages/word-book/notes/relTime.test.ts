// 笔记相对时间口径单测（修复执行文档 T11）：核心 intent = 按本地日历日边界判定，而非 24h 滚动窗口。
// 跨午夜但不足 24h 应算「昨天」；同一日历日内不论时刻差多大都算「今天」。口径变了这些测试就该失败（规则 7）。
import { describe, expect, it } from 'vitest'
import { relTime } from './relTime'

// 本地时刻构造器（用本地时区，与 relTime 的 localMidnight 同口径）。
const at = (y: number, mo: number, d: number, h: number, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

describe('relTime（本地日历日口径，T11）', () => {
  it('跨午夜不足 24h → 昨天（昨 23:00 vs 今 08:00，毫秒差仅 9h）', () => {
    expect(relTime(at(2026, 7, 16, 23, 0), at(2026, 7, 17, 8, 0))).toBe('昨天')
  })

  it('同一日历日内 → 今天（今 00:30 vs 今 08:00）', () => {
    expect(relTime(at(2026, 7, 17, 0, 30), at(2026, 7, 17, 8, 0))).toBe('今天')
  })

  it('同日历日即便近满 24h → 今天（今 00:10 vs 今 23:50）', () => {
    expect(relTime(at(2026, 7, 17, 0, 10), at(2026, 7, 17, 23, 50))).toBe('今天')
  })

  it('日历日差 2/3/6 → N 天前', () => {
    expect(relTime(at(2026, 7, 15, 12, 0), at(2026, 7, 17, 8, 0))).toBe('2 天前')
    expect(relTime(at(2026, 7, 11, 1, 0), at(2026, 7, 17, 23, 0))).toBe('6 天前')
  })

  it('7~29 天 → N 周前；30 天+ → N 个月前', () => {
    expect(relTime(at(2026, 7, 3, 12, 0), at(2026, 7, 17, 12, 0))).toBe('2 周前')
    expect(relTime(at(2026, 5, 17, 12, 0), at(2026, 7, 17, 12, 0))).toBe('2 个月前')
  })

  it('editTime 在未来（钟抖动）钳到今天，不出现负数', () => {
    expect(relTime(at(2026, 7, 18, 8, 0), at(2026, 7, 17, 8, 0))).toBe('今天')
  })
})
