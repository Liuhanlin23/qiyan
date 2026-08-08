// 阅读进度数据原语（user_book_progress 变更流 LWW 集合，**无墓碑**，db/05）。
// 每书一行：翻页即 upsert。lastReadAt 与 editTime 写入时同值，但仍分两列——editTime 是仲裁字段，
// 不做业务复用（书架「最近阅读」排序读的是 lastReadAt）。删书不经本表（进度保留，不随删书连带清除）。
import { eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { userBookProgress } from '@/db/schema'
import type { ProgressRecord } from './types'

const COLUMNS = {
  bookHash: userBookProgress.bookHash,
  location: userBookProgress.location,
  fraction: userBookProgress.fraction,
  lastReadAt: userBookProgress.lastReadAt,
}

/** 取一本书的进度；从没读过返回 null（开书时据此决定是否恢复位置）。 */
export async function getProgress(db: Db, bookHash: string): Promise<ProgressRecord | null> {
  const row = await db
    .select(COLUMNS)
    .from(userBookProgress)
    .where(eq(userBookProgress.bookHash, bookHash))
    .get()
  return row ?? null
}

/** 记进度（每书一行，upsert）。调用方已去抖，这里不再节流。 */
export async function saveProgress(
  db: Db,
  p: Pick<ProgressRecord, 'bookHash' | 'location' | 'fraction'>,
  now: number,
): Promise<void> {
  const set = { location: p.location, fraction: p.fraction, lastReadAt: now, editTime: now, dirty: 1 }
  await db
    .insert(userBookProgress)
    .values({ bookHash: p.bookHash, ...set })
    .onConflictDoUpdate({ target: userBookProgress.bookHash, set })
    .run()
}
