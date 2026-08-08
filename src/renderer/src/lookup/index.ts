// lookup 查词域门面：查词历史（仅本机，docs/feature/lookup/lookup.md §4）。绑定库单例 db。
// 查词取数不在此——查词页走 dict 门面读穿三态（lookup.md §3），本域只管历史这份页面业务数据。
import { db } from '@/db/client'
import * as history from './history'

export type { LookupHistoryRow } from './history'

/** 记一次命中查词（term 传权威拼写 dict.term；explain 传首条简义快照；未收录 / 失败不记，由页面分流）。 */
export const recordLookup = (term: string, explain: string): Promise<void> =>
  history.recordLookup(db, term, explain)
/** 全量历史，按 looked_up_at 倒序（最近在前）。 */
export const listHistory = (): Promise<history.LookupHistoryRow[]> => history.listHistory(db)
/** 一键清空历史。 */
export const clearHistory = (): Promise<void> => history.clearHistory(db)
