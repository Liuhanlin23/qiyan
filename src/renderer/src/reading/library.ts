// 书架编排：导入 / 开书 / 删书 —— 把平台桥（文件对话框 + 内容寻址存储）、引擎（元数据与封面）
// 与 user_book 原语串起来。db 单例与校准钟在此绑定（同 wordbook/studySession 的「单例只在编排处绑定」纪律）。
import { db } from '@/db/client'
import { booksBridge } from '@/platform'
import { calibratedNowSync } from '@/sync/clock'
import { BOOK_FORMATS, formatFromFileName, isBookFormat } from '../../../shared/books'
import * as books from './books'
import { readBookMeta } from './engine/bookMeta'
import { svg2png } from './svg2png'
import type { BookRecord, ShelfBook } from './types'

export type ImportResult =
  | { status: 'canceled' }
  /** 同一 hash 的活行已在书架：不重复入库，也不覆盖用户改过的书名。 */
  | { status: 'exists'; book: BookRecord }
  /** 新书入库（added），或墓碑行被重新导入复活（restored）。 */
  | { status: 'added' | 'restored'; title: string }

/**
 * 导入一本本地书：选文件 → 认格式 → 算身份 hash → 查 user_book 三分（活行 / 墓碑行 / 无行）→
 * 拷进内容寻址存储 → 解析元数据与封面 → 落行。
 *
 * 格式只由文件后缀定（对话框已按同一张表过滤，走到这儿认不出的是用户手输路径绕过的）：后缀同时决定
 * 落盘扩展名，而**内容对不对由后面的解析兜底**——foliate 按魔数嗅探，改后缀骗不过它，解析失败照旧回滚。
 *
 * 顺序上「先拷贝再解析」是有意的：renderer 没有 fs 能力，读不到用户选的原路径，
 * 只能先让 main 把文件搬进 `books/<hash>/`，再经 `books:read` 取回字节喂引擎。
 */
export async function importBook(): Promise<ImportResult> {
  const picked = await booksBridge.pick()
  if (!picked) return { status: 'canceled' }
  const format = formatFromFileName(picked.fileName)
  if (!format) throw new Error(`不支持的文件格式：${picked.fileName}`)

  const bookHash = await booksBridge.hash(picked.path)
  const existing = await books.getBook(db, bookHash)
  // 拷之前先记下书文件本来在不在：后面失败回滚只清本次拷入的目录（见 discardImportedFile）。
  const preExisted = await booksBridge.stat(bookHash, format)

  try {
    // 拷贝本身是幂等的（目标已存在即返回），所以这行同时兜住「行还在、书文件被手删」的情况。
    await booksBridge.importFile(picked.path, bookHash, format)
    if (existing && !existing.isDeleted) return { status: 'exists', book: existing }

    const meta = await readBookMeta(await openBookFile(bookHash, format))
    // 书名缺失（元数据不全的书）回退文件名，总得让书架上认得出是哪本。
    const title = meta.title || stripExtension(picked.fileName)
    const now = calibratedNowSync()
    await books.addBook(db, { bookHash, title, author: meta.author, format }, now)
    await saveCover(bookHash, meta.cover)
    return { status: existing ? 'restored' : 'added', title }
  } catch (e) {
    await discardImportedFile(bookHash, preExisted)
    throw e
  }
}

/**
 * 导入中途失败（坏书解析不出元数据、落行失败…）的文件侧回滚。
 * 不清就是**永久孤儿**：`books/<hash>/` 已落盘而 `user_book` 无行，书架（无行）、删书（无行可删）、
 * 同步清理（只认墓碑）三方谁都不认领它。best-effort：清不掉只记警告，别把用户的导入错误替换成另一个错误。
 *
 * `preExisted` 为真时绝不删——那是本来就在本机的书文件，不是这次拷进来的。
 */
async function discardImportedFile(bookHash: string, preExisted: boolean): Promise<void> {
  if (preExisted) return
  try {
    await booksBridge.deleteDir(bookHash)
  } catch (e) {
    console.warn('[reading] 导入失败后清理书文件目录失败：', bookHash, e)
  }
}

