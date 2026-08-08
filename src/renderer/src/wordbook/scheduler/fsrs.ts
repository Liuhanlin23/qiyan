// FSRS-6 封装（ts-fsrs@5.4.1）：本产品调度的唯一算法入口。规格 study.md「核心口径·FSRS 参数」。
// 职责纯粹：行 ↔ Card 映射 + next/repeat 薄封装 + 三条实测防线断言。不碰 db、不碰会话、不碰 UI。
// 多端一致靠「同输入逐位一致」：enable_fuzz=false + 显式全默认参数 + due 直传 epoch ms（库内 stability/difficulty
// 已 8 位小数舍入，与列精度对齐）。评分前快照（pre_*）取自 ts-fsrs 的 log（buildLog 用评分前 this.current）。
import {
  createEmptyCard,
  FSRS,
  type CardInput,
  type FSRSParameters,
  type Grade,
  Rating,
  State,
} from 'ts-fsrs'
import type { ReviewLogInput, WordRecord } from '../types'

/**
 * 显式写全的 FSRS-6 配置（全部等于库默认，study.md「FSRS 参数」）：绝不给 request_retention/maximum_interval 传 0（库用 `||` 取默认会静默回落，
 * 掩盖误配）。w 为 FSRS-6 默认 21 权重的显式副本；配置漂移由 scheduler.test.ts 的
 * `expect(OUR_PARAMS).toEqual(generatorParameters({}))` 断言守卫（升包即失败）。
 */
export const OUR_PARAMS: FSRSParameters = {
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
  w: [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
    0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
  ],
}

/** 三档评分（产品层枚举与库枚举同值直传）：不认识→Again(1)、模糊→Hard(2)、认识→Good(3)。Easy 不使用。 */
export type RateGrade = Rating.Again | Rating.Hard | Rating.Good

const f = new FSRS(OUR_PARAMS)

/** 可调度态（New/Learning/Review/Relearning）。state=4（Mastered）喂 next()/repeat() 会静默返回 undefined。 */
function assertSchedulable(state: number, where: string): void {
  if (state < State.New || state > State.Relearning) {
    throw new Error(`[fsrs] ${where}: state=${state} 不可参与调度（仅 0-3；state=4 须在入口拦截）`)
  }
}

/**
 * 行 → CardInput 映射（仅非 New 行；state=0 走 createEmptyCard，due 为 NULL 无法拼卡）。
 * elapsed_days 占位 0（类型必填、值不参与调度，库内按 last_review→now 自行重算 elapsed）。
 */
function rowToCard(word: WordRecord): CardInput {
  return {
    due: word.due as number, // 非 New 行 due 必非空
    stability: word.stability,
    difficulty: word.difficulty,
    elapsed_days: 0,
    scheduled_days: word.scheduledDays,
    learning_steps: word.learningSteps,
    reps: word.reps,
    lapses: word.lapses,
    state: word.state as State,
    last_review: word.lastReview ?? undefined,
  }
}

/** 行（或 New 占位）→ 当前时刻的 Card 输入。 */
function toCardInput(word: WordRecord, now: number): CardInput {
  assertSchedulable(word.state, 'toCardInput')
  return word.state === State.New ? (createEmptyCard(now) as CardInput) : rowToCard(word)
}

export interface ScheduleResult {
  /** 评分后落库的整行九字段（dictId 沿用输入）。 */
  next: WordRecord
  /** 追加日志载荷除 dictId/rating/durationMs 外的部分（reviewTime + 评分前快照）。 */
  log: Pick<ReviewLogInput, 'reviewTime' | 'preState' | 'preStability' | 'preDifficulty'>
}

/**
 * 评分调度（唯一 next 封装）：给定评分前行 + now + 三档评分，产出评分后整行 + 日志快照。
 * 纯计算，不落库（落库由 words.applyRating 合批）。state=4 由 assertSchedulable 拦截抛错。
 */
export function schedule(word: WordRecord, now: number, rating: RateGrade): ScheduleResult {
  const card = toCardInput(word, now)
  const { card: c, log } = f.next(card, now, rating as Grade)
  return {
    next: {
      dictId: word.dictId,
      due: c.due.getTime(),
      stability: c.stability,
      difficulty: c.difficulty,
      scheduledDays: c.scheduled_days,
      learningSteps: c.learning_steps,
      reps: c.reps,
      lapses: c.lapses,
      state: c.state,
      lastReview: c.last_review ? c.last_review.getTime() : null,
    },
    // log 的 state/stability/difficulty 即评分前 this.current 快照（ts-fsrs buildLog），直接映射 pre_*。
    log: {
      reviewTime: log.review.getTime(),
      preState: log.state,
      preStability: log.stability,
      preDifficulty: log.difficulty,
    },
  }
}

/**
 * 三档下次到期时刻（epoch ms）预演（评分按钮间隔预览用）：repeat() 一次取三档。
 * 与 schedule 复用同一映射：state=0 走 createEmptyCard、state=4 断言禁入（repeat 内部同为 per-grade review()）。
 */
export function previewDueDates(word: WordRecord, now: number): Record<RateGrade, number> {
  const card = toCardInput(word, now)
  const rec = f.repeat(card, now)
  return {
    [Rating.Again]: rec[Rating.Again].card.due.getTime(),
    [Rating.Hard]: rec[Rating.Hard].card.due.getTime(),
    [Rating.Good]: rec[Rating.Good].card.due.getTime(),
  }
}
