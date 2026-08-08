// 主窗口创建。单窗口为架构约束：renderer 生命周期 ≈ 应用生命周期。
import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

export function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    show: false,
    // Windows 没有全局菜单栏，Electron 默认菜单（File/Edit/View/Window）会画在窗口顶部占一行；隐藏它，
    // 按 Alt 仍可临时唤出，Ctrl+R / F12 等 role 快捷键不受影响。macOS 走系统菜单栏，无需处理。
    autoHideMenuBar: process.platform === 'win32',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 同步引擎的定时器（防抖 4s / 定时 8min）跑在 renderer；关掉后台节流，避免窗口失焦时被 Chromium 掐停。
      backgroundThrottling: false,
      // 开启 Chromium 内置 PDF 阅读器，让 <iframe src=".pdf"> 能内联显示（真题阅读器  的内置阅读器对照项）。
      plugins: true,
    },
  })

  // 外链一律交系统浏览器：renderer 跑在 file:// 上，就地导航会丢掉整个 SPA（只能重启才回得来）。
  // 因此 `<a target="_blank">` 在应用内一律不开新窗口，只放行 http(s)，其余协议直接吞掉。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // electron-vite dev 注入 ELECTRON_RENDERER_URL（dev server 地址）；生产加载打包后的 html。
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
