// 今日队列与学习会话（study.md「今日队列」「学习流程」「再学一组」「每日记账」）。
// 逐行对齐 anki v3：队列构建 = 新词 + 复习 + 分钟级 intraday，按 new_review_mix 混排（Intersperser）；
// 出卡三段序（到点 intraday → main → learn-ahead 提前放行）；评分后按 due requeue，越次日 4:00 移出；防连出。
// 抽词顺序（study.md「今日队列」）：新词按 new_card_order（random 随机抽 / joinTime 加入序），复习/提前复习
// 固定「按到期日分桶、桶间保先后、同日内 random() 打散」；随机只发生在建队查询、纯内存会话态、不落库不同步。
// 会话是内存态（StudySession）；DB 只在构建取卡与 rate 落库时触碰（drizzle，无裸 SQL）。额度与统计一律日志推导。
import { and, desc, eq, gt, gte, lt, notExists, notInArray, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { dict, userReviewLog, userWord } from '@/db/schema'
import { State } from 'ts-fsrs'
import { dayWindow } from '../time'
import { todayNewCount, todayReviewCount } from '../reviewLog'
import { applyRating, getWord } from '../words'
import { schedule, type RateGrade } from './fsrs'
import type { ReviewLogInput, WordRecord } from '../types'
import type { Settings } from '@/settings'

/** learn-ahead 提前放行窗口（study.md「今日队列」，固定 20 分钟，不暴露设置）。 */
export const LEARN_AHEAD_MS = 20 * 60 * 1000
/** duration_ms 上限截断（study.md §每日记账，出示到评分提交，>60s 视作离开截断）。 */
const MAX_DURATION_MS = 60_000

/** 自定义态 Mastered=4（不在 ts-fsrs State 枚举内；不参与调度，仅四段与查询过滤用）。 */
const MASTERED = 4

/** 队列项类别（顶栏「新·学·复」三计数与当前卡下划线高亮，study.md「学习页顶栏」）。 */
export type QueueKind = 'new' | 'review' | 'learning'

/**
 * 主队列一项（新词 due=null / 复习 due=到期时刻）。出卡只认 dictId，due 仅供排序诊断；
 * kind 供顶栏三计数即时派生（取数时打标，见 selectNew/selectReview/extraGroup）。
 */
export interface QueueItem {
  dictId: number
  due: number | null
  kind: QueueKind
}
/** intraday 一项：real due 判到点、sortDue 供会话内排序（防连出会让 sortDue > due）。 */
interface IntradayItem {
  dictId: number
  due: number
  sortDue: number
}

// ────────────────── 队列取数（各队 INNER JOIN dict：缺行词顺延不出，cache/wordbook.md） ──────────────────

/**
 * 新词队列：state=0 取 limit（limit<=0 直接空，不打 DB）；打标 kind='new'（study.md「今日队列」）。
 * order='joinTime' 按 join_time 升序（加入序、dictId 决胜）；order='random' 用 SQLite random() 抽签——
 * 额度<候选池时随机抽哪些词入队（等同 anki random gather），今日未中的词仍在池、后续必然轮到。
 */
async function selectNew(
  db: Db,
  limit: number,
  order: Settings['newCardOrder'],
): Promise<QueueItem[]> {
  if (limit <= 0) return []
  const orderBy = order === 'random' ? [sql`random()`] : [userWord.joinTime, userWord.dictId]
  const rows = await db
    .select({ dictId: userWord.dictId, due: userWord.due })
    .from(userWord)
    .innerJoin(dict, eq(dict.dictId, userWord.dictId))
    .where(and(eq(userWord.isDeleted, 0), eq(userWord.state, State.New)))
    .orderBy(...orderBy)
    .limit(limit)
    .all()
  return rows.map((r) => ({ dictId: r.dictId, due: r.due, kind: 'new' }))
}

/**
 * 复习队列：全局到期（state∈{1,2,3} 且 due<nd）减去分钟级 intraday（state∈{1,3} 且 scheduled_days=0）。
 * = state=2 或 scheduled_days>0（天级卡：Review 与跨日学习步）。排序键 = (逾期天数降序, random())，
 * 先排序后 LIMIT：积压时更逾期的日桶永远优先入队，随机只在同一日桶内起作用（study.md「今日队列」）。
 */
async function selectReview(db: Db, limit: number, nd: number): Promise<QueueItem[]> {
  if (limit <= 0) return []
  const rows = await db
    .select({ dictId: userWord.dictId, due: userWord.due, state: userWord.state })
    .from(userWord)
    .innerJoin(dict, eq(dict.dictId, userWord.dictId))
    .where(
      and(
        eq(userWord.isDeleted, 0),
        gt(userWord.state, State.New),
        lt(userWord.state, MASTERED),
        lt(userWord.due, nd),
        // 排除分钟级 intraday（state∈{1,3} 且 scheduled_days=0）
        sql`(${userWord.state} = ${State.Review} or ${userWord.scheduledDays} > 0)`,
      ),
    )
    .orderBy(reviewBucketDesc(nd), sql`random()`)
    .limit(limit)
    .all()
  // 打标：state=2 → 复；state∈{1,3}（此队仅含 scheduled_days>0 的跨日步卡）→ 学
  // （对齐 anki：interday learning 计入 learning，不计 review）。
  return rows.map((r) => ({
    dictId: r.dictId,
    due: r.due,
    kind: r.state === State.Review ? 'review' : 'learning',
  }))
}

/** 分钟级学习步卡（中途重建会话场景）：state∈{1,3} 且 scheduled_days=0 且 due<nd，按 due 升序，不限量、不占额度。 */
async function selectIntraday(db: Db, nd: number): Promise<IntradayItem[]> {
  const rows = await db
    .select({ dictId: userWord.dictId, due: userWord.due })
    .from(userWord)
    .innerJoin(dict, eq(dict.dictId, userWord.dictId))
    .where(
      and(
        eq(userWord.isDeleted, 0),
        sql`${userWord.state} in (${State.Learning}, ${State.Relearning})`,
        eq(userWord.scheduledDays, 0),
        lt(userWord.due, nd),
      ),
    )
    .orderBy(userWord.due, userWord.dictId)
    .all()
  return rows.map((r) => ({ dictId: r.dictId, due: r.due as number, sortDue: r.due as number }))
}

// ────────────────── 穿插（逐行对齐 anki intersperser.rs；实参顺序不可颠倒：one=复习基准） ──────────────────

/** 均匀穿插两队（one=复习、two=新词）：ratio 以复习队列为基准，长队优先起头。 */
export function intersperse<T>(one: readonly T[], two: readonly T[]): T[] {
  const ratio = (one.length + 1) / (two.length + 1)
  const out: T[] = []
  let i = 0
  let j = 0
  while (i < one.length || j < two.length) {
    if (i >= one.length) out.push(two[j++])
    else if (j >= two.length) out.push(one[i++])
    else if ((j + 1) * ratio < i + 1) out.push(two[j++])
    else out.push(one[i++])
  }
  return out
}

// ────────────────── 学习会话（内存态，对齐 anki CardQueues） ──────────────────

/**
 * 出卡结果：card=出一张（cardKind 供顶栏当前类别下划线，与 counts() 同一快照）、
 * done=今日完成（进再学一组）、stale=跨窗口须重建。
 */
export type NextCard =
  | { kind: 'card'; dictId: number; cardKind: QueueKind }
  | { kind: 'done' }
  | { kind: 'stale' }

export class StudySession {
  private mainIdx = 0
  /** 本会话出过的词（再学一组「继续学习」排除已出词）。 */
  readonly served = new Set<number>()

  constructor(
    private readonly main: QueueItem[],
    private readonly intraday: IntradayItem[],
    readonly windowEnd: number,
  ) {}

  /** 出卡三段序（study.md「出卡顺序与重建」）：到点 intraday → main → learn-ahead 提前放行。 */
  nextCard(now: number): NextCard {
    if (now >= this.windowEnd) return { kind: 'stale' }
    // 段1：到点的分钟级学习卡（real due<=now）最优先。front 按 sortDue，到点卡 sortDue==due。intraday 恒属「学」。
    if (this.intraday.length > 0 && this.intraday[0].due <= now) {
      return this.serve(this.intraday.shift()!.dictId, 'learning')
    }
    // 段2：主队列（新词+复习混排），当前卡类别 = 条目 kind。
    if (this.mainIdx < this.main.length) {
      const item = this.main[this.mainIdx++]
      return this.serve(item.dictId, item.kind)
    }
    // 段3：main 空后，intraday 中 sortDue<=now+20min 的卡提前放行（learn-ahead）。
    if (this.intraday.length > 0 && this.intraday[0].sortDue <= now + LEARN_AHEAD_MS) {
      return this.serve(this.intraday.shift()!.dictId, 'learning')
    }
    return { kind: 'done' }
  }

  private serve(dictId: number, cardKind: QueueKind): NextCard {
    this.served.add(dictId)
    return { kind: 'card', dictId, cardKind }
  }

  /**
   * 顶栏三计数（study.md「学习页顶栏」）：即时从会话队列派生、零 SQL，不设分母、不维护计数器。
   * 新 = main 未出段中 kind='new'；学 = intraday 全量 + main 未出段中 kind='learning'；复 = main 未出段中 kind='review'。
   * 每次出卡前读一次，含屏幕上这张卡；三数全零 ⟺ 今日完成。
   */
  counts(): { new: number; learning: number; review: number } {
    let newN = 0
    let learning = 0
    let review = 0
    for (let i = this.mainIdx; i < this.main.length; i++) {
      const k = this.main[i].kind
      if (k === 'new') newN++
      else if (k === 'learning') learning++
      else review++
    }
    return { new: newN, learning: learning + this.intraday.length, review }
  }

  /**
   * 评分后回插（study.md「队列内循环」）：新 due 仍在今日窗口（分钟级步）→ 按 sortDue 排回 intraday；
   * 越过次日 4:00 或无 due → 移出。防连出：main 已空 + 落在 learn-ahead 窗口 + 会排到队首 →
   * sortDue 视作「下一张卡 sortDue + 1s」排第二（仅会话内排序键，不落库）。
   */
  requeue(next: WordRecord, now: number): void {
    const due = next.due
    if (due == null || due >= this.windowEnd) return // 天级/毕业卡移出本次队列
    let sortDue = due
    const mainExhausted = this.mainIdx >= this.main.length
    if (
      mainExhausted &&
      due <= now + LEARN_AHEAD_MS &&
      this.intraday.length > 0 &&
      due <= this.intraday[0].sortDue
    ) {
      sortDue = this.intraday[0].sortDue + 1000
    }
    this.insertIntraday({ dictId: next.dictId, due, sortDue })
  }

  /** 按 sortDue 升序二分插入 intraday。 */
  private insertIntraday(item: IntradayItem): void {
    let lo = 0
    let hi = this.intraday.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.intraday[mid].sortDue <= item.sortDue) lo = mid + 1
      else hi = mid
    }
    this.intraday.splice(lo, 0, item)
  }

  /** 再学一组：把新一组卡追加到主队列尾（mainIdx 不动，nextCard 从完成态恢复出卡）。 */
  appendGroup(items: QueueItem[]): void {
    this.main.push(...items)
  }

  /**
   * 标熟：把某词移出本次队列并计入当组完成（study.md「标熟」，不评分不记日志）。
   * 已出的当前卡本就不在队列，此处兜底清 intraday 与未出主队列中的残留（如从词表标熟队列内的词）。
   */
  drop(dictId: number): void {
    const k = this.intraday.findIndex((x) => x.dictId === dictId)
    if (k >= 0) this.intraday.splice(k, 1)
    for (let x = this.main.length - 1; x >= this.mainIdx; x--) {
      if (this.main[x].dictId === dictId) this.main.splice(x, 1)
    }
  }
}

