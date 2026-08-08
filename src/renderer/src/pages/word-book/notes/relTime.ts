// 笔记卡相对时间（纯展示逻辑）：按本地日历日边界（00:00）判定，而非 24h 滚动窗口——
// 否则昨晚 23:00 编辑、今早 08:00 查看（毫秒差不足 1 天）会误显示「今天」。用 Date.now() 即可，
// 不接校准钟（展示无需精确），也不用 4:00 学习日口径（那是学习队列概念，与笔记编辑时间展示无关）。
const DAY_MS = 24 * 60 * 60 * 1000

/** 把时刻归到当天本地 00:00 的 epoch ms。 */
function localMidnight(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * 相对时间：edit_time（epoch）→ 中文展示，按本地日历日差。
 * 「今天/昨天」按日历日相等 / 相差 1 判定；再往前按日历日差换算天 / 周 / 月。
 * 两个本地午夜之差在无 DST 时恰为 DAY_MS，用 round 折算以吸收潜在 DST ±1h 抖动。
 */
export function relTime(editTime: number, now: number): string {
  const d = Math.max(0, Math.round((localMidnight(now) - localMidnight(editTime)) / DAY_MS))
  if (d <= 0) return '今天'
  if (d === 1) return '昨天'
  if (d < 7) return `${d} 天前`
  if (d < 30) return `${Math.floor(d / 7)} 周前`
  return `${Math.floor(d / 30)} 个月前`
}
