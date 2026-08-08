// 登录凭据的 main 进程单一读写点：safeStorage 加密落盘 + IPC 桥（auth:get/set/clear）。
// 平台原语——只负责「加密落盘」这一 Node/Electron 独占能力，无任何业务语义（登录态编排在 renderer/session）。
import { app, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { AuthRecord } from '../shared/auth'

/** 凭据落盘路径（用户数据目录，safeStorage 加密）。 */
function authFilePath(): string {
  return join(app.getPath('userData'), 'auth.bin')
}

/** 读取并解密登录态；文件不存在 / 加密不可用 / 解密失败均返回 null。 */
export function readAuthRecord(): AuthRecord | null {
  try {
    const file = authFilePath()
    if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return null
    return JSON.parse(safeStorage.decryptString(readFileSync(file))) as AuthRecord
  } catch {
    return null
  }
}

/** 加密写入登录态；加密不可用时不落盘（重启需重登），不静默明文存储。 */
export function writeAuthRecord(record: AuthRecord): void {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[auth] safeStorage 不可用，凭据不落盘，重启后需重新登录')
    return
  }
  writeFileSync(authFilePath(), safeStorage.encryptString(JSON.stringify(record)))
}

/** 清除落盘登录态（登出 / 凭据失效）。 */
export function clearAuthRecord(): void {
  try {
    rmSync(authFilePath(), { force: true })
  } catch {
    /* 文件不存在等忽略 */
  }
}

/** main whenReady 时注册一次。生命周期编排（停引擎 / 关库）归 renderer/session，此处只碰盘。 */
export function registerAuthIpc(): void {
  ipcMain.handle('auth:get', () => readAuthRecord())
  ipcMain.handle('auth:set', (_e, record: AuthRecord) => writeAuthRecord(record))
  ipcMain.handle('auth:clear', () => clearAuthRecord())
}
