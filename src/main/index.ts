// main 进程入口：app 生命周期 + 注册各平台模块（每个都是无业务语义的 Node/Electron 原语）。
// 一切业务（数据、同步、取数、编排）住在 renderer。
import { app, BrowserWindow } from 'electron'
import { applyDevDockIcon } from './appIcon'
import { registerAuthIpc } from './auth'
import { registerBookScheme, registerBooksIpc } from './books'
import { registerDbIpc } from './db'
import { registerShellIpc } from './shell'
import { registerSuggestIpc } from './suggest'
import { registerTranslateIpc } from './translate'
import { registerTtsIpc } from './tts'
import { registerUpdaterIpc } from './updater'
import { createWindow } from './window'

// 封面协议的特权声明必须早于 app ready（Electron 硬性要求），故不能挪进下面的 whenReady。
registerBookScheme()

app.whenReady().then(() => {
  applyDevDockIcon() // dev 下把 Dock 上的 Electron 默认图标换成本项目图标（打包后走 .icns）
  registerAuthIpc() // 登录凭据加密落盘：auth:get/set/clear
  registerDbIpc() // 每用户库执行器：db:open/close/exec/batch
  registerBooksIpc() // 书文件内容寻址存储：books:pick/hash/import/stat/read/write-cover/paths/delete-dir
  registerShellIpc() // 本地进程原语：shell:node-version
  registerSuggestIpc() // 有道 suggest 转发：suggest:query（main 的 fetch 不带 Origin）
  registerTranslateIpc() // 句子翻译转发：translate:sentence（Google/Azure，main 的 fetch 绕 CORS）
  registerTtsIpc() // Edge TTS 合成转发：tts:synthesize（main 用 ws 带头 wss 直连，renderer WS 不能设头）
  registerUpdaterIpc() // 自动更新原语：update:check/install + update:event 推流（electron-updater 只能住 main）

  createWindow()

  // macOS：点 Dock 图标且无窗口时重建窗口。
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 非 macOS：所有窗口关闭即退出。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
