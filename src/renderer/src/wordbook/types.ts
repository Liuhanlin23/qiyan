// wordbook 数据层的内部类型（本地库行形状 + 读写载荷）。语义见 docs/feature/wordbook/words.md、notes.md、study.md、
// docs/feature/cache/dict.md、docs/db/04-user-word.md。命名一律 camelCase；时间一律 epoch ms（与 wire 一致）。
// 全局词库模型：无词书维度（自然键仅 dictId）、无缓存元数据列（dict 只读只增）。

// ────────────────── 词库（user_word） ──────────────────

/**
 * 词表四段（words.md 词表章节，四段互斥全覆盖，纯 state/due 判断）：
 * new=未学习(state 0) / due=待复习(state∈{1,2,3} 且 due<次日4:00) /
 * memorizing=记忆中(state∈{1,2,3} 且未到期) / mastered=已标熟(state 4)。
 */
export type WordSegment = 'new' | 'due' | 'memorizing' | 'mastered'

/** 词表页一行：学习状态 + 冗余 term（JOIN dict 取；dict 缺行时 term=null 占位）。 */
export interface WordListItem {
  dictId: number
  term: string | null
  state: number
  due: number | null
}

/** 四段计数（词表 tab 徽标 / 首页数字）。 */
export interface SegmentCounts {
  new: number
  due: number
  memorizing: number
  mastered: number
}

/** 一条学习状态（评分读旧值 / 详情）——FSRS 九字段 + 自然键。墓碑行视同不存在。 */
export interface WordRecord {
  dictId: number
  due: number | null
  stability: number
  difficulty: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  state: number
  lastReview: number | null
}

/** getWordStates 的值：选词页判定「已加入 + 状态」用。 */
export interface WordStateBrief {
  state: number
  due: number | null
}

/** 一次评分追加的复习日志载荷（append-only，scheduler 算好后与 user_word 整行合批落库）。 */
export interface ReviewLogInput {
  dictId: number
  reviewTime: number
  rating: number
  durationMs: number
  preState: number
  preStability: number
  preDifficulty: number
}

// ────────────────── 笔记（user_word_note） ──────────────────

export interface LocalNote {
  dictId: number
  note: string
}

/** 富笔记行（我的笔记页）：笔记 + edit_time + 冗余 dict 内容（缺行时 dict 字段为 null）。 */
export interface NoteDetail {
  dictId: number
  note: string
  editTime: number
  term: string | null
  usPhonetic: string | null
  ukPhonetic: string | null
  ukAudioUrl: string | null
  usAudioUrl: string | null
  audioUrl: string | null
  ec: string | null
}
