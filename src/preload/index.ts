// 平台攻击面：经 contextBridge 暴露给 renderer 的白名单，仅 8 桥 23 方法，保持最小、不随业务增长。
// renderer 永远拿不到 ipcRenderer / node 能力，只能调用这里显式开放的平台原语。
import { contextBridge, ipcRenderer } from 'electron'
import type { AuthRecord } from '../shared/auth'
import type { BookFormat, BookPaths, PickedBookFile } from '../shared/books'
import type { ProxyResult, ProxyStmt, SqlMethod } from '../shared/db'
import type { SuggestEntry } from '../shared/suggest'
import type { TranslateRequest } from '../shared/translate'
import type { TtsSynthesizeRequest, TtsSynthesizeResult } from '../shared/tts'
import type { UpdateEvent } from '../shared/updater'

// 登录凭据桥：加密与落盘都在 main（safeStorage）。
const electronAPI = {
  getAuth: (): Promise<AuthRecord | null> => ipcRenderer.invoke('auth:get'),
  setAuth: (record: AuthRecord): Promise<void> => ipcRenderer.invoke('auth:set', record),
  clearAuth: (): Promise<void> => ipcRenderer.invoke('auth:clear'),
}

// 本地库桥：drizzle sqlite-proxy 经此把参数化语句送到 main 执行（main 持 better-sqlite3）。
const dbAPI = {
  open: (userId: number): Promise<void> => ipcRenderer.invoke('db:open', userId),
  close: (): Promise<void> => ipcRenderer.invoke('db:close'),
  exec: (sql: string, params: unknown[], method: SqlMethod): Promise<ProxyResult> =>
    ipcRenderer.invoke('db:exec', sql, params, method),
  batch: (stmts: ProxyStmt[]): Promise<ProxyResult[]> => ipcRenderer.invoke('db:batch', stmts),
}

// 书文件桥：文件对话框 + 内容寻址存储（`<userData>/books/<hash>/`）的读写删，renderer 无 fs 能力。
const booksAPI = {
  pick: (): Promise<PickedBookFile | null> => ipcRenderer.invoke('books:pick'),
  hash: (path: string): Promise<string> => ipcRenderer.invoke('books:hash', path),
  import: (srcPath: string, hash: string, format: BookFormat): Promise<void> =>
    ipcRenderer.invoke('books:import', srcPath, hash, format),
  stat: (hash: string, format: BookFormat): Promise<boolean> =>
    ipcRenderer.invoke('books:stat', hash, format),
  statCover: (hash: string): Promise<boolean> => ipcRenderer.invoke('books:stat-cover', hash),
  read: (hash: string, format: BookFormat): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('books:read', hash, format),
  writeCover: (hash: string, pngBytes: Uint8Array): Promise<void> =>
    ipcRenderer.invoke('books:write-cover', hash, pngBytes),
  paths: (hash: string, format: BookFormat): Promise<BookPaths> =>
    ipcRenderer.invoke('books:paths', hash, format),
  deleteDir: (hash: string): Promise<void> => ipcRenderer.invoke('books:delete-dir', hash),
}

// 本地进程原语桥。
const shellAPI = {
  nodeVersion: (): Promise<string> => ipcRenderer.invoke('shell:node-version'),
}

// 有道 suggest 转发桥：main 的 fetch 不带 Origin（渲染层直连被 403，lookup.md §2）。
const suggestAPI = {
  query: (q: string): Promise<SuggestEntry[]> => ipcRenderer.invoke('suggest:query', q),
}

// 句子翻译转发桥：Google/Azure 接口 renderer 直连被 CORS 拦，main 转发（原文 en、译文中文写死）。
const translateAPI = {
  sentence: (req: TranslateRequest): Promise<string> => ipcRenderer.invoke('translate:sentence', req),
}

// Edge TTS 合成转发桥：wss 接口需自定义头，renderer 的 WebSocket 设不了头，故 main 带头直连转发。
const ttsAPI = {
  synthesize: (req: TtsSynthesizeRequest): Promise<TtsSynthesizeResult> =>
    ipcRenderer.invoke('tts:synthesize', req),
}

// 自动更新桥：electron-updater 住 main；check/install 是请求-响应，onEvent 是 main 的反向推流
// （现有桥里唯一的订阅型方法——返回退订函数，防 listener 泄漏）。
const updaterAPI = {
  check: (): Promise<boolean> => ipcRenderer.invoke('update:check'),
  install: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onEvent: (callback: (event: UpdateEvent) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: UpdateEvent): void => callback(event)
    ipcRenderer.on('update:event', listener)
    return () => ipcRenderer.removeListener('update:event', listener)
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
contextBridge.exposeInMainWorld('dbAPI', dbAPI)
contextBridge.exposeInMainWorld('booksAPI', booksAPI)
contextBridge.exposeInMainWorld('shellAPI', shellAPI)
contextBridge.exposeInMainWorld('suggestAPI', suggestAPI)
contextBridge.exposeInMainWorld('translateAPI', translateAPI)
contextBridge.exposeInMainWorld('ttsAPI', ttsAPI)
contextBridge.exposeInMainWorld('updaterAPI', updaterAPI)
