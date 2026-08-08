/**
 * 朗读的设备级记忆 —— 倍速 / 音色偏好 / 每书续读锚点（`ttsLocation`）。
 *
 * tts.md §数据形态：首版均不开放为设置项、仅作运行时记忆 —— 走 deviceMemory（localStorage、
 * 不落库不同步，范本 translation/providerMemory.ts），不动 user_setting。续读锚点按书 hash
 * 记一条 MRU 表、容量封顶（读得多的书留着，最老的掉出），与阅读进度相互独立（朗读位置 ≠ 阅读进度）。
 */
import { defineDeviceMemory } from '@/lib/deviceMemory'
import { RATE_MAX, RATE_MIN } from './playback'
import { DEFAULT_VOICE, findVoice } from './voices'

/** 倍速：夹到 tts.md 的 0.5–3，认不得回默认 1.0。 */
export function sanitizeTtsRate(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 1
  return Math.min(Math.max(n, RATE_MIN), RATE_MAX)
}

const rateMemory = defineDeviceMemory<number>('qiyan.reading.ttsRate', 1, sanitizeTtsRate)
export const readTtsRate = rateMemory.read
export const storeTtsRate = rateMemory.store

/**
 * 只认目录里存在的音色 id，其余（换过目录 / 脏值 / 旧版按语言存的 `{ en, zh }` 对象）回默认。
 * key 用单数 `ttsVoice`：与旧的 `ttsVoices` 天然错开，旧记录读不到即回默认，不必写迁移。
 */
export function sanitizeTtsVoice(raw: unknown): string {
  return typeof raw === 'string' && findVoice(raw) ? raw : DEFAULT_VOICE
}

const voiceMemory = defineDeviceMemory<string>(
  'qiyan.reading.ttsVoice',
  DEFAULT_VOICE,
  sanitizeTtsVoice,
)
export const readTtsVoice = voiceMemory.read
export const storeTtsVoice = voiceMemory.store

/** 一本书的续读锚点（MRU 序，新的在前）。 */
export interface TtsLocationEntry {
  hash: string
  cfi: string
}

/** 续读锚点容量：超出后最久没读的书掉出（防 localStorage 无限膨胀）。 */
export const MAX_TTS_LOCATIONS = 50

const isLocationEntry = (e: unknown): e is TtsLocationEntry => {
  const v = e as Partial<TtsLocationEntry> | null
  return typeof v?.hash === 'string' && !!v.hash && typeof v.cfi === 'string' && !!v.cfi
}

/** 收成合法的 MRU 表：坏形状丢掉、同书只留最靠前那条、超容量截尾。 */
export function sanitizeTtsLocations(raw: unknown): TtsLocationEntry[] {
  if (!Array.isArray(raw)) return []
  const out: TtsLocationEntry[] = []
  const seen = new Set<string>()
  for (const e of raw) {
    if (!isLocationEntry(e) || seen.has(e.hash)) continue
    seen.add(e.hash)
    out.push({ hash: e.hash, cfi: e.cfi })
    if (out.length >= MAX_TTS_LOCATIONS) break
  }
  return out
}

/**
 * 置顶 / 更新某书的锚点：新条目排头，同书旧条目与超出容量的尾巴由 sanitize 一并收掉
 *（去重「保先出现」正好等于「新的赢」，容量规则也就只有那一个出处）。
 */
export function upsertTtsLocation(
  entries: readonly TtsLocationEntry[],
  hash: string,
  cfi: string,
): TtsLocationEntry[] {
  return sanitizeTtsLocations([{ hash, cfi }, ...entries])
}

const locationMemory = defineDeviceMemory<TtsLocationEntry[]>(
  'qiyan.reading.ttsLocations',
  [],
  sanitizeTtsLocations,
)

export function readTtsLocation(bookHash: string): string | null {
  return locationMemory.read().find((e) => e.hash === bookHash)?.cfi ?? null
}

export function storeTtsLocation(bookHash: string, cfi: string): void {
  locationMemory.store(upsertTtsLocation(locationMemory.read(), bookHash, cfi))
}
