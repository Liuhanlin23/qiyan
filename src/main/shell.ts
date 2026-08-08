// 本地进程原语：无业务语义的通用能力。现只保留既有 node --version 一个原语——
// 将来「本地 Claude Code」需要长进程/流式输出时再加 spawn/write/kill/onData，仍无业务语义。
import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** main whenReady 时注册一次。 */
export function registerShellIpc(): void {
  // 以 node 模式（ELECTRON_RUN_AS_NODE）起子进程跑 `--version`，把 stdout 返回 renderer。
  // 这条链路是后续「打通用户本地 Claude Code」的地基。
  ipcMain.handle('shell:node-version', async () => {
    const { stdout } = await execFileAsync(process.execPath, ['--version'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    return stdout.trim()
  })
}
