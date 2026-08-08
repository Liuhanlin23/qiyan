// wordbook 业务门面：页面唯一入口。绑定库单例 db + 用校准钟同步取 editTime；组合本地写原语。
// 读直查本地库、写走变更流（dirty 累积、由引擎下一跳/手动 push，sync.md §3.4 无写后触发）、取数走 service 编排。
// words/notes/reviewLog/service 保持纯函数（不 import 引擎），由本门面组合；settings/dict 已上提为共享模块。
// 有状态的学习会话编排（今日队列 StudySession、rate、标熟、再学一组）独立在 studySession.ts，门面薄透传；
// 无状态的间隔预览 previewIntervals 留在门面。评分一律走 rate，不暴露裸 applyRating。
import { db } from '@/db/client'
import { calibratedNowSync } from '@/sync/clock'
import { readThroughByDictId, maybeRefreshDictUpdates } from '@/dict/service'
import * as studySession from './studySession'
import type { ExtraGroupSizes } from './studySession'
import * as words from './words'
import * as notes from './notes'
import * as reviewLog from './reviewLog'
import * as service from './service'
import { previewIntervals as previewIntervalsFn, type IntervalPreview } from './scheduler/preview'
import { dictRowToWord, parseSimpleSenses, placeholderWord } from './wordModel'
import { dayWindow } from './time'
import type { Word } from '@/types/word'
import type { LocalDictRow } from '@/dict'
import type {
  LocalNote,
  SegmentCounts,
  WordListItem,
  WordRecord,
  WordSegment,
  WordStateBrief,
} from './types'

export type {
  LocalNote,
  ReviewLogInput,
  SegmentCounts,
  WordListItem,
  WordRecord,
  WordSegment,
  WordStateBrief,
} from './types'
export type { NextCard, RateInput, RateResult, ExtraKind, ExtraCounts, QueueItem, QueueKind } from './scheduler/queue'
export type { IntervalPreview } from './scheduler/preview'
export type { ExtraGroupSizes, StudyCard } from './studySession'
// 词书目录 / 词条为在线浏览（不落库），经门面透传给目录页 / 选词页（页面唯一入口仍是 @/wordbook）。
export {
  fetchCategories,
  fetchOfficialBooks,
  fetchBookEntries,
} from '@/api/wordbook'
export type { Category, OfficialBook, BookEntry } from '@/api/wordbook'

// ── 词库读（本地库直查，用校准钟判段/到期） ──
export const listSegment = (
  segment: WordSegment,
  opts?: { search?: string; limit?: number; offset?: number },
): Promise<WordListItem[]> => words.listSegment(db, segment, calibratedNowSync(), opts)
/** 词表「全部」段：所有未删词库行（四段之并），按加入序。 */
export const listAllWords = (opts?: {
  search?: string
  limit?: number
  offset?: number
}): Promise<WordListItem[]> => words.listAll(db, opts)
export const segmentCounts = (): Promise<SegmentCounts> =>
  words.segmentCounts(db, calibratedNowSync())
export const getWord = (dictId: number): Promise<WordRecord | null> => words.getWord(db, dictId)
export const getWordStates = (dictIds: readonly number[]): Promise<Map<number, WordStateBrief>> =>
  words.getWordStates(db, dictIds)

/** 批量取「已加入词的所属四段」（选词页徽标：未加入的 dictId 不在返回 Map 中）。 */
export async function getWordSegments(
  dictIds: readonly number[],
): Promise<Map<number, WordSegment>> {
  const nd = dayWindow(calibratedNowSync()).endMs
  const states = await words.getWordStates(db, dictIds)
  const map = new Map<number, WordSegment>()
  for (const [dictId, brief] of states) map.set(dictId, words.segmentOf(brief.state, brief.due, nd))
  return map
}

/**
 * 词表/今日右栏词卡：dict 内容行（读穿在线补缺）+ 行学习态 → 领域富类型 Word + 原始 dict 行。
 * dictRow 供词卡手动发音走 CDN 真人音频（playWordAudio，cache/dict.md §7）；缺行（离线/未补缺）
 * dictRow=null、word 用拼写占位（补缺后再选自动回归）。now 用校准钟判 due 归今日与否。
 */
