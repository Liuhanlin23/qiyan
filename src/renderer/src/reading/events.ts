// 阅读事件数据原语（user_reading_event 变更流 **append-only** 集合，db/05）。
// 纯函数：db 由编排传入（directory-convention §三「域模块内部纪律」）。
// 行不可变——没有 update、没有 delete、没有墓碑；聚合（日时长 / 单书总时长 / 连续天数）全部 SQL 派生，不落库。
import type { Db } from '@/db/client'
import { userReadingEvent } from '@/db/schema'
import type { ReadingEventRecord } from './types'

/**
 * 追加一段阅读片段（dirty=1）。同 `(bookHash, startTime)` 已有行即静默忽略——
 * 采集侧的重放（如结算后又被 flush 一次）不该把时长翻倍，幂等由自然键兜住而不是由调用方保证。
 */
export async function addReadingEvent(db: Db, e: ReadingEventRecord): Promise<void> {
  await db
    .insert(userReadingEvent)
    .values({ ...e, dirty: 1 })
    .onConflictDoNothing()
    .run()
}
