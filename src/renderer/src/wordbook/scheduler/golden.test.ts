// 黄金序列测试（行为冻结）：固定评分序列下 FSRS 九字段 + 日志快照的逐位快照，钉死当前 ts-fsrs@5.4.1 行为。
// 存在意义与 scheduler.test.ts 不同：那边测「规则对不对」（单步语义、队列、落库），这边测「数值变不变」——
// 多端「同输入逐位一致」（study.md「核心口径·FSRS 参数」）靠此守：升包 / 改 OUR_PARAMS / 改 fsrs.ts 映射
// 只要让任一位漂移就红。纯函数，只调 schedule() / previewDueDates()，不碰 DB。
//
// 期望值为显式字面量（不用 toMatchSnapshot——防「一键更新」把回归洗成新基线，且 diff 在 review 里可读）；
// 浮点直接写库输出的完整值（ts-fsrs 内部已 8 位小数舍入，与列精度对齐），不做 toBeCloseTo 弱化。
// 时刻一律写成 NOW + 精确毫秒偏移：FSRS 只吃「两次评分的时间差」，写偏移既可读又与设备时区无关
// （所有偏移均为 24h 整数倍或分钟级步长，UTC 无 DST，elapsed_days 换算恒定）。
//
// 钉值流程（复现方式）：先跑一遍打印实际值 → 人工 sanity check（状态迁移合 study.md、连续 Good 间隔递增、
// 提前复习更短、due 恒大于评分时刻）→ 通过后才写死为字面量。改期望值前请重走这一遍，别为了变绿直接改数。
import { describe, expect, it } from 'vitest'
import { Rating, State } from 'ts-fsrs'
import { previewDueDates, schedule, type RateGrade } from './fsrs'
import type { WordRecord } from '../types'

const MIN = 60_000
const DAY = 24 * 60 * MIN

/** 固定起点：2026-01-15 10:00 本地（与 scheduler.test.ts 同一字面量口径）。 */
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime()

/** 新词行（state=0：due/lastReview 为空、s/d 为 0，schedule 内走 createEmptyCard）。 */
const newWord = (dictId = 1): WordRecord => ({
  dictId,
  due: null,
  stability: 0,
  difficulty: 0,
  scheduledDays: 0,
  learningSteps: 0,
  reps: 0,
  lapses: 0,
  state: State.New,
  lastReview: null,
})

/** 一步黄金快照：评分时刻 + 评分 + 评分后整行九字段 + 日志四字段（全部钉死）。 */
interface GoldenStep {
  at: number
  rating: RateGrade
  next: WordRecord
  log: { reviewTime: number; preState: number; preStability: number; preDifficulty: number }
}

/**
 * 逐步喂 schedule 并逐位比对；同时对**实际输出**（不是字面量之间）做结构性 sanity：
 * 日志 = 评分前整行快照、reps 每步 +1、lastReview = 评分时刻、due 恒大于评分时刻。
 * 返回每步实际产出行，供序列级断言（间隔递增等）复用。
 */
function runGolden(start: WordRecord, steps: readonly GoldenStep[]): WordRecord[] {
  const rows: WordRecord[] = []
  let cur = start
  steps.forEach((s, i) => {
    const r = schedule(cur, s.at, s.rating)
    const tag = `step${i + 1}`
    // 日志四字段 = 评分前那一行的快照（pre_* 推导的唯一依据，study.md §每日记账）
    expect(r.log, `${tag} log`).toEqual({
      reviewTime: s.at,
      preState: cur.state,
      preStability: cur.stability,
      preDifficulty: cur.difficulty,
    })
    expect(r.next.reps, `${tag} reps+1`).toBe(cur.reps + 1)
    expect(r.next.lastReview, `${tag} lastReview`).toBe(s.at)
    expect(r.next.due, `${tag} due>at`).toBeGreaterThan(s.at)
    // 逐位钉死
    expect(r.next, `${tag} next`).toEqual(s.next)
    expect(r.log, `${tag} log(golden)`).toEqual(s.log)
    rows.push(r.next)
    cur = r.next
  })
  return rows
}

/** 按期序列自检：除首步外，每步评分时刻 = 上一步钉死的 due。 */
function expectOnTime(steps: readonly GoldenStep[]): void {
  steps.slice(1).forEach((s, i) => expect(s.at, `step${i + 2} at=prev.due`).toBe(steps[i].next.due))
}

