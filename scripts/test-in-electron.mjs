// 在 Electron 内嵌 Node（ELECTRON_RUN_AS_NODE=1，无窗口无 Chromium）里启动 vitest。
// 为什么：better-sqlite3 编译产物只有一份，ABI 只能二选一（系统 node=127 / electron=146）。
// 测试与应用共用 electron ABI 后，postinstall（electron-rebuild）编好的产物两边通用，
// 从此不需要在 `npm rebuild better-sqlite3` 与 `npm run rebuild` 之间来回切换。
// 勿用系统 node 直启 vitest（`npx vitest`）——那会回到 ABI 127 的世界并报 ERR_DLOPEN_FAILED。
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
// require('electron') 在纯 Node 进程里返回 Electron 可执行文件的路径（字符串）
const electron = require('electron')
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')

const child = spawn(electron, [vitest, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
