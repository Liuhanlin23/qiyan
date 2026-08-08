// 开发期 Dock 图标。
//
// 打包后的 App 图标由 build/icon.icns（macOS）/ icon.ico（Windows）在打包时嵌进应用包，
// 与这里无关。但 dev 跑的是 node_modules 里的 Electron 可执行文件，Dock 上顶着 Electron
// 默认图标，只能在运行时换掉 —— 这就是本文件存在的唯一理由。
import { app, nativeImage } from 'electron'
import { join } from 'node:path'

export function applyDevDockIcon(): void {
  // Dock 是 macOS 概念；打包后走 .icns，不需要也不该走这里。
  if (process.platform !== 'darwin' || app.isPackaged) return

  // dev 下 __dirname 是 out/main，图标源在项目根的 build/。
  const icon = nativeImage.createFromPath(join(__dirname, '../../build/icon.png'))
  if (icon.isEmpty()) return

  app.dock?.setIcon(icon)
}