const scheduledDaysOf = (rows: readonly WordRecord[]): number[] => rows.map((r) => r.scheduledDays)

// ══════════════════ 序列 1：顺利毕业（新卡 Good 走两步 → 毕业 → 按期 Good ×5） ══════════════════

const G1: GoldenStep[] = [
  {
    at: NOW,
    rating: Rating.Good,
    next: {
      dictId: 1,
      due: NOW + 10 * MIN,
      stability: 2.3065,
      difficulty: 2.11810397,
      scheduledDays: 0,
      learningSteps: 1,
      reps: 1,
      lapses: 0,
      state: State.Learning,
      lastReview: NOW,
    },
    log: { reviewTime: NOW, preState: State.New, preStability: 0, preDifficulty: 0 },
  },
  {
    at: NOW + 10 * MIN,
    rating: Rating.Good,
    next: {
      dictId: 1,
      due: NOW + 2 * DAY + 10 * MIN,
      stability: 2.3065,
      difficulty: 2.11121424,
      scheduledDays: 2,
      learningSteps: 0,
      reps: 2,
      lapses: 0,
      state: State.Review,
      lastReview: NOW + 10 * MIN,
    },
    log: {
      reviewTime: NOW + 10 * MIN,
      preState: State.Learning,
      preStability: 2.3065,
      preDifficulty: 2.11810397,
    },
  },
  {
    at: NOW + 2 * DAY + 10 * MIN,
    rating: Rating.Good,
    next: {
      dictId: 1,
      due: NOW + 13 * DAY + 10 * MIN,
      stability: 10.97104786,
      difficulty: 2.1043314,
      scheduledDays: 11,
      learningSteps: 0,
      reps: 3,
      lapses: 0,
      state: State.Review,
      lastReview: NOW + 2 * DAY + 10 * MIN,
    },
    log: {
      reviewTime: NOW + 2 * DAY + 10 * MIN,
      preState: State.Review,
      preStability: 2.3065,
      preDifficulty: 2.11121424,
    },
  },
  {
    at: NOW + 13 * DAY + 10 * MIN,
    rating: Rating.Good,
    next: {
      dictId: 1,
      due: NOW + 59 * DAY + 10 * MIN,
      stability: 46.31685657,
      difficulty: 2.09745544,
      scheduledDays: 46,
      learningSteps: 0,
      reps: 4,
      lapses: 0,
      state: State.Review,
      lastReview: NOW + 13 * DAY + 10 * MIN,
    },
    log: {
      reviewTime: NOW + 13 * DAY + 10 * MIN,
      preState: State.Review,
      preStability: 10.97104786,
      preDifficulty: 2.1043314,
    },
  },
  {
    at: NOW + 59 * DAY + 10 * MIN,
    rating: Rating.Good,
    next: {
      dictId: 1,
      due: NOW + 222 * DAY + 10 * MIN,
      stability: 162.99981459,
      difficulty: 2.09058635,
      scheduledDays: 163,
      learningSteps: 0,
      reps: 5,
      lapses: 0,
      state: State.Review,
      lastReview: NOW + 59 * DAY + 10 * MIN,
    },
    log: {
      reviewTime: NOW + 59 * DAY + 10 * MIN,
      preState: State.Review,
      preStability: 46.31685657,
      preDifficulty: 2.09745544,
    },
  },
  {
    at: NOW + 222 * DAY + 10 * MIN,
    rating: Rating.Good,
    next: {
      dictId: 1,
      due: NOW + 720 * DAY + 10 * MIN,
      stability: 497.87655983,
      difficulty: 2.08372413,
      scheduledDays: 498,
      learningSteps: 0,
      reps: 6,
      lapses: 0,
      state: State.Review,
      lastReview: NOW + 222 * DAY + 10 * MIN,
    },
    log: {
      reviewTime: NOW + 222 * DAY + 10 * MIN,
      preState: State.Review,
      preStability: 162.99981459,
      preDifficulty: 2.09058635,
    },
  },
  {
    at: NOW + 720 * DAY + 10 * MIN,
    rating: Rating.Good,
    next: {
      dictId: 1,
      due: NOW + 2068 * DAY + 10 * MIN,
      stability: 1347.91860929,
      difficulty: 2.07686878,
      scheduledDays: 1348,
      learningSteps: 0,
      reps: 7,
      lapses: 0,
      state: State.Review,
      lastReview: NOW + 720 * DAY + 10 * MIN,
    },
    log: {
      reviewTime: NOW + 720 * DAY + 10 * MIN,
      preState: State.Review,
      preStability: 497.87655983,
      preDifficulty: 2.08372413,
    },
  },
]

