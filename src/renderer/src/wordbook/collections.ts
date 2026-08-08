// wordbook 同步件（形态 A′，sync.md §3.5）：三件 words / notes / reviewLogs——words / notes 由 lwwCollection
// 参数化生成，reviewLogs 手写 append-only（apply = INSERT OR IGNORE，clear 按主键 + dirty=1，行不可变无需比对 edit_time）。
// settings 件已上提至 @/settings/collection（跨域偏好，中立模块独占）。
// engine 从这里与 @/settings/collection 显式导入四件、按固定顺序 words→notes→settings→reviewLogs 调用。
import { and, eq } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Db } from '@/db/client'
import { userReviewLog, userWord, userWordNote } from '@/db/schema'
import { lwwCollection, type LwwCollection } from '@/sync/lww'
import type { NoteRow, ReviewLogRow, WordRow } from '@/sync/protocol'

/** words：LWW，自然键 dictId，有墓碑，载荷 = joinTime + FSRS 九字段（joinTime 随行整覆盖同步，db/04）。 */
export const words: LwwCollection<WordRow> = lwwCollection<WordRow>({
  table: userWord,
  key: [{ col: userWord.dictId, prop: 'dictId', wire: true }],
  payload: [
    { col: userWord.joinTime, prop: 'joinTime', default: 0 },
    { col: userWord.due, prop: 'due', default: null },
    { col: userWord.stability, prop: 'stability', default: 0 },
    { col: userWord.difficulty, prop: 'difficulty', default: 0 },
    { col: userWord.scheduledDays, prop: 'scheduledDays', default: 0 },
    { col: userWord.learningSteps, prop: 'learningSteps', default: 0 },
    { col: userWord.reps, prop: 'reps', default: 0 },
    { col: userWord.lapses, prop: 'lapses', default: 0 },
    { col: userWord.state, prop: 'state', default: 0 },
    { col: userWord.lastReview, prop: 'lastReview', default: null },
  ],
  hasTombstone: true,
})

/** notes：LWW，自然键 dictId，有墓碑，载荷 = note（墓碑行空串）。 */
export const notes: LwwCollection<NoteRow> = lwwCollection<NoteRow>({
  table: userWordNote,
  key: [{ col: userWordNote.dictId, prop: 'dictId', wire: true }],
  payload: [{ col: userWordNote.note, prop: 'note', default: '' }],
  hasTombstone: true,
})

// ────────────────── reviewLogs：append-only（手写，sync.md §3.3） ──────────────────

/** 自然键谓词 (dictId, reviewTime)。 */
function reviewLogKey(row: ReviewLogRow) {
  return and(eq(userReviewLog.dictId, row.dictId), eq(userReviewLog.reviewTime, row.reviewTime))
}

/** reviewLogs 三件套：apply 幂等去重（INSERT OR IGNORE）、clear 按主键 + dirty=1（无 editTime 比对）。 */
export const reviewLogs = {
  async collectDirty(db: Db): Promise<ReviewLogRow[]> {
    const rows = await db.select().from(userReviewLog).where(eq(userReviewLog.dirty, 1)).all()
    return rows.map(
      (r): ReviewLogRow => ({
        syncVer: 0,
        dictId: r.dictId,
        reviewTime: r.reviewTime,
        rating: r.rating as 1 | 2 | 3,
        durationMs: r.durationMs,
        preState: r.preState as 0 | 1 | 2 | 3,
        preStability: r.preStability,
        preDifficulty: r.preDifficulty,
      }),
    )
  },

  /** 幂等插入：唯一键冲突静默忽略（重复推送/回拉无副作用）；下行的 syncVer 不落地。 */
  applyRemoteStmt(db: Db, row: ReviewLogRow): BatchItem<'sqlite'> {
    return db
      .insert(userReviewLog)
      .values({
        dictId: row.dictId,
        reviewTime: row.reviewTime,
        rating: row.rating,
        durationMs: row.durationMs,
        preState: row.preState,
        preStability: row.preStability,
        preDifficulty: row.preDifficulty,
        dirty: 0,
      })
      .onConflictDoNothing()
  },

  /** push 被接受后清 dirty：行不可变，按 (自然键, dirty=1) 收口即可。 */
  clearAcceptedStmts(db: Db, rows: readonly ReviewLogRow[]): BatchItem<'sqlite'>[] {
    return rows.map((row) =>
      db.update(userReviewLog).set({ dirty: 0 }).where(and(reviewLogKey(row), eq(userReviewLog.dirty, 1))),
    )
  },
}
