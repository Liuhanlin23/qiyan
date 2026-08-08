// 书文件平台原语：文件对话框 + 内容寻址存储的读写删（一能力一文件）。
// 无任何业务语义——不认识 user_book 表、不做去重判断、不解析 EPUB；这些全在 renderer 的 reading 域。
//
// 存储布局（契约见 shared/books.ts）：`<userData>/books/<hash>/book.<format>`、`<hash>/cover.png`。
// 路径由 hash + format 完全决定，故二者是**唯一**参与拼路径的外来输入，一律先过形状校验再拼——
// renderer 会渲染不可信的 EPUB 内容，`deleteBookDir` 又是破坏性操作，拼路径前不校验等于开着目录穿越。
import { BrowserWindow, app, dialog, ipcMain, protocol } from 'electron'
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  BOOK_EXTENSIONS,
  BOOK_SCHEME,
  type BookFormat,
  type BookPaths,
  type PickedBookFile,
} from '../shared/books'
import { partialMd5OfFile } from './partialMd5'

/** 书籍身份形状：部分 MD5 的 32 位小写 hex（与 push 守卫同一条正则，见 docs/db/05-reading.md「书籍身份哈希：部分 MD5 规格」）。 */
const HASH_RE = /^[0-9a-f]{32}$/
/** 扩展名形状：纯小写字母数字，杜绝 `..` / 分隔符混入。 */
const FORMAT_RE = /^[a-z0-9]{1,8}$/

/** 某本书的目录（校验 hash 形状后才拼路径）。 */
function bookDir(hash: string): string {
  if (!HASH_RE.test(hash)) throw new Error(`invalid book hash: ${hash}`)
  return join(app.getPath('userData'), 'books', hash)
}

function bookFilePath(hash: string, format: string): string {
  if (!FORMAT_RE.test(format)) throw new Error(`invalid book format: ${format}`)
  return join(bookDir(hash), `book.${format}`)
}

function coverFilePath(hash: string): string {
  return join(bookDir(hash), 'cover.png')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** 文件对话框选书（放行格式表里的全部后缀）。取消返回 null。 */
async function pickBookFile(parent: BrowserWindow | null): Promise<PickedBookFile | null> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: '电子书', extensions: [...BOOK_EXTENSIONS] }],
  }
  const { canceled, filePaths } = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  const path = filePaths[0]
  if (canceled || !path) return null
  return { path, fileName: basename(path) }
}

/**
 * 把用户选中的书文件拷进内容寻址存储。幂等：目标已存在直接返回（同 hash 即同内容，重拷无意义，
 * 40MB 级书文件重拷还很贵）。调用方须先 hashBookFile 拿到 hash。
 *
 * 落位走 `.tmp` + 同目录 rename（原子），且 rename 前对**在手文件**重算 hash 复核：
 *  - 直接拷 dest：中途崩溃/掉电留下截断文件，下次导入被上面的幂等早退当成完整文件永久固化，开书必败；
 *  - hash 由 renderer 先算后传：算完到拷完之间原文件被换掉，就会以错身份落盘、跨端指向另一本书。
 * 12KB 采样的重算成本可忽略。残留的 `.tmp` 不专门清理（下次导入 copyFile 直接覆盖）。
 */
async function importBookFile(srcPath: string, hash: string, format: BookFormat): Promise<void> {
  const dest = bookFilePath(hash, format)
  if (await exists(dest)) return
  await mkdir(bookDir(hash), { recursive: true })
  const tmp = `${dest}.tmp`
  await copyFile(srcPath, tmp)
  if ((await partialMd5OfFile(tmp)) !== hash) {
    await rm(tmp, { force: true })
    throw new Error('book file hash mismatch')
  }
  await rename(tmp, dest)
}

/**
 * 声明封面协议的特权位。**必须在 app ready 之前调用**（Electron 硬性要求），故与 IPC 注册分成两个入口。
 * `standard` 让 URL 按 host/path 解析（hash 落在 host 上）、`secure` 让它在 dev 的 http 页面里也算安全来源。
 * 不开 `supportFetchAPI`：只给 `<img>` 用，renderer 没有 fetch 它的理由。
 */
export function registerBookScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: BOOK_SCHEME, privileges: { standard: true, secure: true } },
  ])
}

/**
 * 封面协议应答：`qiyan-book://<hash>/cover.png` → `<userData>/books/<hash>/cover.png`。
 *
 * host 与 path 都是 renderer 递来的外来输入，故**只放行这一个形状**（hash 过 HASH_RE、路径必须恰好是
 * `/cover.png`），其余一律 404 —— 否则这条协议就等于给 renderer 开了一个任意文件读取口。
 * 封面读不出来（EPUB 本就没封面、幽灵书、文件被手删）是正常状态，同样 404，由 `<img onError>` 退回文字书封。
 * Content-Type 恒 `image/png`：cover.png 里也可能是 jpeg 字节（写盘不转码，同 readest），
 * 但图片解码按内容嗅探，MIME 说错不影响渲染。
 */
async function handleCoverRequest(request: Request): Promise<Response> {
  const { hostname, pathname } = new URL(request.url)
  if (pathname !== '/cover.png' || !HASH_RE.test(hostname)) return new Response(null, { status: 404 })
  try {
    return new Response(await readFile(coverFilePath(hostname)), {
      headers: { 'content-type': 'image/png' },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}

/** main whenReady 时注册一次。 */
export function registerBooksIpc(): void {
  protocol.handle(BOOK_SCHEME, handleCoverRequest)
  ipcMain.handle('books:pick', (e) => pickBookFile(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle('books:hash', (_e, path: string) => partialMd5OfFile(path))
  ipcMain.handle('books:import', (_e, srcPath: string, hash: string, format: BookFormat) =>
    importBookFile(srcPath, hash, format),
  )
  ipcMain.handle('books:stat', (_e, hash: string, format: BookFormat) =>
    exists(bookFilePath(hash, format)),
  )
  // 封面在不在（书架据此决定挂封面 URL 还是走文字书封）。同书文件：不设状态列，每次问文件系统。
  ipcMain.handle('books:stat-cover', (_e, hash: string) => exists(coverFilePath(hash)))
  // 开书：整本过 IPC（40MB 级实测可接受；卡顿再议流式方案，不预建）。
  ipcMain.handle('books:read', async (_e, hash: string, format: BookFormat) => {
    const buf = await readFile(bookFilePath(hash, format))
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  })
  ipcMain.handle('books:write-cover', async (_e, hash: string, pngBytes: Uint8Array) => {
    await mkdir(bookDir(hash), { recursive: true })
    await writeFile(coverFilePath(hash), pngBytes)
  })
  ipcMain.handle(
    'books:paths',
    (_e, hash: string, format: BookFormat): BookPaths => ({
      book: bookFilePath(hash, format),
      cover: coverFilePath(hash),
    }),
  )
  // 删书：整目录移除（书文件 + 封面）。目录不存在视为已删。
  ipcMain.handle('books:delete-dir', (_e, hash: string) =>
    rm(bookDir(hash), { recursive: true, force: true }),
  )
}