// ══════════════════ 序列 2：步内挫折（新卡 Again → Good → Good 毕业） ══════════════════

const G2: GoldenStep[] = [
  {
    at: NOW,
    rating: Rating.Again,
    next: {
      dictId: 1,
      due: NOW + 1 * MIN,
      stability: 0.212,
      difficulty: 6.4133,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: State.Learning,
      lastReview: NOW,
    },
    log: { reviewTime: NOW, preState: State.New, preStability: 0, preDifficulty: 0 },
  },
  {
    at: NOW + 1 * MIN,
    rating: Rating.Good,
    next: {
      dictId: 1,
      due: NOW + 11 * MIN,
      stability: 0.24668919,
      difficulty: 6.40211507,
      scheduledDays: 0,
      learningSteps: 1,
      reps: 2,
      lapses: 0,
      state: State.Learning,
      lastReview: NOW + 1 * MIN,
    },
    log: {
      reviewTime: NOW + 1 * MIN,
      preState: State.Learning,
      preStability: 0.212,
      preDifficulty: 6.4133,
    },
  },
  {
    at: NOW + 11 * MIN,
    rating: Rating.Good,
    next: {
      dictId: 1,
      due: NOW + 1 * DAY + 11 * MIN,
      stability: 0.28420636,
      difficulty: 6.39094132,
      scheduledDays: 1,
      learningSteps: 0,
      reps: 3,
      lapses: 0,
      state: State.Review,
      lastReview: NOW + 11 * MIN,
    },
    log: {
      reviewTime: NOW + 11 * MIN,
      preState: State.Learning,
      preStability: 0.24668919,
      preDifficulty: 6.40211507,
    },
  },
]

// ══════════════════ 序列 3：遗忘回爬（成熟 Review 评 Again → 重学 → 按期 Good ×3） ══════════════════

/** 成熟复习行：S=20、D=5、按期到期（scheduled_days=20，上次复习在 20 天前）。 */
const MATURE: WordRecord = {
  dictId: 1,
  due: NOW,
  stability: 20,
  difficulty: 5,
  scheduledDays: 20,
  learningSteps: 0,
  reps: 5,
  lapses: 0,
  state: State.Review,
  lastReview: NOW - 20 * DAY,
}

const G3: GoldenStep[] = [
  {
    at: NOW,
    rating: Rating.Again,
    next: {
      dictId: 1,
      due: NOW + 10 * MIN,
      stability: 1.94358119,
      difficulty: 8.34176237,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 6,
      lapses: 1,
      state: State.Relearning,
      lastReview: NOW,
    },
    log: { reviewTime: NOW, preState: State.Review, preStability: 20, preDifficulty: 5 },
  },
  {
    at: NOW + 10 * MIN,
    rating: Rating.Good,
    next: {
      dictId: 1,
      due: NOW + 2 * DAY + 10 * MIN,
      stability: 1.95478854,
      difficulty: 8.32864898,
      scheduledDays: 2,
      learningSteps: 0,
      reps: 7,
      lapses: 1,
      state: State.Review,
      lastReview: NOW + 10 * MIN,
    },
    log: {
      reviewTime: NOW + 10 * MIN,
      preState: State.Relearning,
      preStability: 1.94358119,
      preDifficulty: 8.34176237,
    },
  },
  {
    at: NOW + 2 * DAY + 10 * MIN,
    rating: Rating.Good,
    next: {
      dictId: 1,
      due: NOW + 7 * DAY + 10 * MIN,
      stability: 4.51225999,
      difficulty: 8.3155487,
      scheduledDays: 5,
      learningSteps: 0,
      reps: 8,
      lapses: 1,
      state: State.Review,
      lastReview: NOW + 2 * DAY + 10 * MIN,
    },
    log: {
      reviewTime: NOW + 2 * DAY + 10 * MIN,
      preState: State.Review,
      preStability: 1.95478854,
      preDifficulty: 8.32864898,
    },
  },
  {
    at: NOW + 7 * DAY + 10 * MIN,
    rating: Rating.Good,
    next: {
      dictId: 1,
      due: NOW + 17 * DAY + 10 * MIN,
      stability: 9.97115542,
      difficulty: 8.30246152,
      scheduledDays: 10,
      learningSteps: 0,
      reps: 9,
      lapses: 1,
      state: State.Review,
      lastReview: NOW + 7 * DAY + 10 * MIN,
    },
    log: {
      reviewTime: NOW + 7 * DAY + 10 * MIN,
      preState: State.Review,
      preStability: 4.51225999,
      preDifficulty: 8.3155487,
    },
  },
]

