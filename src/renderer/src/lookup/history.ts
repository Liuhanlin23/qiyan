// 查词历史（lookup_history 表）本地库侧读写（docs/feature/lookup/lookup.md §4）。
// 仅本机数据：不进同步协议、不上服务端；「清空词典缓存」不清历史（历史的另一条删除路径只有逃生舱整库重置）。
// 本文件不 import HTTP / dict：历史是查词页的业务数据，与词典缓存互不相干。
import { desc, notInArray } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { lookupHistory } from '@/db/schema'

/** 一条查词历史（term 为权威拼写 dict.term；explain 为命中当时首条简义快照，无义为空串）。 */
export interface LookupHistoryRow {
  term: string
  lookedUpAt: number
  explain: string
}

/** 历史上限（lookup.md §4）：超出删除最旧。 */
const HISTORY_LIMIT = 200

/**
 * 记一次命中查词：upsert（同词更新 looked_up_at 置顶、explain 刷成最新快照），随后裁剪至上限（删最旧超额行）。
 * term 一律传权威拼写（dict.term），explain 传命中当时首条简义（无义传空串）；调用方负责传对。
 * 未收录 / 失败不记（调用方分流）。
 */
export async function recordLookup(
  db: Db,
  term: string,
  explain: string,
  at: number = Date.now(),
): Promise<void> {
  await db
    .insert(lookupHistory)
    .values({ term, lookedUpAt: at, explain })
    .onConflictDoUpdate({ target: lookupHistory.term, set: { lookedUpAt: at, explain } })
  // 裁剪：保留 looked_up_at 最新的 HISTORY_LIMIT 条，删除其余（即最旧的超额行）。
  const keep = db
    .select({ term: lookupHistory.term })
    .from(lookupHistory)
    .orderBy(desc(lookupHistory.lookedUpAt))
    .limit(HISTORY_LIMIT)
  await db.delete(lookupHistory).where(notInArray(lookupHistory.term, keep))
}

/** 全量历史，按 looked_up_at 倒序（最近在前）。 */
export async function listHistory(db: Db): Promise<LookupHistoryRow[]> {
  return db.select().from(lookupHistory).orderBy(desc(lookupHistory.lookedUpAt)).all()
}

/** 一键清空历史。 */
export async function clearHistory(db: Db): Promise<void> {
  await db.delete(lookupHistory).run()
}
