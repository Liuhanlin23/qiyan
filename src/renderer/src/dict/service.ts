// dict 取数编排：读穿查词 / 读穿按 id / 词库增量。触发点编排 + 世代号护栏纪律（sync.md §3.4）。
// 词典是缓存不是同步——一切在线取数 best-effort：离线 / server 未实现 / 出错，一律降级为「缓存未命中」，
// 不抛给调用方（dict.md 顶部：误删/未命中的最坏后果 = 在线回填的软失败）。
import { currentDbGeneration, type Db } from '@/db/client'
import { ServerError } from '@/api/request'
import * as api from '@/api/dict'
import * as dict from './dict'
import type { LocalDictRow } from './types'

// ────────────────── 读穿：查表命中即用，未命中在线取并 upsert（dict.md §2） ──────────────────

/** server「有道明确无此词」业务码（DictErrorCode.YOUDAO_NO_RESULT）。 */
const CODE_YOUDAO_NO_RESULT = 120002

/** 查词三态结果（lookup.md §3）：命中（本地或在线）/ 未收录（120002）/ 不可用（离线、服务错误）。 */
export type LookupResult =
  | { status: 'hit'; row: LocalDictRow }
  | { status: 'not-found' }
  | { status: 'unavailable' }

/** 查词页按 term 读穿三态。本地命中即终点；未命中在线取 → upsert；按异常类型分流未收录/不可用。 */
export async function lookupByTerm(db: Db, term: string): Promise<LookupResult> {
  const hit = await dict.getByTerm(db, term)
  if (hit) return { status: 'hit', row: hit }
  const gen = currentDbGeneration()
  try {
    const row = await api.fetchDictByTerm(term)
    if (currentDbGeneration() !== gen) return { status: 'unavailable' } // 取数在途换账号：不写换后账号的库
    await dict.upsertDicts(db, [row])
    // 回读用权威拼写（输入 helo 命中 hello 时行落在 hello 键下，按输入回读会 miss）
    const stored = await dict.getByTerm(db, row.term)
    return stored ? { status: 'hit', row: stored } : { status: 'unavailable' }
  } catch (e) {
    if (e instanceof ServerError && e.code === CODE_YOUDAO_NO_RESULT) return { status: 'not-found' }
    return { status: 'unavailable' } // NetworkError / 鉴权 / 其他服务错误：不可用态软降级
  }
}

/** 按 dict_id 读穿（未命中走 /dict/batch 单条回填）。 */
export async function readThroughByDictId(db: Db, dictId: number): Promise<LocalDictRow | null> {
  const hit = await dict.getByDictId(db, dictId)
  if (hit) return hit
  const gen = currentDbGeneration()
  try {
    const rows = await api.fetchDictBatch([dictId])
    if (rows.length === 0) return null
    if (currentDbGeneration() !== gen) return null
    await dict.upsertDicts(db, rows)
    return dict.getByDictId(db, dictId)
  } catch {
    return null
  }
}

// ────────────────── 词库增量（每天首次进单词本，dict.md §3/§4） ──────────────────

/**
 * 词库词典增量：键集翻页（cache/dict.md §3 契约）——回合内用响应 (nextSince, nextAfterId) 连续翻页直到 done，
 * 仅整轮 done 后才把 nextSince 写入水位线（afterId 不持久化）；中途失败不推水位线、下轮整轮重来（幂等）。
 * 返回是否整轮成功（供 maybeRefreshDictUpdates 决定是否标记「今日已刷」）。
 */
export async function refreshDictUpdates(db: Db): Promise<boolean> {
  const gen = currentDbGeneration()
  let since = await dict.getDictUpdatesSince(db)
  let afterId = 0
  try {
    for (;;) {
      if (currentDbGeneration() !== gen) return false
      const res = await api.fetchDictUpdates(since, afterId)
      if (currentDbGeneration() !== gen) return false
      await dict.upsertDicts(db, res.rows)
      if (res.done) {
        await dict.setDictUpdatesSince(db, res.nextSince) // 仅整轮 done 才推水位线
        return true
      }
      since = res.nextSince
      afterId = res.nextAfterId
    }
  } catch {
    return false // 中途失败：不推水位线，下轮整轮重来
  }
}

/**
 * 每天首次进单词本触发：dict_refresh_day ≠ 今日窗口起点时跑增量，整轮成功才标记今日已刷（失败下次重试）。
 * 日窗起点 todayStartMs 由调用方（编排在单词本域）算好传入——dict 不依赖学习域的日边界概念。
 */
export async function maybeRefreshDictUpdates(db: Db, todayStartMs: number): Promise<void> {
  if ((await dict.getDictRefreshDay(db)) === todayStartMs) return
  if (await refreshDictUpdates(db)) await dict.setDictRefreshDay(db, todayStartMs)
}