// ══════════════════ 序列 4：连续 Hard（毕业后按期 Hard ×3） ══════════════════

const G4: GoldenStep[] = [
  G1[0], // 新卡 Good（同序列 1 首步）
  G1[1], // Good 毕业（同序列 1 次步）
  {
    at: NOW + 2 * DAY + 10 * MIN,
    rating: Rating.Hard,
    next: {
      dictId: 1,
      due: NOW + 10 * DAY + 10 * MIN,
      stability: 7.51735908,
      difficulty: 4.74828477,
      scheduledDays: 8,
      learningSteps: 0,
      reps: 3,
      lapses: 0,
      state: State.Review,
      lastReview: NOW + 2 * DAY + 10 * MIN,
    },
    log: {
      reviewTime: NOW + 2 * DAY + 10 * MIN,
      preState: State.Review,
      preStability: 2.3065,
      preDifficulty: 2.11121424,
    },
  },
  {
    at: NOW + 10 * DAY + 10 * MIN,
    rating: Rating.Hard,
    next: {
      dictId: 1,
      due: NOW + 29 * DAY + 10 * MIN,
      stability: 18.88969454,
      difficulty: 6.49889507,
      scheduledDays: 19,
      learningSteps: 0,
      reps: 4,
      lapses: 0,
      state: State.Review,
      lastReview: NOW + 10 * DAY + 10 * MIN,
    },
    log: {
      reviewTime: NOW + 10 * DAY + 10 * MIN,
      preState: State.Review,
      preStability: 7.51735908,
      preDifficulty: 4.74828477,
    },
  },
  {
    at: NOW + 29 * DAY + 10 * MIN,
    rating: Rating.Hard,
    next: {
      dictId: 1,
      due: NOW + 65 * DAY + 10 * MIN,
      stability: 35.8445174,
      difficulty: 7.66103176,
      scheduledDays: 36,
      learningSteps: 0,
      reps: 5,
      lapses: 0,
      state: State.Review,
      lastReview: NOW + 29 * DAY + 10 * MIN,
    },
    log: {
      reviewTime: NOW + 29 * DAY + 10 * MIN,
      preState: State.Review,
      preStability: 18.88969454,
      preDifficulty: 6.49889507,
    },
  },
]

// ══════════════════ 序列 5 / 6：提前复习 与 深度逾期（同一张 S=10、D=5 的 Review 行） ══════════════════

/** 待复习行：S=10、D=5、间隔 10 天，此刻（NOW）刚上过一次，due 在 10 天后。 */
const PENDING: WordRecord = {
  dictId: 1,
  due: NOW + 10 * DAY,
  stability: 10,
  difficulty: 5,
  scheduledDays: 10,
  learningSteps: 0,
  reps: 3,
  lapses: 0,
  state: State.Review,
  lastReview: NOW,
}

/** 提前 4 天（间隔的 40%）评 Good。 */
const G5: GoldenStep[] = [
  {
    at: NOW + 6 * DAY,
    rating: Rating.Good,
    next: {
      dictId: 1,
      due: NOW + 31 * DAY,
      stability: 24.97625809,
      difficulty: 4.99022837,
      scheduledDays: 25,
      learningSteps: 0,
      reps: 4,
      lapses: 0,
      state: State.Review,
      lastReview: NOW + 6 * DAY,
    },
    log: { reviewTime: NOW + 6 * DAY, preState: State.Review, preStability: 10, preDifficulty: 5 },
  },
]

/** 同参数行但此刻已到期（上次复习在 10 天前），逾期 30 天后评 Good。 */
const OVERDUE: WordRecord = { ...PENDING, due: NOW, lastReview: NOW - 10 * DAY }