// ────────────────── 构建今日会话 ──────────────────

/**
 * 进入学习页构建今日会话：额度 = 上限 − 今日已学数（日志推导）；分钟级 intraday 不占额度、不进 main。
 * main 按 new_review_mix 混排。校准钟 now 由门面传入。
 */
export async function buildTodaySession(
  db: Db,
  settings: Settings,
  now: number,
): Promise<StudySession> {
  const win = dayWindow(now)
  const nd = win.endMs
  const [newDone, reviewDone] = await Promise.all([
    todayNewCount(db, win.startMs, win.endMs),
    todayReviewCount(db, win.startMs, win.endMs),
  ])
  const newLimit = Math.max(0, settings.newPerDay - newDone)
  const revLimit = Math.max(0, settings.reviewsPerDay - reviewDone)

  const [intraday, newQ, reviewQ] = await Promise.all([
    selectIntraday(db, nd),
    selectNew(db, newLimit, settings.newCardOrder),
    selectReview(db, revLimit, nd),
  ])

  let main: QueueItem[]
  switch (settings.newReviewMix) {
    case 'newFirst':
      main = [...newQ, ...reviewQ]
      break
    case 'reviewFirst':
      main = [...reviewQ, ...newQ]
      break
    default: // 'mix'：均匀穿插，one=复习、two=新词
      main = intersperse(reviewQ, newQ)
  }
  return new StudySession(main, intraday, nd)
}

