// 跨进程共享的书文件桥契约（main 实现 / preload 传参 / renderer 消费的单一事实源）。
// 「书从哪来、存在哪」是 renderer 做不到的事（文件对话框 + fs），故下沉 main；书的业务语义（元数据、
// 书架、进度）一律留在 renderer（directory-convention §二）。
//
// 存储布局由 bookHash 完全决定，不存文件名：`<userData>/books/<hash>/book.<format>` + `<hash>/cover.png`。
// 文件在不在本机由运行时 stat 判定，不设状态列。

/**
 * 支持的书文件格式表：**新增一个格式 = 此表加一行**，文件对话框过滤、导入识别、开书关卡三处都读它，
 * 不再各自写死字面量。key 同时是落盘扩展名（`book.<format>`）与 `user_book.format` 列的取值。
 *
 * `extensions` 与 key 分列而非复用：一个格式可能对应多个文件后缀（如将来 fbz 的 `.fb2.zip` / `.fbz`），
 * 落盘只用 key 这一个名字。`mime` 供 renderer 造 File 喂引擎——foliate 的 cbz / fb2 分支靠它认格式
 * （epub 走 zip 魔数嗅探，给了不亏）。
 */
export const BOOK_FORMATS = {
  epub: { extensions: ['epub'], mime: 'application/epub+zip' },
} as const satisfies Record<string, { extensions: readonly string[]; mime: string }>

/** 书文件格式（决定 foliate 解析器与本机文件扩展名）。 */
export type BookFormat = keyof typeof BOOK_FORMATS

/** 后缀 → 格式，**长后缀在前**：多段后缀（如 `.fb2.zip`）必须先于它的子后缀命中。 */
const BY_EXTENSION: readonly (readonly [string, BookFormat])[] = Object.entries(BOOK_FORMATS)
  .flatMap(([format, spec]) => spec.extensions.map((ext) => [ext, format as BookFormat] as const))
  .sort(([a], [b]) => b.length - a.length)

/** 全部可选后缀（不含点），供文件对话框 filters 用。 */
export const BOOK_EXTENSIONS: readonly string[] = BY_EXTENSION.map(([ext]) => ext)

/** 选中文件名 → 格式；后缀不认识返回 null（导入入口据此拒绝）。 */
export function formatFromFileName(fileName: string): BookFormat | null {
  const lower = fileName.toLowerCase()
  return BY_EXTENSION.find(([ext]) => lower.endsWith(`.${ext}`))?.[1] ?? null
}

/**
 * 收窄自由字符串到本版认识的格式。`user_book.format` 是无约束 text 列（前向兼容：别端 / 新版导入的
 * 格式，旧版客户端照收其元数据行），凡是要拼文件路径或喂引擎之前都得先过这道守卫。
 */
export function isBookFormat(format: string): format is BookFormat {
  // 必须 hasOwn 而非 `in`：`in` 会连原型链上的 toString / constructor 一并放行，守卫等于漏了个口子。
  return Object.hasOwn(BOOK_FORMATS, format)
}

/** 文件对话框选中的书文件。fileName 由 main 给出：renderer 无 node:path，跨平台分隔符自己拆不可靠。 */
export interface PickedBookFile {
  /** 用户机器上的原始绝对路径（仅用于随后 hash + 拷贝，导入完即无用，不落库）。 */
  path: string
  /** 原始文件名（含扩展名）：既定格式（formatFromFileName），也在元数据缺 title 时回退取名。 */
  fileName: string
}

/** 某本书在本机的绝对路径（对外露出用，如「在访达中显示」；「文件在不在」仍以 statBookFile 为准）。 */
export interface BookPaths {
  book: string
  cover: string
}

/**
 * 封面自定义协议名：renderer 把 `qiyan-book://<hash>/cover.png` 直接喂 `<img src>`，main 读盘应答。
 *
 * 不走 `file://`：dev 下 renderer 跑在 `http://localhost`，Chromium 禁止 http 页面引用 file:// 子资源，
 * 只有生产的 file:// 页面读得到 —— 两套模式行为分叉，等于 dev 永远看不见封面。
 * 也不走 blob URL：封面得整份读进 renderer 内存并手工 revoke，开销随书架规模线性涨，还废掉
 * `<img loading="lazy">`。自定义协议两边都成立（Tauri 的 convertFileSrc 同一思路）。
 */
export const BOOK_SCHEME = 'qiyan-book'

/** 某本书封面的可渲染 URL。同一 hash 的封面内容恒定（封面不可编辑），故不需要 cache-busting。 */
export function bookCoverUrl(hash: string): string {
  return `${BOOK_SCHEME}://${hash}/cover.png`
}