const G6: GoldenStep[] = [
  {
    at: NOW + 30 * DAY,
    rating: Rating.Good,
    next: {
      dictId: 1,
      due: NOW + 90 * DAY,
      stability: 60.34380561,
      difficulty: 4.99022837,
      scheduledDays: 60,
      learningSteps: 0,
      reps: 4,
      lapses: 0,
      state: State.Review,
      lastReview: NOW + 30 * DAY,
    },
    log: { reviewTime: NOW + 30 * DAY, preState: State.Review, preStability: 10, preDifficulty: 5 },
  },
]

// ══════════════════ 用例 ══════════════════

describe('黄金序列 1：顺利毕业（新卡 Good ×2 毕业 → 按期 Good ×5）', () => {
  it('逐步九字段与日志逐位钉死', () => {
    expectOnTime(G1)
    const rows = runGolden(newWord(), G1)

    // sanity：新词首评「认识」仍进学习步、当天再巩固一次（study.md 已拍板，不走墨墨式当天即走）
    expect(rows[0].state).toBe(State.Learning)
    expect(rows[0].learningSteps).toBe(1) // 1m 步跳到 10m 步
    expect(rows[0].due! - NOW).toBe(10 * MIN)
    // sanity：末步学习步 Good 毕业进天级 Review
    expect(rows[1].state).toBe(State.Review)
    expect(rows[1].scheduledDays).toBeGreaterThanOrEqual(1)
    // sanity：毕业后共 5 次天级复习，间隔逐次严格递增
    const daily = rows.slice(1)
    expect(daily).toHaveLength(6) // 毕业那一步 + 5 次天级复习
    expect(scheduledDaysOf(daily)).toEqual([2, 11, 46, 163, 498, 1348])
    daily.slice(1).forEach((r, i) => expect(r.scheduledDays).toBeGreaterThan(daily[i].scheduledDays))
    // sanity：全程无遗忘 → lapses 恒 0
    rows.forEach((r) => expect(r.lapses).toBe(0))
  })
})

describe('黄金序列 2：步内挫折（新卡 Again → Good → Good 毕业）', () => {
  it('逐步九字段与日志逐位钉死', () => {
    expectOnTime(G2)
    const rows = runGolden(newWord(), G2)

    // sanity：Again 落在 1m 步（步索引 0），Good 前进到 10m 步（步索引 1），再 Good 毕业
    expect(rows[0].due! - NOW).toBe(1 * MIN)
    expect(rows[0].learningSteps).toBe(0)
    expect(rows[1].due! - rows[0].due!).toBe(10 * MIN)
    expect(rows[1].learningSteps).toBe(1)
    expect(rows[2].state).toBe(State.Review)
    // sanity：学习步内的 Again 不算遗忘（lapses 只在 Review→Again 递增）
    rows.forEach((r) => expect(r.lapses).toBe(0))
    // sanity：挫折过的卡毕业间隔（1 天）远短于顺利毕业（2 天）
    expect(rows[2].scheduledDays).toBeLessThan(G1[1].next.scheduledDays)
  })
})

describe('黄金序列 3：遗忘回爬（成熟 Review 评 Again → 重学 → 按期 Good ×3）', () => {
  it('逐步九字段与日志逐位钉死', () => {
    expectOnTime(G3)
    const rows = runGolden(MATURE, G3)

    // sanity：Review 评 Again → Relearning + 10m 重学步 + lapses+1
    expect(rows[0].state).toBe(State.Relearning)
    expect(rows[0].due! - NOW).toBe(10 * MIN)
    expect(rows[0].lapses).toBe(MATURE.lapses + 1)
    // sanity：遗忘惩罚——stability 大跌、difficulty 变难
    expect(rows[0].stability).toBeLessThan(MATURE.stability)
    expect(rows[0].difficulty).toBeGreaterThan(MATURE.difficulty)
    // sanity：重学步 Good 回 Review，受挫后间隔（2 天）远短于受挫前（20 天）
    expect(rows[1].state).toBe(State.Review)
    expect(rows[1].scheduledDays).toBeLessThan(MATURE.scheduledDays)
    // sanity：回爬——之后按期 Good 间隔逐次递增，且 lapses 不再增长
    expect(scheduledDaysOf(rows.slice(1))).toEqual([2, 5, 10])
    rows.slice(1).forEach((r) => expect(r.lapses).toBe(1))
  })
})

