// dict 词典缓存共享模块门面：查词页 / 单词本（词表·学习读穿）/ 阅读划词三方的读穿入口。绑定库单例 db。
// 增量触发编排在 wordbook 门面（每天首次进单词本），水位线初值由 sync/engine 直引纯函数——故本门面不导出增量/水位线。
import { db } from '@/db/client'
import * as dict from './dict'
import * as service from './service'
import type { LocalDictRow } from './types'

export type { LocalDictRow } from './types'
export type { LookupResult } from './service'

/** 查询词长度上限（与 server controller/service 统一为 120，lookup.md §3）。 */
const TERM_MAX_LENGTH = 120

/**
 * 按 term 读穿查词三态（lookup.md §3）：hit（本地或在线命中）/ not-found（120002 未收录）/ unavailable（离线、服务错误）。
 * 查询词在此归一化（trim + 连续空白折叠单空格，与 server 口径一致；大小写不动）；空词/超长短路不发请求。
 */
export const lookup = (term: string): Promise<service.LookupResult> => {
  const normalized = term.trim().replace(/\s+/g, ' ')
  if (!normalized || normalized.length > TERM_MAX_LENGTH) {
    return Promise.resolve({ status: 'not-found' })
  }
  return service.lookupByTerm(db, normalized)
}
/** 按 dict_id 读穿（未命中走 /dict/batch 单条回填）。 */
export const getDict = (dictId: number): Promise<LocalDictRow | null> =>
  service.readThroughByDictId(db, dictId)
/** 已缓存词条数（设置页诊断）。 */
export const cachedDictCount = (): Promise<number> => dict.cachedDictCount(db)
/** 清空词典缓存（设置页手动；读穿 + 词库补缺随后自动补齐）。 */
export const clearDictCache = (): Promise<void> => dict.clearDictCache(db)
