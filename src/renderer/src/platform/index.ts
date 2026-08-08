// 平台桥薄封装：全 renderer 唯一碰 window.electronAPI / dbAPI / booksAPI / shellAPI / suggestAPI 的地方。
// 上层（db/client、session、sync、reading）只依赖这里，不直接摸 window，便于收敛平台攻击面与测试替身。
import type { ProxyResult, ProxyStmt, SqlMethod } from '../../../shared/db'
import type { AuthRecord } from '../../../shared/auth'
import { bookCoverUrl, type BookFormat, type BookPaths, type PickedBookFile } from '../../../shared/books'
import type { SuggestEntry } from '../../../shared/suggest'
import type { TranslateRequest } from '../../../shared/translate'
import type { TtsSynthesizeRequest, TtsSynthesizeResult } from '../../../shared/tts'
import type { UpdateEvent } from '../../../shared/updater'

/** 登录凭据桥（加密落盘在 main）。 */
export const authBridge = {
  get: (): Promise<AuthRecord | null> => window.electronAPI.getAuth(),
  set: (record: AuthRecord): Promise<void> => window.electronAPI.setAuth(record),
  clear: (): Promise<void> => window.electronAPI.clearAuth(),
}

/** 本地库桥（better-sqlite3 在 main；这里只传参数化语句）。 */
export const dbBridge = {
  open: (userId: number): Promise<void> => window.dbAPI.open(userId),
  close: (): Promise<void> => window.dbAPI.close(),
  exec: (sql: string, params: unknown[], method: SqlMethod): Promise<ProxyResult> =>
    window.dbAPI.exec(sql, params, method),
  batch: (stmts: ProxyStmt[]): Promise<ProxyResult[]> => window.dbAPI.batch(stmts),
}

/**
 * 书文件桥（文件对话框 + `<userData>/books/<hash>/` 内容寻址存储；renderer 无 fs 能力）。
 * 只做搬运不做判断：书是否已在书架、元数据怎么取，全在 reading 域。
 */
export const booksBridge = {
  /** 选书（取消返回 null）。 */
  pick: (): Promise<PickedBookFile | null> => window.booksAPI.pick(),
  /** 算书籍身份（部分 MD5，32 位小写 hex）。 */
  hash: (path: string): Promise<string> => window.booksAPI.hash(path),
  /** 拷进内容寻址存储（目标已存在则幂等跳过）。 */
  importFile: (srcPath: string, hash: string, format: BookFormat): Promise<void> =>
    window.booksAPI.import(srcPath, hash, format),
  /** 书文件在不在本机（幽灵书判定；不设状态列，每次运行时问文件系统）。 */
  stat: (hash: string, format: BookFormat): Promise<boolean> => window.booksAPI.stat(hash, format),
  /** 封面在不在本机（缺封面的 EPUB / 幽灵书都没有；决定书架挂图还是走文字书封）。 */
  statCover: (hash: string): Promise<boolean> => window.booksAPI.statCover(hash),
  /** 封面的可渲染 URL（自定义协议，直接喂 `<img src>`）。纯拼串，不碰盘，故不过 IPC。 */
  coverUrl: (hash: string): string => bookCoverUrl(hash),
  /** 读整本（开书用）。 */
  read: (hash: string, format: BookFormat): Promise<ArrayBuffer> => window.booksAPI.read(hash, format),
  /** 写封面 PNG（导入时提取）。 */
  writeCover: (hash: string, pngBytes: Uint8Array): Promise<void> =>
    window.booksAPI.writeCover(hash, pngBytes),
  /** 取绝对路径（书架封面 `<img>` 经 `file://` 直读）。 */
  paths: (hash: string, format: BookFormat): Promise<BookPaths> => window.booksAPI.paths(hash, format),
  /** 删书目录（书文件 + 封面）。 */
  deleteDir: (hash: string): Promise<void> => window.booksAPI.deleteDir(hash),
}

/** 本地进程原语桥。 */
export const shellBridge = {
  nodeVersion: (): Promise<string> => window.shellAPI.nodeVersion(),
}

/** 有道 suggest 转发桥（main 的 fetch 不带 Origin，lookup.md §2；失败一律空数组，联想静默）。 */
export const suggestBridge = {
  query: (q: string): Promise<SuggestEntry[]> => window.suggestAPI.query(q),
}

/** 句子翻译转发桥（Google/Azure，main 绕 CORS；原文 en、译文中文写死；失败抛错交弹层显示）。 */
export const translateBridge = {
  sentence: (req: TranslateRequest): Promise<string> => window.translateAPI.sentence(req),
}

/** Edge TTS 合成转发桥（main 带头 wss 直连；返回整段 MP3 + 逐词边界；失败抛错交上层回滚提示）。 */
export const ttsBridge = {
  synthesize: (req: TtsSynthesizeRequest): Promise<TtsSynthesizeResult> =>
    window.ttsAPI.synthesize(req),
}

/**
 * 自动更新桥（electron-updater 住 main）。check 返回是否支持（dev 未打包 = false）；
 * onEvent 订阅 main 的事件推流（返回退订函数）；事件折叠成状态归 lib/appUpdate.ts。
 */
export const updaterBridge = {
  check: (): Promise<boolean> => window.updaterAPI.check(),
  install: (): Promise<void> => window.updaterAPI.install(),
  onEvent: (callback: (event: UpdateEvent) => void): (() => void) =>
    window.updaterAPI.onEvent(callback),
}
