// 自动更新原语（electron-updater 只能住 main：写盘下载 + 拉起安装器）。
// main 保持哑管道：不折叠状态、不做「该不该更新」的判断——事件原样推给 renderer
// （update:event），检查时机由 renderer 决定（启动一次 + 撞 426 时，与版本挡板同节奏，
// 运行期不轮询，docs/feature/client-protocol.md §2）。
// 更新源是打包时烧进安装包的 app-update.yml（electron-builder.yml 的 publish 段，
// 指向 dl.nvwa.world）；请求不走 renderer 的 axios 拦截器，因此**不受 426 挡板影响**——
// 被挡死的应用仍能正常下载更新，这是挡板弹窗能「就地脱困」的前提。
// Windows 未签名：不配 publisherName 即跳过安装包签名校验（当前无证书的既定形态）。
import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateEvent } from '../shared/updater'

function broadcast(event: UpdateEvent): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('update:event', event)
}

// 下载完成才允许 quitAndInstall——没下载完就调用会抛错，这里吞成 no-op 更稳。
let downloaded = false

/** main whenReady 时注册一次。 */
export function registerUpdaterIpc(): void {
  // 事件 → 契约事件的搬运（shared/updater.ts）。electron-updater 的事件字段很宽，只取用得上的。
  autoUpdater.on('checking-for-update', () => broadcast({ type: 'checking' }))
  autoUpdater.on('update-available', (info) => broadcast({ type: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => broadcast({ type: 'not-available' }))
  autoUpdater.on('download-progress', (p) => broadcast({ type: 'progress', percent: p.percent }))
  autoUpdater.on('update-downloaded', (info) => {
    downloaded = true
    broadcast({ type: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => broadcast({ type: 'error', message: err.message }))

  // 发现即下载；没人点「重启更新」也在下次正常退出时静默装上——更新的强制点只有版本挡板，
  // updater 自己不催（product 拍板：不打断没被挡的用户）。
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // 触发一次「检查 + （有新版则）下载」。返回是否支持：dev（未打包）没有 app-update.yml，
  // 返回 false 让 renderer 停在 idle，弹窗落回「下载页 + 重试」形态。
  // checkForUpdates 的 rejection 吞掉——同一失败会走 error 事件，一份错误两个出口只留一个。
  ipcMain.handle('update:check', () => {
    if (!app.isPackaged) return false
    autoUpdater.checkForUpdates().catch(() => {})
    return true
  })

  // 退出 → 装新版 → 自动重启（NSIS oneClick 静默走完）。
  ipcMain.handle('update:install', () => {
    if (downloaded) autoUpdater.quitAndInstall()
  })
}
