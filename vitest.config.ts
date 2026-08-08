import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 与 electron.vite.config.ts 的 renderer 段同款注入：request.ts 的版本头读编译期常量，
// 这里不给同一份 define，一切（传递）import request.ts 的测试都会 ReferenceError。
const pkgVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')).version

// 数据层单测把 sqlite-proxy 回调指向进程内 better-sqlite3，数据函数经 `@/` 别名解析。
// 被测的数据层不 import electron（只经 sqlite-proxy + main/dbExecutor），故无需 electron 桩。
// 经 `npm test`（scripts/test-in-electron.mjs）跑在 Electron 内嵌 Node 里（ELECTRON_RUN_AS_NODE，无 GUI）：
// better-sqlite3 与应用共用 electron ABI（postinstall 已编好），无需切 ABI。勿用系统 node 直启 vitest。
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
    },
  },
})
