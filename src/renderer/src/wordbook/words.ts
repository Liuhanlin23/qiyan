// 全局词库读写（user_word 变更流 LWW 集合）。词表四段口径落实 words.md（我的词库页），评分落库落实 study.md。
// 本地写 = 改行 + dirty=1 + 打校准 editTime（editTime 由门面传入，保持本层纯函数、便于单测）。
// 四段互斥全覆盖、纯 state/due 判断；到期界 = nextDayAt(now)（次日 4:00，study.md「核心口径」）。全部读写走 drizzle，异步。
import { and, count, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { runBatch, type Db } from '@/db/client'
import { dict, userWord } from '@/db/schema'
import { nextDayAt } from './time'
import { appendLogStmt } from './reviewLog'
import type { ReviewLogInput, SegmentCounts, WordListItem, WordRecord, WordSegment, WordStateBrief } from './types'

const STATE_IN_SCHEDULE = [1, 2, 3] // Learning / Review / Relearning（参与调度的三态）

/**
 * 单条学习态 → 四段（与 segmentCond 同口径，选词页徽标/批量判定用）：nd = nextDayAt(now)。
 * new=state0 / mastered=state4 / due=调度态且已到期 / memorizing=调度态未到期（due 空归未到期）。
 */
export function segmentOf(state: number, due: number | null, nd: number): WordSegment {
  if (state === 0) return 'new'
  if (state === 4) return 'mastered'
  return due != null && due < nd ? 'due' : 'memorizing'
}

/** 段谓词（四段互斥全覆盖）：nd = nextDayAt(now)。记忆中含 due 为空的调度态（防御，归未到期）。 */
function segmentCond(segment: WordSegment, nd: number) {
  switch (segment) {
    case 'new':
      return eq(userWord.state, 0)
    case 'mastered':
      return eq(userWord.state, 4)
    case 'due':
      return and(inArray(userWord.state, STATE_IN_SCHEDULE), isNotNull(userWord.due), lt(userWord.due, nd))
    case 'memorizing':
      return and(
        inArray(userWord.state, STATE_IN_SCHEDULE),
        or(isNull(userWord.due), gte(userWord.due, nd)),
      )
  }
}

/** 段内排序：新词/标熟按加入序（joinTime），待复习/记忆中按到期（due）。 */
function segmentOrder(segment: WordSegment) {
  return segment === 'due' || segment === 'memorizing'
    ? [userWord.due, userWord.dictId]
    : [userWord.joinTime, userWord.dictId]
}

// ────────────────── 选词加入（显式建行 state=0，db/04） ──────────────────

/**
 * 选词加入词库：显式建行 state=0、dirty=1、打 editTime + joinTime（加入即两者同值）。重复加入幂等：
 * 已在库的未删行**保持不动**（不重置学习状态）；墓碑行**复活**——重置为 state=0 + 新 editTime/joinTime（db/04）。
 * 一批共用同一个 joinTime（批内加入序不细分，落 dictId 兜底），保证稳定加入序不受后续评分覆盖 editTime 影响。
 */
export async function addWords(db: Db, dictIds: readonly number[], editTime: number): Promise<void> {
  if (dictIds.length === 0) return
  const fresh = {
    due: null,
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    lastReview: null,
    joinTime: editTime,
    editTime,
    isDeleted: 0,
    dirty: 1,
  }
  const stmts = dictIds.map((dictId) =>
    db
      .insert(userWord)
      .values({ dictId, ...fresh })
      .onConflictDoUpdate({
        target: userWord.dictId,
        set: fresh,
        // 仅墓碑行复活；非删行保持不动（已加入幂等，不洗掉已学状态）。
        setWhere: eq(userWord.isDeleted, 1),
      }),
  )
  await runBatch(db, stmts)
}

/**
 * 移出词库：置墓碑（is_deleted=1）传播删除，不做物理 DELETE（否则删除传播不到别端，notes.ts 同理，db/04）。
 * FSRS 九字段 / joinTime 保留（复活由 addWords 重置为 state=0 + 新 joinTime）；已加入未删行才动，幂等。dirty + editTime。
 */
export async function removeWords(db: Db, dictIds: readonly number[], editTime: number): Promise<void> {
  if (dictIds.length === 0) return
  const stmts = dictIds.map((dictId) =>
    db
      .update(userWord)
      .set({ isDeleted: 1, editTime, dirty: 1 })
      .where(and(eq(userWord.dictId, dictId), eq(userWord.isDeleted, 0))),
  )
  await runBatch(db, stmts)
}

// ────────────────── 词表（四段 + 前缀搜索，words.md） ──────────────────

/**
 * 转义 LIKE 前缀搜索里的通配符（`%` `_` 与转义符 `\` 本身），配合 SQL 的 `ESCAPE '\'` 子句，
 * 使其按字面匹配——否则用户搜「50%」的 `%` 会被当通配符，连「5000」一并命中（bound 参数无注入风险，仅结果错）。
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** 前缀搜索谓词：lower(term) LIKE lower(转义后)||'%' ESCAPE '\'（尾 % 为字面通配，保留前缀语义）。 */
function searchCond(search: string) {
  return sql`lower(${dict.term}) like lower(${escapeLike(search)}) || '%' escape '\\'`
}

/**
 * 词表分段列表：某段的词 + 冗余 term（LEFT JOIN dict，缺行 term=null 占位参与列表）。
 * 前缀搜索大小写不敏感（lower(term) LIKE lower(?)||'%'，缺行词因 term 为 null 不参与搜索命中）。
 */
export async function listSegment(
  db: Db,
  segment: WordSegment,
  now: number,
  opts?: { search?: string; limit?: number; offset?: number },
): Promise<WordListItem[]> {
  const nd = nextDayAt(now)
  let cond = and(eq(userWord.isDeleted, 0), segmentCond(segment, nd))
  if (opts?.search) {
    cond = and(cond, searchCond(opts.search))
  }
  let q = db
    .select({
      dictId: userWord.dictId,
      term: dict.term,
      state: userWord.state,
      due: userWord.due,
    })
    .from(userWord)
    .leftJoin(dict, eq(dict.dictId, userWord.dictId))
    .where(cond)
    .orderBy(...segmentOrder(segment))
    .$dynamic()
  if (opts?.limit != null) q = q.limit(opts.limit)
  if (opts?.offset != null) q = q.offset(opts.offset)
  return q.all()
}

/**
 * 「全部」段列表（词表 tab「全部」）：所有未删词库行 + 冗余 term（LEFT JOIN dict），按加入序（joinTime）。
 * 与四段并列的第五个 UI tab；四段互斥全覆盖，「全部」= 四段之并（不另立段谓词，避免口径分叉）。
 */
export async function listAll(
  db: Db,
  opts?: { search?: string; limit?: number; offset?: number },
): Promise<WordListItem[]> {
  let cond = eq(userWord.isDeleted, 0)
  if (opts?.search) {
    cond = and(cond, searchCond(opts.search))!
  }
  let q = db
    .select({ dictId: userWord.dictId, term: dict.term, state: userWord.state, due: userWord.due })
    .from(userWord)
    .leftJoin(dict, eq(dict.dictId, userWord.dictId))
    .where(cond)
    .orderBy(userWord.joinTime, userWord.dictId)
    .$dynamic()
  if (opts?.limit != null) q = q.limit(opts.limit)
  if (opts?.offset != null) q = q.offset(opts.offset)
  return q.all()
}

/** 四段计数（词表 tab 徽标 / 首页数字，与 listSegment 同口径保证互斥全覆盖）。 */
export async function segmentCounts(db: Db, now: number): Promise<SegmentCounts> {
  const nd = nextDayAt(now)
  const countOf = async (segment: WordSegment): Promise<number> =>
    (
      await db
        .select({ n: count() })
        .from(userWord)
        .where(and(eq(userWord.isDeleted, 0), segmentCond(segment, nd)))
        .get()
    )?.n ?? 0
  return {
    new: await countOf('new'),
    due: await countOf('due'),
    memorizing: await countOf('memorizing'),
    mastered: await countOf('mastered'),
  }
}

// ────────────────── 单条状态读（评分读旧值 / 选词页批量判定） ──────────────────

const recordColumns = {
  dictId: userWord.dictId,
  due: userWord.due,
  stability: userWord.stability,
  difficulty: userWord.difficulty,
  scheduledDays: userWord.scheduledDays,
  learningSteps: userWord.learningSteps,
  reps: userWord.reps,
  lapses: userWord.lapses,
  state: userWord.state,
  lastReview: userWord.lastReview,
}

/** 一条学习状态（评分前读旧值 / 详情）；墓碑行视同不存在返回 null。 */
export async function getWord(db: Db, dictId: number): Promise<WordRecord | null> {
  const row = await db
    .select(recordColumns)
    .from(userWord)
    .where(and(eq(userWord.dictId, dictId), eq(userWord.isDeleted, 0)))
    .get()
  return row ?? null
}

/** 批量判定「已加入 + 状态」（选词页对整本词条判重）：分块 IN，返回 Map（只含未删行）。 */
export async function getWordStates(
  db: Db,
  dictIds: readonly number[],
): Promise<Map<number, WordStateBrief>> {
  const map = new Map<number, WordStateBrief>()
  const CHUNK = 500
  for (let i = 0; i < dictIds.length; i += CHUNK) {
    const chunk = dictIds.slice(i, i + CHUNK)
    if (chunk.length === 0) continue
    const rows = await db
      .select({ dictId: userWord.dictId, state: userWord.state, due: userWord.due })
      .from(userWord)
      .where(and(inArray(userWord.dictId, chunk), eq(userWord.isDeleted, 0)))
      .all()
    for (const r of rows) map.set(r.dictId, { state: r.state, due: r.due })
  }
  return map
}

/**
 * 按 dict_id 集合取词表行（LEFT JOIN dict 冗余 term + 学习态）：今日学习页两段渲染用（段成员由日志推导）。
 * 分块 IN、只含未删行；按 dictId 稳定排序（入参顺序无关）。空入参返回空。
 */
export async function listByDictIds(db: Db, dictIds: readonly number[]): Promise<WordListItem[]> {
  const items: WordListItem[] = []
  const CHUNK = 500
  for (let i = 0; i < dictIds.length; i += CHUNK) {
    const chunk = dictIds.slice(i, i + CHUNK)
    if (chunk.length === 0) continue
    const rows = await db
      .select({ dictId: userWord.dictId, term: dict.term, state: userWord.state, due: userWord.due })
      .from(userWord)
      .leftJoin(dict, eq(dict.dictId, userWord.dictId))
      .where(and(inArray(userWord.dictId, chunk), eq(userWord.isDeleted, 0)))
      .all()
    items.push(...rows)
  }
  return items.sort((a, b) => a.dictId - b.dictId)
}

// ────────────────── 写：评分落库 / 标熟 / 取消标熟 ──────────────────

/**
 * 评分落库的唯一通道（study.md）：user_word 整行覆盖（本地写，dirty=1、打 editTime）+ user_review_log 追加，
 * 两表语句合入同一 batch 原子提交。FSRS 九字段由 scheduler 算好后传入；日志幂等（同 (dictId, reviewTime) 不重复）。
 */
export async function applyRating(
  db: Db,
  word: WordRecord,
  log: ReviewLogInput,
  editTime: number,
): Promise<void> {
  const fields = {
    due: word.due,
    stability: word.stability,
    difficulty: word.difficulty,
    scheduledDays: word.scheduledDays,
    learningSteps: word.learningSteps,
    reps: word.reps,
    lapses: word.lapses,
    state: word.state,
    lastReview: word.lastReview,
    editTime,
    isDeleted: 0,
    dirty: 1,
  }
  const wordStmt = db
    .insert(userWord)
    .values({ dictId: word.dictId, ...fields })
    .onConflictDoUpdate({ target: userWord.dictId, set: fields })
  await runBatch(db, [wordStmt, appendLogStmt(db, log)])
}

/** 标熟：state=4（自定义态，不参与调度）；保留 FSRS 字段以便取消标熟还原。dirty + editTime。 */
export async function setMastered(db: Db, dictId: number, editTime: number): Promise<void> {
  await db
    .update(userWord)
    .set({ state: 4, editTime, dirty: 1 })
    .where(and(eq(userWord.dictId, dictId), eq(userWord.isDeleted, 0)))
    .run()
}

/**
 * 取消标熟（仅对 state=4 行）：已学过（last_review 非空）回 state=2、due 不变、learning_steps=0；
 * 从未学过（last_review 为空）回 state=0——否则会产生 due=NULL 的 state=2 行脱离四段与队列。dirty + editTime。
 */
export async function unmaster(db: Db, dictId: number, editTime: number): Promise<void> {
  await db
    .update(userWord)
    .set({
      state: sql`case when ${userWord.lastReview} is null then 0 else 2 end`,
      learningSteps: 0,
      editTime,
      dirty: 1,
    })
    .where(and(eq(userWord.dictId, dictId), eq(userWord.state, 4)))
    .run()
}
