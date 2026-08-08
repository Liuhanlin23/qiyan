// 时钟校准：不拒绝坏时钟设备，统一校准到服务端钟（sync.md §1）。
// 每次 pull/push 响应携带 serverTimeMs，据此维护偏移；业务写路径用校准钟打 editTime / review_time / 日边界。
// 双形态：异步 calibratedNow（读持久化 meta，回合外零依赖）+ 同步 calibratedNowSync（内存 offset 快路径，
// 供门面写路径与评分/间隔预览同步取时）。内存 offset 由开库预热 + 每回合 calibrate 刷新。
import type { Db } from '@/db/client'
import { getMeta, setMeta } from '@/db/meta'

/** 内存缓存的服务端时钟偏移（ms）：calibratedNowSync 快路径用；primeClockOffset 预热、calibrate 刷新。 */
let offsetMs = 0

/**
 * 单调护栏：记录 calibratedNowSync 上次返回值，保证同一会话内严格单调不回退。
 * 防本地时钟回拨（休眠恢复 / NTP 步进 / 手动改钟）时新 editTime 反而变小 → 被服务端 LWW 拒绝、reconcile 回旧值静默丢编辑。
 * 会话内护栏（跨应用重启的回拨不覆盖，接受此边界）。
 */
let lastSyncMs = 0

/** 服务端时钟偏移（ms）：offset = serverTimeMs - 本地 now（sync 私有态，存 meta KV）。 */
async function getClockOffset(db: Db): Promise<number> {
  return Number((await getMeta(db, 'clock_offset_ms')) ?? '0')
}

async function setClockOffset(db: Db, offsetMs: number): Promise<void> {
  await setMeta(db, 'clock_offset_ms', String(Math.trunc(offsetMs)))
}

/**
 * 用服务端时钟校准偏移：offset = serverTimeMs - 本地 now。非法值忽略。同步刷新内存 offset + 落盘。
 * 返回本次应用的 offset（ms），非法值忽略时返回 null——供调用方判定偏差是否超阈值提示用户。
 */
export async function calibrate(db: Db, serverTimeMs: number): Promise<number | null> {
  if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) return null
  offsetMs = serverTimeMs - Date.now()
  await setClockOffset(db, offsetMs)
  return offsetMs
}

/** 校准后的当前时间（epoch ms），异步读持久化 offset。 */
export async function calibratedNow(db: Db): Promise<number> {
  return Date.now() + (await getClockOffset(db))
}

/** 同步快路径：用内存 offset（开库 primeClockOffset 预热 + 每回合 calibrate 刷新）。单调护栏保证严格递增。 */
export function calibratedNowSync(): number {
  lastSyncMs = Math.max(Date.now() + offsetMs, lastSyncMs + 1)
  return lastSyncMs
}

/** 开库后预热：把持久化 offset 读进内存，保证首个 pull 前 calibratedNowSync 就有合理值。 */
export async function primeClockOffset(db: Db): Promise<void> {
  offsetMs = await getClockOffset(db)
}
