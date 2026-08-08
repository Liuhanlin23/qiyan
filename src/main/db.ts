// 每用户本地库的平台执行器：open（开库 + pragma + migrate）、close、exec（单语句）、batch（事务成批）。
// main 是唯一持库进程；库文件路径由 main 按 userId 决定，renderer 摸不到 fs。
// drizzle schema 仍是 schema 唯一真相，migration 由 drizzle-kit 生成、开库时 migrate 执行（无手写 DDL）。
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import type { ProxyStmt, SqlMethod } from '../shared/db'
import { runBatch, runStmt } from './dbExecutor'

/** 同时最多一个打开的库（单窗口、单登录用户）。 */
let current: { userId: number; sqlite: Database.Database } | null = null

/** 每用户库文件路径：登出关闭、换账号互不污染。 */
function userDbPath(userId: number): string {
  return join(app.getPath('userData'), `qiyan-user-${userId}.db`)
}

/**
 * migration 目录：dev 下 app.getAppPath() = desktop 项目根 → ./drizzle；
 * 打包后走 resources（electron-builder extraResources 带上 ./drizzle）。
 */
function migrationsFolder(): string {
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(app.getAppPath(), 'drizzle')
}

/** 打开某用户库并 migrate 建齐全部表（幂等：已是该用户则直接返回）。 */
export function openDb(userId: number): void {
  if (current?.userId === userId) return
  if (current) closeDb()
  const sqlite = new Database(userDbPath(userId))
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  // 各用户库各自追平 __drizzle_migrations，新库从零建全。
  migrate(drizzle(sqlite), { migrationsFolder: migrationsFolder() })
  current = { userId, sqlite }
}

/** 关库（登出 / 换账号）。幂等。 */
export function closeDb(): void {
  if (!current) return
  try {
    current.sqlite.close()
  } catch {
    /* 已关闭忽略 */
  }
  current = null
}

function requireDb(): Database.Database {
  if (!current) throw new Error('db not open')
  return current.sqlite
}

/** main whenReady 时注册一次。 */
export function registerDbIpc(): void {
  ipcMain.handle('db:open', (_e, userId: number) => openDb(userId))
  ipcMain.handle('db:close', () => closeDb())
  ipcMain.handle('db:exec', (_e, sql: string, params: unknown[], method: SqlMethod) =>
    runStmt(requireDb(), { sql, params, method }),
  )
  ipcMain.handle('db:batch', (_e, stmts: ProxyStmt[]) => runBatch(requireDb(), stmts))
}
