// 开书前的元数据 / 封面提取 —— 阅读域对 vendor foliate `makeBook` 的第二处收口（第一处是 foliateEngine）。
// 与阅读器无关：不建 `<foliate-view>`、不渲染，只把书解析开取几个字段，用完即 destroy。导入流程用它。
import { formatAuthors, formatTitle, type Contributor, type LanguageMap } from '../metadata'

export interface BookMeta {
  /** 书名（取不到为空串，由调用方回退文件名）。 */
  title: string
  /** 作者（多作者已按书的语言连接成单行；取不到为空串）。 */
  author: string
  /** 封面原图，格式随书（png / jpeg / svg）；无封面为 null。 */
  cover: Blob | null
}

/** foliate `makeBook` 产物里本文件用到的那一小片（引擎无类型，按需收口，同 engine/foliate.d.ts 纪律）。 */
interface ParsedBook {
  metadata?: {
    // 解析不到的字段 foliate 给 null（不是 undefined），整形函数一并收下。
    title?: string | LanguageMap | null
    author?: string | string[] | Contributor | Contributor[] | null
    language?: string | string[] | null
  }
  getCover?: () => Promise<Blob | null>
  destroy?: () => void
}

export async function readBookMeta(file: File): Promise<BookMeta> {
  // @ts-expect-error 无类型的 vendor ESM 模块
  const { makeBook } = await import('@/vendor/foliate-js/view.js')
  const book = (await makeBook(file)) as ParsedBook
  try {
    const meta = book.metadata ?? {}
    return {
      title: formatTitle(meta.title).trim(),
      author: formatAuthors(meta.author, meta.language).trim(),
      // 必须在 destroy 前取：封面是从 zip loader 现读的。
      cover: (await book.getCover?.()) ?? null,
    }
  } finally {
    book.destroy?.()
  }
}