/**
 * 书架列表（滤墓碑，「最近阅读」优先）+ 逐本 stat 书文件与封面是否在本机。
 * 判定放在渲染前而不是落一个状态列：状态列必与用户手删文件、同步中断漂移。
 * stat 是本机 fs 调用、书架量级（几十本）一次并发无压力；格式不认识的行直接算作没文件（进不了阅读器）。
 *
 * 封面先 stat 再给 URL，而不是无条件挂上让 `<img onError>` 兜底：没封面的书相当常见（元数据不全、
 * 幽灵书连文件都没有），不问一句就等于每次进书架都打一串必然 404 的请求。
 * stat 之后封面才没的（用户手删）仍由 onError 收尾。
 */
export async function listShelf(): Promise<ShelfBook[]> {
  const rows = await books.listBooks(db)
  return Promise.all(
    rows.map(async (book) => {
      const [hasFile, hasCover] = await Promise.all([
        isBookFormat(book.format) && booksBridge.stat(book.bookHash, book.format),
        booksBridge.statCover(book.bookHash),
      ])
      return { ...book, hasFile, coverUrl: hasCover ? booksBridge.coverUrl(book.bookHash) : null }
    }),
  )
}

/**
 * 从内容寻址存储读出书文件喂引擎。
 * 必须带扩展名：foliate `makeBook` 靠 `file.name` 分格式，无名 Blob 会在格式判定处炸。
 *
 * `format` 来自库里的 text 列（可以是任何字符串），这里当关卡收窄回格式表里有的格式——
 * 同步拉到一本别端用更新版本导入的其它格式书时，宁可在此报错，也别把野字符串拼进文件路径。
 */
export async function openBookFile(bookHash: string, format: string): Promise<File> {
  if (!isBookFormat(format)) throw new Error(`不支持的书籍格式：${format}`)
  const bytes = await booksBridge.read(bookHash, format)
  return new File([bytes], `book.${format}`, { type: BOOK_FORMATS[format].mime })
}

/** 删书：置墓碑（跨端传播）+ 删本机文件目录；进度 / 标注不连带（重导入即复活）。 */
export async function deleteBook(bookHash: string): Promise<void> {
  await books.removeBook(db, bookHash, calibratedNowSync())
  await booksBridge.deleteDir(bookHash)
}

/**
 * 别端删书拉到本机后的文件侧收尾（由 sync 引擎在应用完一页 pull 后调用）：删 `books/<hash>/` 目录——
 * 删书语义是「在所有设备上删掉这本书」。阅读数据不连带，重导入同一本书即全部复活。
 *
 * 逐个复核本地行是否真的没了：远端墓碑撞上「本地更晚的脏改动」时 apply 会**保留本地行**（sync.md §3.4 的
 * keepLocal），那本书还在书架上，文件不能删。删目录失败只记警告——文件残留不影响正确性，
 * 而让它把整个同步回合掀掉才是真损失。
 */
export async function purgeRemovedBookFiles(bookHashes: readonly string[]): Promise<void> {
  for (const bookHash of bookHashes) {
    if (await books.getBook(db, bookHash)) continue // 本地行还在（本地改动赢了远端墓碑）→ 留着文件
    try {
      await booksBridge.deleteDir(bookHash)
    } catch (e) {
      console.warn('[reading] 删除已同步移除的书文件失败：', bookHash, e)
    }
  }
}

/**
 * 落封面。封面是可再生派生物，提取失败不该拖垮整次导入——记一条警告放行。
 * 非 SVG 的封面按原字节写进 `cover.png`（jpeg 也叫这名，浏览器按内容嗅探，同 readest）。
 */
async function saveCover(bookHash: string, cover: Blob | null): Promise<void> {
  if (!cover) return
  try {
    const png = cover.type === 'image/svg+xml' ? await svg2png(cover) : cover
    await booksBridge.writeCover(bookHash, new Uint8Array(await png.arrayBuffer()))
  } catch (e) {
    console.warn('[reading] 封面提取失败，跳过：', e)
  }
}

/** `Moby Dick.epub` → `Moby Dick`。 */
function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}