export async function loadWordCard(
  item: WordListItem,
): Promise<{ word: Word; dictRow: LocalDictRow | null }> {
  const now = calibratedNowSync()
  const row = await readThroughByDictId(db, item.dictId)
  const brief: WordStateBrief = { state: item.state, due: item.due }
  const word = row ? dictRowToWord(row, brief, now) : placeholderWord(item.term ?? '', brief, now)
  return { word, dictRow: row }
}

/** 查词页词卡：已有 dict 行 + 学习态（未加入词库传 null）→ 领域富类型 Word（now 用校准钟判 due 标签）。 */
export const wordFromDictRow = (row: LocalDictRow, brief: WordStateBrief | null): Word =>
  dictRowToWord(row, brief, calibratedNowSync())

/** 今日学习页两段（日志推导，按词去重）：今日学习 / 今日复习的词表行。 */
export async function todaySegments(): Promise<{ learned: WordListItem[]; reviewed: WordListItem[] }> {
  const w = todayWindow()
  const [newIds, reviewIds] = await Promise.all([
    reviewLog.todayNewWords(db, w.startMs, w.endMs),
    reviewLog.todayReviewWords(db, w.startMs, w.endMs),
  ])
  const [learned, reviewed] = await Promise.all([
    words.listByDictIds(db, newIds),
    words.listByDictIds(db, reviewIds),
  ])
  return { learned, reviewed }
}

// ── 笔记 / 设置读 ──
export const getNote = (dictId: number): Promise<string | null> => notes.getNote(db, dictId)
export const listNotes = (): Promise<LocalNote[]> => notes.listNotes(db)

/** 我的笔记页展示模型：笔记正文 + 冗余词条展示（拼写/音标/首条简义/发音 URL 三列，缺行占位）+ edit_time。 */
export interface NoteCardData {
  dictId: number
  word: string
  phonetic: string
  meaning: string
  note: string
  editTime: number
  // 发音 URL 三列（列名对齐 dict，直接满足 playWordAudio 的 WordAudioColumns）
  ukAudioUrl: string | null
  usAudioUrl: string | null
  audioUrl: string | null
}
/** 我的笔记列表（富展示）：JOIN dict 取词条展示字段，ec 解析首条简义；缺行以占位拼写呈现。 */
export async function listNoteCards(): Promise<NoteCardData[]> {
  const rows = await notes.listNotesDetailed(db)
  return rows.map((r) => ({
    dictId: r.dictId,
    word: r.term ?? '待补全词条',
    phonetic: r.usPhonetic ? `/${r.usPhonetic}/` : r.ukPhonetic ? `/${r.ukPhonetic}/` : '',
    meaning: parseSimpleSenses(r.ec)[0] ?? '',
    note: r.note,
    editTime: r.editTime,
    ukAudioUrl: r.ukAudioUrl,
    usAudioUrl: r.usAudioUrl,
    audioUrl: r.audioUrl,
  }))
}

// ── 今日记账读（日志推导，今日窗口用校准钟） ──
const todayWindow = () => dayWindow(calibratedNowSync())

/**
 * 当前学习日标识（4:00 边界的窗口起点 ms，与 todaySegments 同口径）：跨 4:00 后值改变。
 * 供常开页面轮询判是否跨了学习日、需刷新今日队列（复用 dayWindow，不另写 4:00 口径）。
 */
export const currentLearningDay = (): number => todayWindow().startMs
export const todayNewCount = (): Promise<number> => {
  const w = todayWindow()
  return reviewLog.todayNewCount(db, w.startMs, w.endMs)
}
export const todayReviewCount = (): Promise<number> => {
  const w = todayWindow()
  return reviewLog.todayReviewCount(db, w.startMs, w.endMs)
}
export const todayStudiedWords = (): Promise<number[]> => {
  const w = todayWindow()
  return reviewLog.todayStudiedWords(db, w.startMs, w.endMs)
}