describe('黄金序列 4：连续 Hard（毕业后按期 Hard ×3）', () => {
  it('逐步九字段与日志逐位钉死', () => {
    expectOnTime(G4)
    const rows = runGolden(newWord(), G4)

    const hards = rows.slice(2)
    expect(scheduledDaysOf(hards)).toEqual([8, 19, 36])
    // sanity：Hard 仍是成功召回 → 间隔递增，但每次都把 difficulty 推高
    hards.slice(1).forEach((r, i) => expect(r.scheduledDays).toBeGreaterThan(hards[i].scheduledDays))
    hards.forEach((r, i) => {
      const prevD = i === 0 ? rows[1].difficulty : hards[i - 1].difficulty
      expect(r.difficulty).toBeGreaterThan(prevD)
    })
    // sanity：同一起点下 Hard 的首个复习间隔严格短于 Good（G1 第 3 步 11 天）
    expect(hards[0].scheduledDays).toBeLessThan(G1[2].next.scheduledDays)
    rows.forEach((r) => expect(r.lapses).toBe(0))
  })
})

describe('黄金序列 5：提前复习（due 前 40% 时长评 Good）', () => {
  it('逐步九字段与日志逐位钉死', () => {
    const rows = runGolden(PENDING, G5)
    // sanity：提前评分按实际 elapsed 计算（ts-fsrs 原生），间隔短于按期评分
    const onTime = schedule(PENDING, PENDING.due as number, Rating.Good).next
    expect(onTime.scheduledDays).toBe(32)
    expect(rows[0].scheduledDays).toBeLessThan(onTime.scheduledDays)
    expect(rows[0].stability).toBeLessThan(onTime.stability)
    // sanity：difficulty 更新与 elapsed 无关（只看评分档），提前/按期一致
    expect(rows[0].difficulty).toBe(onTime.difficulty)
  })
})

describe('黄金序列 6：深度逾期（逾期 30 天后评 Good）', () => {
  it('逐步九字段与日志逐位钉死', () => {
    const rows = runGolden(OVERDUE, G6)
    // sanity：低留存率下成功召回 → stability 增益更大，间隔长于按期评分
    const onTime = schedule(OVERDUE, OVERDUE.due as number, Rating.Good).next
    expect(onTime.scheduledDays).toBe(32)
    expect(rows[0].scheduledDays).toBeGreaterThan(onTime.scheduledDays)
    expect(rows[0].stability).toBeGreaterThan(onTime.stability)
    expect(rows[0].difficulty).toBe(onTime.difficulty)
  })
})

// ══════════════════ 序列 7：预览一致性（内部一致性，非快照） ══════════════════

describe('previewDueDates 与 schedule 三档逐一同值（按钮预览 = 真实落库）', () => {
  const GRADES: RateGrade[] = [Rating.Again, Rating.Hard, Rating.Good]

  const cases: { name: string; word: WordRecord; now: number }[] = [
    { name: '新卡（state=0）', word: newWord(), now: NOW },
    {
      name: 'Learning 中（分钟级步，state=1）',
      word: {
        dictId: 1,
        due: NOW + 3 * MIN,
        stability: 2.3065,
        difficulty: 2.11810397,
        scheduledDays: 0,
        learningSteps: 1,
        reps: 1,
        lapses: 0,
        state: State.Learning,
        lastReview: NOW - 7 * MIN,
      },
      now: NOW,
    },
    { name: 'Review 到期（state=2）', word: MATURE, now: NOW },
    { name: 'Review 逾期 30 天（state=2）', word: OVERDUE, now: NOW + 30 * DAY },
  ]

  cases.forEach(({ name, word, now }) => {
    it(`${name}：三档 preview 的 due === schedule 的 due`, () => {
      const preview = previewDueDates(word, now)
      GRADES.forEach((g) => {
        expect(preview[g], `grade=${g}`).toBe(schedule(word, now, g).next.due)
      })
      // sanity：三档 due 严格递增（不认识 < 模糊 < 认识），且都晚于评分时刻
      expect(preview[Rating.Again]).toBeLessThan(preview[Rating.Hard])
      expect(preview[Rating.Hard]).toBeLessThan(preview[Rating.Good])
      GRADES.forEach((g) => expect(preview[g]).toBeGreaterThan(now))
    })
  })
})