// ────────────────── 评分编排（评分落库唯一路径） ──────────────────

export interface RateInput {
  dictId: number
  rating: RateGrade
  durationMs: number
  /** 出卡时的 reps 快照（防重复评分：与行当前 reps 不等即幂等丢弃，对齐 anki answering）。 */
  snapshotReps: number
}
export type RateResult = { kind: 'rated'; word: WordRecord } | { kind: 'discarded'; reason: string }

/**
 * 评分：读行 → 断言可调度 → 防重复评分 → ts-fsrs 算九字段 → applyRating 整行+日志合批原子落库 → 会话回插。
 * 评分后不做同步通知（sync.md §3.4 触发保守化）；dirty=1 由下一同步回合带走。session 为空则跳过回插（诊断/单元路径）。
 */
export async function rate(
  db: Db,
  session: StudySession | null,
  input: RateInput,
  now: number,
): Promise<RateResult> {
  const word = await getWord(db, input.dictId)
  if (!word) return { kind: 'discarded', reason: 'gone' } // 行被墓碑/删除
  if (word.state < State.New || word.state > State.Relearning) {
    return { kind: 'discarded', reason: 'unschedulable' } // state=4 标熟态不评分
  }
  if (word.reps !== input.snapshotReps) {
    return { kind: 'discarded', reason: 'stale' } // 双击/过期卡（别端已改 reps）
  }
  const { next, log } = schedule(word, now, input.rating)
  const logInput: ReviewLogInput = {
    dictId: input.dictId,
    reviewTime: log.reviewTime,
    rating: input.rating,
    durationMs: Math.min(MAX_DURATION_MS, Math.max(0, input.durationMs)),
    preState: log.preState,
    preStability: log.preStability,
    preDifficulty: log.preDifficulty,
  }
  await applyRating(db, next, logInput, now)
  session?.requeue(next, now)
  return { kind: 'rated', word: next }
}

