// 跨进程共享的自动更新桥契约（main 转发 / preload 传参 / renderer 消费的单一事实源）。
// electron-updater 只能住 main（要写盘、要拉起安装器）；main 不折叠状态，只把它的原始事件
// 逐条推给 renderer（update:event），「事件 → 展示状态」的折叠逻辑留在 renderer store
// （业务语义不下沉 main，directory-convention §二）。

/**
 * 主进程推送的更新事件（与 electron-updater 的事件一一对应，只留 renderer 用得上的字段）。
 * autoDownload 开启，故没有独立的「开始下载」事件——available 即下载已在路上。
 */
export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }
