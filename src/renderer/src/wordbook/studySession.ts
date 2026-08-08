// 学习会话编排 + 设备本地态。内存态单例 session：进学习页 startTodaySession 建、跨窗口（跨次日 4:00）自动重建，
// UI 经门面驱动出卡/评分/标熟/再学一组。组大小是「再学一组」的设备本地档位（不入 user_setting、不跨端同步）。
// db 单例与校准钟在此绑定（编排文件，与 session/ 门面同款「单例只在编排处绑定」纪律）。
import { db } from '@/db/client'
import type { Db } from '@/db/client'
import { calibratedNowSync } from '@/sync/clock'
import { getSettings as readSettings } from '@/settings'
import { readThroughByDictId } from '@/dict/service'
import { getMeta, setMeta } from '@/db/meta'
import * as words from './words'
import * as scheduler from './scheduler/queue'
import { previewIntervals as previewIntervalsFn, type IntervalPreview } from './scheduler/preview'
import { dictRowToWord } from './wordModel'
import type { Word } from '@/types/word'
import type { LocalDictRow } from '@/dict'
import type { WordRecord } from './types'

// ────────────────── 组大小（再学一组，设备本地不跨端同步，study.md「再学一组」） ──────────────────

/** 「再学一组」组大小（设备本地、不入 user_setting、不跨端同步，study.md「再学一组」）。默认 学习/复习 10、提前复习 5。 */
export interface ExtraGroupSizes {
  learn: number
  review: number
  ahead: number
}

export const DEFAULT_GROUP_SIZES: ExtraGroupSizes = { learn: 10, review: 10, ahead: 5 }

/** 读组大小：缺键/坏值回落默认；存的部分键覆盖默认（前向兼容将来加档）。 */
export async function getExtraGroupSizes(db: Db): Promise<ExtraGroupSizes> {
  const raw = await getMeta(db, 'extra_group_sizes')
  if (!raw) return { ...DEFAULT_GROUP_SIZES }
  try {
    const parsed = JSON.parse(raw) as Partial<ExtraGroupSizes>
    return { ...DEFAULT_GROUP_SIZES, ...parsed }
  } catch {
    return { ...DEFAULT_GROUP_SIZES }
  }
}

export async function setExtraGroupSizes(db: Db, sizes: ExtraGroupSizes): Promise<void> {
  await setMeta(db, 'extra_group_sizes', JSON.stringify(sizes))
}

// ────────────────── 学习会话生命周期（内存态单例，UI 经门面驱动） ──────────────────

// 当前学习会话（内存态单例，进学习页 startTodaySession 建、跨窗口自动重建）。UI 通过门面驱动出卡/评分。
let session: scheduler.StudySession | null = null

/** 进入学习页：按设置与今日记账构建今日会话（校准钟）。 */
export async function startTodaySession(): Promise<void> {
  const s = await readSettings()
  session = await scheduler.buildTodaySession(db, s, calibratedNowSync())
}

/**
 * 学习页顶栏三计数（study.md「学习页顶栏」）：即时从会话队列派生、零 SQL，无会话返回全零。
 * 语义「今天还剩」——新/学/复三个剩余计数，三数全零 ⟺ 今日完成。UI 每次出卡前读一次。
 */
export function sessionCounts(): { new: number; learning: number; review: number } {
  return session ? session.counts() : { new: 0, learning: 0, review: 0 }
}

/** 取下一张卡（三段序）。返回 stale 表示跨过次日 4:00，UI 应调 startTodaySession 重建。无会话视同今日完成。 */
export function nextCard(): scheduler.NextCard {
  return session ? session.nextCard(calibratedNowSync()) : { kind: 'done' }
}

/** 从活动会话驱逐一张卡（不评分不落库）：标熟 / 移出词库 / UI 跳过共用，避免残留出词。 */
export function dropFromSession(dictId: number): void {
  session?.drop(dictId)
}

/** 从会话丢弃一张卡（不评分不落库）：UI 遇到词行被删/dict 缺行无法出示时跳过，防止分钟级卡重复出现。 */
export function skipCard(dictId: number): void {
  dropFromSession(dictId)
}

/** 标熟：state=4 全局生效；学习会话中同时移出队列并计入当组完成（study.md「标熟」，不评分不记日志）。 */
export async function master(dictId: number): Promise<void> {
  await words.setMastered(db, dictId, calibratedNowSync())
  dropFromSession(dictId)
}

/** 学习卡一次载齐：富词卡 Word + 评分行 WordRecord（含 reps 供 snapshot）+ 三档间隔预览 + dict 行（自动发音用）。 */
export interface StudyCard {
  word: Word
  record: WordRecord
  preview: IntervalPreview
  dictRow: LocalDictRow
}
/**
 * 载入一张学习卡。词行不存在（被别端删/标熟）或 dict 缺行（缓存被清）→ 返回 null，UI 跳过取下一张
 * （cache/wordbook.md「降级」：未及补缺时出卡跳过；队列本已 INNER JOIN dict，缺行属边界）。now 用校准钟。
 */
export async function loadStudyCard(dictId: number): Promise<StudyCard | null> {
  const record = await words.getWord(db, dictId)
  // 词行不存在，或 state=4（会话中被别端标熟经 pull 落地）→ 跳过；后者防 previewIntervals 断言抛错卡死学习页。
  if (!record || record.state === 4) return null
  const dictRow = await readThroughByDictId(db, dictId)
  if (!dictRow) return null
  const now = calibratedNowSync()
  const word = dictRowToWord(dictRow, { state: record.state, due: record.due }, now)
  const preview = previewIntervalsFn(record, now)
  return { word, record, preview, dictRow }
}

/** 评分（读行→算九字段→整行+日志合批落库→会话回插）。防重复评分与不可调度态在内部幂等丢弃。 */
export const rate = (input: scheduler.RateInput): Promise<scheduler.RateResult> =>
  scheduler.rate(db, session, input, calibratedNowSync())

/** 再学一组：按选项取一组卡（不受额度限制）追加进会话，返回实际取到的张数。 */
export async function extraGroup(kind: scheduler.ExtraKind, size: number): Promise<number> {
  if (!session) return 0
  const s = await readSettings()
  const items = await scheduler.extraGroup(
    db,
    kind,
    size,
    calibratedNowSync(),
    session.served,
    s.newCardOrder,
  )
  session.appendGroup(items)
  return items.length
}

/** 完成态三选项可用数量（继续学习排除本会话已出词）。 */
export const extraCounts = (): Promise<scheduler.ExtraCounts> =>
  scheduler.extraCounts(db, calibratedNowSync(), session ? session.served : new Set<number>())
