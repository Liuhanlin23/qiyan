import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 客户端版本挡板的请求头值（docs/feature/client-protocol.md）：请求拦截器要同步取值，
// 故编译期注入而非走 IPC；打包后 app.getVersion() 与 package.json 同值，IPC 无增益。
// vitest.config.ts 有同款 define，改这里记得两处一起改。
const pkgVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')).version

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    define: {
      __APP_VERSION__: JSON.stringify(pkgVersion)
    },
    // 钉死 IPv4：vite 默认 host 为 `localhost`，在 Windows + Node 17+ 下会解析成 IPv6 而只监听 ::1，
    // 但 Electron 的 Chromium 加载 http://localhost 时走 127.0.0.1，连接被拒 → 窗口白屏。macOS 双栈解析掩盖了这点。
    server: {
      host: '127.0.0.1'
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        // 阅读引擎（vendor/foliate-js）里两个裸依赖的解析口（见 vendor/foliate-js/VENDOR.md）：
        // ① pdf.js 的 `@pdfjs/pdf.min.mjs` —— 指向 npm 的 pdfjs 构建（它挂 globalThis.pdfjsLib 供 vendor 读）。
        //    worker / cmaps / 字体 / wasm 走 public 静态资源，由 scripts/sync-pdfjs.mjs 从同一个包同步。
        // ② fixed-layout.js 的 construct-style-sheets-polyfill —— Electron 的 Chromium 原生支持
        //    adoptedStyleSheets，无需 polyfill，故仍用空 stub 顶掉，只为让打包器解析得动。
        '@pdfjs/pdf.min.mjs': resolve('node_modules/pdfjs-dist/build/pdf.min.mjs'),
        'construct-style-sheets-polyfill': resolve('src/renderer/src/reading/engine/vendor-stub.ts')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
