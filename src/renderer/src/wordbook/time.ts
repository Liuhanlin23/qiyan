// 日边界工具（study.md「核心口径·日边界」）：今日窗口 = [今日 4:00, 次日 4:00)，本地时区、用校准钟判定。
// 语义对齐 anki rslib/src/scheduler/timing.rs：凌晨 0:00–3:59 属昨日窗口，4:00 整翻转进新的一天。
// 时区取设备本地时区（new Date 组件构造即本地时；跨月/DST 由 Date 规范化处理）。now 一律传校准钟 epoch ms。

/** 每日翻转时刻（本地小时）。凌晨 2 点属昨日，4:00 整属今日。 */
export const DAY_ROLLOVER_HOUR = 4

/** 今日窗口 [startMs, endMs)：startMs=今日 4:00 本地、endMs=次日 4:00 本地（凌晨则整体回退一天）。 */
export function dayWindow(now: number): { startMs: number; endMs: number } {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAY_ROLLOVER_HOUR, 0, 0, 0)
  if (d.getHours() < DAY_ROLLOVER_HOUR) start.setDate(start.getDate() - 1) // 凌晨归昨日窗口
  const end = new Date(start)
  end.setDate(end.getDate() + 1) // +1 天（Date 规范化处理跨月/DST）
  return { startMs: start.getTime(), endMs: end.getTime() }
}

/** 次日 4:00（= 今日窗口右开界）：到期判定 `due < nextDayAt(now)`（study.md）。 */
export function nextDayAt(now: number): number {
  return dayWindow(now).endMs
}
