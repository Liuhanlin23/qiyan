// 词书目录取数层：wire DTO + 端点调用。走静默 apiGet（未命中/离线由上层降级）。
//
// 端点（server 三个读端点）：
//   GET  /word-books/categories             分类树（在线浏览，不落库）
//   GET  /word-books/official?categoryId=    官方词书列表（在线浏览，不落库）
//   GET  /word-books/{bookId}/entries        某书词条列表（在线浏览，不落库）
//
// 词书目录/词条为在线浏览纯内存对象（cache/wordbook.md「不缓存」拍板），不写任何本地表。
// 词典读端点（lookup / batch / updates）见 @/api/dict。
import { apiGet } from './request'

// ────────────────── 词书目录 / 词条（在线浏览，纯内存对象，不落库） ──────────────────

/** 分类树一节点（WordBookCategoryVO，camelCase；叶子无 children）。 */
export interface Category {
  id: number
  parentId: number
  title: string
  children?: Category[]
}

/** GET /word-books/categories：分类树（顶级 + 子级嵌套）。 */
export function fetchCategories(): Promise<Category[]> {
  return apiGet<Category[]>('/word-books/categories')
}

/** 官方词书一行（OfficialWordBookVO，camelCase；coverUrl 为封面 key 透传）。 */
export interface OfficialBook {
  id: number
  categoryId: number
  title: string
  coverUrl: string | null
  description: string | null
  wordCount: number
}

/** GET /word-books/official?categoryId=：官方词书列表；categoryId 省略表示全部。 */
export async function fetchOfficialBooks(categoryId?: number): Promise<OfficialBook[]> {
  const query = categoryId != null ? `?categoryId=${categoryId}` : ''
  const vos = await apiGet<
    Array<{
      id: number
      categoryId: number
      title: string
      coverUrl?: string | null
      description?: string | null
      wordCount?: number
    }>
  >(`/word-books/official${query}`)
  return vos.map((v) => ({
    id: v.id,
    categoryId: v.categoryId,
    title: v.title,
    coverUrl: v.coverUrl ?? null,
    description: v.description ?? null,
    wordCount: v.wordCount ?? 0,
  }))
}

/** 书内词条一行（BookEntryItemVO，snake_case，见 @JsonProperty）。 */
export interface BookEntry {
  dictId: number
  term: string
  sortOrder: number
}

/** GET /word-books/{bookId}/entries：某书词条列表（选词页在线浏览，按书内 sort_order 排序）。 */
export async function fetchBookEntries(bookId: number): Promise<BookEntry[]> {
  const vos = await apiGet<Array<{ dict_id: number; term: string; sort_order: number }>>(
    `/word-books/${bookId}/entries`,
  )
  return vos.map((e) => ({ dictId: e.dict_id, term: e.term, sortOrder: e.sort_order }))
}