// ── 词库补缺缺行诊断（我的词库缺哪些 dict 行；词典缓存读穿/计数/清空见 @/dict） ──
export const missingDictCount = (): Promise<number> => service.missingDictCount(db)

// ── 组大小（再学一组，设备本地不跨端同步，study.md「再学一组」） ──
export const getGroupSizes = (): Promise<ExtraGroupSizes> => studySession.getExtraGroupSizes(db)
export const setGroupSizes = (sizes: ExtraGroupSizes): Promise<void> =>
  studySession.setExtraGroupSizes(db, sizes)

// ── 写 / 动作（dirty 累积，等引擎下一跳/手动 push） ──

/** 选词加入词库（显式建行 state=0），随即后台补缺该批词的词典缓存（本端触发入口，dict.md §3）。 */
export async function addWords(dictIds: readonly number[]): Promise<void> {
  await words.addWords(db, dictIds, calibratedNowSync())
  void service.fillMissingDict(db)
}

/** 标熟：state=4 全局生效；学习会话中同时移出队列并计入当组完成（study.md「标熟」，不评分不记日志）。 */
export const master = studySession.master
/** 取消标熟：已学过回 state=2（due 不变、learning_steps=0），从未学过回 state=0（words.ts 原语）。 */
export const unmaster = (dictId: number): Promise<void> =>
  words.unmaster(db, dictId, calibratedNowSync())

/** 移出词库：置墓碑传播删除（FSRS 字段保留，复活即从 state=0 重来）；一并移出当前学习队列，避免残留出词。 */
export async function removeWord(dictId: number): Promise<void> {
  await words.removeWords(db, [dictId], calibratedNowSync())
  studySession.dropFromSession(dictId)
}

/** 写笔记：门面统一 trim 后落库（单一收口点）——三个保存入口（背词页/笔记页/useWordNote）经此归一化首尾空白。 */
export const setNote = (dictId: number, note: string): Promise<void> =>
  notes.setNote(db, dictId, note.trim(), calibratedNowSync())
export const clearNote = (dictId: number): Promise<void> =>
  notes.clearNote(db, dictId, calibratedNowSync())

// ── 词库补缺 / 增量维护 ──

/** 每天首次进单词本触发词库增量（键集翻页，dict.md §3）。触发语义属单词本域，日窗起点由此算好传入 dict 编排。 */
export const refreshDictUpdatesForToday = (): Promise<void> =>
  maybeRefreshDictUpdates(db, dayWindow(calibratedNowSync()).startMs)
/** 手动/诊断触发词库补缺（后台单飞）。 */
export const fillMissingDict = (): Promise<void> => service.fillMissingDict(db)

// ── 学习会话 / 评分 / 标熟 / 再学一组（编排在 studySession，门面薄透传；study.md） ──
export const startTodaySession = studySession.startTodaySession
export const sessionCounts = studySession.sessionCounts
export const nextCard = studySession.nextCard
export const skipCard = studySession.skipCard
export const loadStudyCard = studySession.loadStudyCard
export const rate = studySession.rate
export const extraGroup = studySession.extraGroup
export const extraCounts = studySession.extraCounts

/** 三档评分按钮的下次间隔预览文案（study.md「学习流程」，ts-fsrs repeat + anki 时长格式）。 */
export const previewIntervals = (word: WordRecord): IntervalPreview =>
  previewIntervalsFn(word, calibratedNowSync())

/** 首页/今日页数字：今日新学、今日复习（日志推导）、全局到期总数（等待复习）。 */
export async function todayCounts(): Promise<{
  newDone: number
  reviewDone: number
  dueTotal: number
}> {
  const now = calibratedNowSync()
  const w = dayWindow(now)
  const [newDone, reviewDone, counts] = await Promise.all([
    reviewLog.todayNewCount(db, w.startMs, w.endMs),
    reviewLog.todayReviewCount(db, w.startMs, w.endMs),
    words.segmentCounts(db, now),
  ])
  return { newDone, reviewDone, dueTotal: counts.due }
}
