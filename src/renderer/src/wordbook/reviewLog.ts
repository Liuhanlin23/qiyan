// 复习日志（user_review_log 变更流 append-only 集合，db/04）。行不可变；每日记账的唯一真源（study.md §每日记账）。
// 记账口径（按词去重、窗口作参数）：
//   今日新学数 = 窗口内有 pre_state=0 日志的词数；
//   今日复习数 = 窗口内有日志、且窗口内无 pre_state=0 日志的词数（今天动过的既有词）；
//   今日已学词 = 窗口内有日志的词（distinct）——新学与复习二者并集，天然互斥。
// 追加通道 = applyRating（words.ts）把本表 INSERT 与 user_word 整行合批原子提交；此处提供该 INSERT 语句 + 推导查询。
import { and, countDistinct, eq, gte, lt, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Db } from '@/db/client'
import { userReviewLog } from '@/db/schema'
import type { ReviewLogInput } from './types'

/** 追加一条复习日志的语句（dirty=1；同 (dictId, reviewTime) 幂等静默）。供 applyRating 合批。 */
export function appendLogStmt(db: Db, log: ReviewLogInput): BatchItem<'sqlite'> {
  return db
    .insert(userReviewLog)
    .values({
      dictId: log.dictId,
      reviewTime: log.reviewTime,
      rating: log.rating,
      durationMs: log.durationMs,
      preState: log.preState,
      preStability: log.preStability,
      preDifficulty: log.preDifficulty,
      dirty: 1,
    })
    .onConflictDoNothing()
}

/** 今日窗口谓词 [startMs, endMs)。 */
function inWindow(startMs: number, endMs: number) {
  return and(gte(userReviewLog.reviewTime, startMs), lt(userReviewLog.reviewTime, endMs))
}

/** 今日新学数 = 窗口内有 pre_state=0 日志的词数（按词去重）。 */
export async function todayNewCount(db: Db, startMs: number, endMs: number): Promise<number> {
  return (
    (
      await db
        .select({ n: countDistinct(userReviewLog.dictId) })
        .from(userReviewLog)
        .where(and(inWindow(startMs, endMs), eq(userReviewLog.preState, 0)))
        .get()
    )?.n ?? 0
  )
}

/** 今日复习数 = 窗口内有日志、且窗口内无 pre_state=0 日志的词数（今天动过的既有词，按词去重）。 */
export async function todayReviewCount(db: Db, startMs: number, endMs: number): Promise<number> {
  const n = alias(userReviewLog, 'url_new')
  const hasNewToday = db
    .select({ one: sql`1` })
    .from(n)
    .where(
      and(
        eq(n.dictId, userReviewLog.dictId),
        gte(n.reviewTime, startMs),
        lt(n.reviewTime, endMs),
        eq(n.preState, 0),
      ),
    )
  return (
    (
      await db
        .select({ n: countDistinct(userReviewLog.dictId) })
        .from(userReviewLog)
        .where(and(inWindow(startMs, endMs), notExists(hasNewToday)))
        .get()
    )?.n ?? 0
  )
}

/** 今日已学词（窗口内有日志的 distinct dict_id）：= 今日新学 ∪ 今日复习。 */
export async function todayStudiedWords(db: Db, startMs: number, endMs: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ dictId: userReviewLog.dictId })
    .from(userReviewLog)
    .where(inWindow(startMs, endMs))
    .all()
  return rows.map((r) => r.dictId)
}

/** 今日新学词（窗口内有 pre_state=0 日志的 distinct dict_id）——今日学习页「今日学习」段。 */
export async function todayNewWords(db: Db, startMs: number, endMs: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ dictId: userReviewLog.dictId })
    .from(userReviewLog)
    .where(and(inWindow(startMs, endMs), eq(userReviewLog.preState, 0)))
    .all()
  return rows.map((r) => r.dictId)
}

/** 今日复习词（窗口内有日志、且窗口内无 pre_state=0 日志的 distinct dict_id）——今日学习页「今日复习」段。 */
export async function todayReviewWords(db: Db, startMs: number, endMs: number): Promise<number[]> {
  const n = alias(userReviewLog, 'url_new')
  const hasNewToday = db
    .select({ one: sql`1` })
    .from(n)
    .where(
      and(
        eq(n.dictId, userReviewLog.dictId),
        gte(n.reviewTime, startMs),
        lt(n.reviewTime, endMs),
        eq(n.preState, 0),
      ),
    )
  const rows = await db
    .selectDistinct({ dictId: userReviewLog.dictId })
    .from(userReviewLog)
    .where(and(inWindow(startMs, endMs), notExists(hasNewToday)))
    .all()
  return rows.map((r) => r.dictId)
}
