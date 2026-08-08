/**
 * 单词领域模型 —— 查词 / 单词本 / 学习三处共用的唯一 Word 定义。
 * 5 态语义对齐 iOS CurrentBookSource / LearnState。学习相关字段（tags/state/due）
 * 仅词书场景有意义，故设为可选：查词不提供、学习卡按需携带。
 */

/** 学习状态，对齐 iOS LearnState。isLearned = state ≥ review。 */
export type LearnState = 'new' | 'learning' | 'review' | 'relearning' | 'mastered'
/** 释义来源：简明 / 柯林斯。 */
export type MeaningSource = 'simple' | 'collins'
/** 详情 Tab：例句 / 派生 / 近义 / 词组。 */
export type DetailTab = 'example' | 'derived' | 'synonym' | 'phrase'

export interface CollinsEntry {
  pos: string
  tran: string
  examples: { en: string; zh: string }[]
}
export interface Example {
  english: string
  chinese: string
  /** 例句真人音频完整 URL（dict example_sentence 的 sentence-speech，服务端入库时已拼好；可缺）。 */
  audioUrl?: string
}
export interface Inflection {
  label: string
  value: string
}
export interface SynonymGroup {
  pos: string
  meaning: string
  words: string[]
}

export interface Word {
  word: string
  phoneticUK: string
  phoneticUS: string
  simpleSenses: string[]
  collinsEntries: CollinsEntry[]
  inflections: Inflection[]
  examples: Example[]
  derived: string[]
  phraseGroup: string[]
  synonymGroups: SynonymGroup[]
  /** 考试标签（CET4 / CET6 / GRE / 考研…）。仅词书场景有意义。 */
  tags?: string[]
  /** 学习状态。仅词书场景有意义。 */
  state?: LearnState
  /** 仅 review / relearning 有意义：到期在今日窗口内为 'today'，否则 'later'。 */
  due?: 'today' | 'later'
}