// ────────────────── 再学一组取卡（不受额度限制；评分照常走 rate 计入今日数字） ──────────────────

export type ExtraKind = 'learn' | 'review' | 'ahead'
export interface ExtraCounts {
  learn: number
  review: number
  ahead: number
}

/**
 * 某选项的可用词条（追加到会话主队列）；exclude 供「继续学习」排除本会话已出词。
 * 打标：learn → 'new'，review / ahead → 'review'（顶栏三计数随再学一组上浮）。
 * order 仅 learn 分支消费（新词抽取顺序，同 selectNew）；review/ahead 固定分桶随机。
 */
export async function extraGroup(
  db: Db,
  kind: ExtraKind,
  size: number,
  now: number,
  exclude: ReadonlySet<number>,
  order: Settings['newCardOrder'],
): Promise<QueueItem[]> {
  if (size <= 0) return []
  const win = dayWindow(now)
  const nd = win.endMs
  let rows: { dictId: number; due: number | null }[]
  if (kind === 'learn') {
    const excl = [...exclude]
    const orderBy = order === 'random' ? [sql`random()`] : [userWord.joinTime, userWord.dictId]
    rows = await db
      .select({ dictId: userWord.dictId, due: userWord.due })
      .from(userWord)
      .innerJoin(dict, eq(dict.dictId, userWord.dictId))
      .where(
        and(
          eq(userWord.isDeleted, 0),
          eq(userWord.state, State.New),
          excl.length > 0 ? notInArray(userWord.dictId, excl) : undefined,
        ),
      )
      .orderBy(...orderBy)
      .limit(size)
      .all()
  } else if (kind === 'review') {
    rows = await db
      .select({ dictId: userWord.dictId, due: userWord.due })
      .from(userWord)
      .innerJoin(dict, eq(dict.dictId, userWord.dictId))
      .where(and(scheduledDue(nd, true), noReviewLogToday(db, win.startMs, win.endMs)))
      .orderBy(reviewBucketDesc(nd), sql`random()`)
      .limit(size)
      .all()
  } else {
    // ahead：未到期（due>=nd），最近的未来天优先、同日内随机（study.md 未要求排除已出/已评，遵从规格）
    rows = await db
      .select({ dictId: userWord.dictId, due: userWord.due })
      .from(userWord)
      .innerJoin(dict, eq(dict.dictId, userWord.dictId))
      .where(and(scheduledDue(nd, false)))
      .orderBy(aheadBucketAsc(nd), sql`random()`)
      .limit(size)
      .all()
  }
  const itemKind: QueueKind = kind === 'learn' ? 'new' : 'review'
  return rows.map((r) => ({ dictId: r.dictId, due: r.due, kind: itemKind }))
}

