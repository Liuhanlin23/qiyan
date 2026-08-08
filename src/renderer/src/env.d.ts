/// <reference types="vite/client" />

// 自定义环境变量（与 Vite 的 ImportMetaEnv 合并）。
interface ImportMetaEnv {
  /** 后端 API 基址（含 /api 前缀）；dev 缺省 http://localhost:8080/api，prod 由构建注入。 */
  readonly VITE_API_BASE_URL?: string
}

/** 桌面端版本号（= package.json 的 version），编译期由 define 注入；请求层的 X-Client-Version 值。 */
declare const __APP_VERSION__: string

// 跨进程契约（src/shared/*）。用 inline import 类型引入为全局别名，避免顶层 import 让本文件退化为模块。
type AuthRecord = import('../../shared/auth').AuthRecord
type BookFormat = import('../../shared/books').BookFormat
type BookPaths = import('../../shared/books').BookPaths
type PickedBookFile = import('../../shared/books').PickedBookFile
type ProxyStmt = import('../../shared/db').ProxyStmt
type ProxyResult = import('../../shared/db').ProxyResult
type SqlMethod = import('../../shared/db').SqlMethod
type SuggestEntry = import('../../shared/suggest').SuggestEntry
type TranslateRequest = import('../../shared/translate').TranslateRequest
type TtsSynthesizeRequest = import('../../shared/tts').TtsSynthesizeRequest
type TtsSynthesizeResult = import('../../shared/tts').TtsSynthesizeResult
type UpdateEvent = import('../../shared/updater').UpdateEvent

// preload 经 contextBridge 暴露到 window 的平台面（与 src/preload/index.ts 对齐）：8 桥 23 方法，保持最小。
interface Window {
  electronAPI: {
    getAuth: () => Promise<AuthRecord | null>
    setAuth: (record: AuthRecord) => Promise<void>
    clearAuth: () => Promise<void>
  }
  dbAPI: {
    open: (userId: number) => Promise<void>
    close: () => Promise<void>
    exec: (sql: string, params: unknown[], method: SqlMethod) => Promise<ProxyResult>
    batch: (stmts: ProxyStmt[]) => Promise<ProxyResult[]>
  }
  booksAPI: {
    pick: () => Promise<PickedBookFile | null>
    hash: (path: string) => Promise<string>
    import: (srcPath: string, hash: string, format: BookFormat) => Promise<void>
    stat: (hash: string, format: BookFormat) => Promise<boolean>
    statCover: (hash: string) => Promise<boolean>
    read: (hash: string, format: BookFormat) => Promise<ArrayBuffer>
    writeCover: (hash: string, pngBytes: Uint8Array) => Promise<void>
    paths: (hash: string, format: BookFormat) => Promise<BookPaths>
    deleteDir: (hash: string) => Promise<void>
  }
  shellAPI: {
    nodeVersion: () => Promise<string>
  }
  suggestAPI: {
    query: (q: string) => Promise<SuggestEntry[]>
  }
  translateAPI: {
    sentence: (req: TranslateRequest) => Promise<string>
  }
  ttsAPI: {
    synthesize: (req: TtsSynthesizeRequest) => Promise<TtsSynthesizeResult>
  }
  updaterAPI: {
    check: () => Promise<boolean>
    install: () => Promise<void>
    onEvent: (callback: (event: UpdateEvent) => void) => () => void
  }
}