/** 三选项可用数量（完成态面板一并返回）。 */
export async function extraCounts(
  db: Db,
  now: number,
  exclude: ReadonlySet<number>,
): Promise<ExtraCounts> {
  const win = dayWindow(now)
  const nd = win.endMs
  const excl = [...exclude]
  const learnRow = await db
    .select({ n: sql<number>`count(*)` })
    .from(userWord)
    .innerJoin(dict, eq(dict.dictId, userWord.dictId))
    .where(
      and(
        eq(userWord.isDeleted, 0),
        eq(userWord.state, State.New),
        excl.length > 0 ? notInArray(userWord.dictId, excl) : undefined,
      ),
    )
    .get()
  const reviewRow = await db
    .select({ n: sql<number>`count(*)` })
    .from(userWord)
    .innerJoin(dict, eq(dict.dictId, userWord.dictId))
    .where(and(scheduledDue(nd, true), noReviewLogToday(db, win.startMs, win.endMs)))
    .get()
  const aheadRow = await db
    .select({ n: sql<number>`count(*)` })
    .from(userWord)
    .innerJoin(dict, eq(dict.dictId, userWord.dictId))
    .where(and(scheduledDue(nd, false)))
    .get()
  return { learn: learnRow?.n ?? 0, review: reviewRow?.n ?? 0, ahead: aheadRow?.n ?? 0 }
}

/**
 * 复习分桶排序键（study.md「今日队列」）：逾期天数降序 → 更逾期的日桶优先，同桶内交由 random() 打散。
 * bucket = (nd − 1 − due) / 86_400_000（SQLite 整除；该队恒有 due<nd 故分子非负 = floor）：今日窗口=0、昨日=1…。
 * 已知边角（接受）：固定 86_400_000 除数对 DST 变换周、4:00 边界 ±1 小时内的卡可能错桶一天；中国无 DST，
 * 且错桶后果仅是同日排序归属、无调度影响。
 */
function reviewBucketDesc(nd: number) {
  return desc(sql`(${nd} - 1 - ${userWord.due}) / 86400000`)
}

/** 提前复习分桶排序键：方向相反——(due − nd)/86_400_000 升序，最近的未来天优先；同桶内交由 random()。 */
function aheadBucketAsc(nd: number) {
  return sql`(${userWord.due} - ${nd}) / 86400000`
}

/** 调度态到期/未到期谓词：due<nd（到期）或 due>=nd（未到期）；均 state∈{1,2,3} 排除标熟。 */
function scheduledDue(nd: number, dueBefore: boolean) {
  return and(
    eq(userWord.isDeleted, 0),
    gt(userWord.state, State.New),
    lt(userWord.state, MASTERED),
    dueBefore ? lt(userWord.due, nd) : gte(userWord.due, nd),
  )
}

/** 关联子查询：该词今日窗口内无复习日志（继续复习排除今日已复习）。 */
function noReviewLogToday(db: Db, startMs: number, endMs: number) {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(userReviewLog)
      .where(
        and(
          eq(userReviewLog.dictId, userWord.dictId),
          gte(userReviewLog.reviewTime, startMs),
          lt(userReviewLog.reviewTime, endMs),
        ),
      ),
  )
}
