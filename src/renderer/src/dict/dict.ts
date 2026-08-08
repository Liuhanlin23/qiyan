// 词典内容缓存的**本地库侧**读 / 写 / 清理（定稿见 docs/feature/cache/dict.md）。
// 词典是只读引用数据——不是同步是缓存：单向、无冲突无墓碑，损坏=删掉重取，误删=在线回填（软失败）。
// 只增不删、无 LRU 无 TTL、读路径纯读无 touch（§2/§5）；唯一删除路径 = clearDictCache 全删（+逃生舱清库）。
// 本文件不 import HTTP，保持可被单测直接引入；在线取词由 service.ts 编排，取回后调 upsertDicts 落库。
import { count, eq } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { runBatch, type Db } from '@/db/client'
import { getMeta, setMeta, setMetaStmt } from '@/db/meta'
import { dict } from '@/db/schema'
import type { LocalDictRow } from './types'

// ────────────────── 读路径（纯读，命中即终点，未命中交上层在线取；dict.md §2） ──────────────────

/** 按 dict_id 命中；未命中返回 null（上层读穿在线回填）。纯读、不 touch。 */
export async function getByDictId(db: Db, dictId: number): Promise<LocalDictRow | null> {
  const row = await db.select().from(dict).where(eq(dict.dictId, dictId)).get()
  return row ?? null
}

/** 按 term 精确命中（码点精确、大小写敏感，对应 server 0900_bin）。未命中返回 null。 */
export async function getByTerm(db: Db, term: string): Promise<LocalDictRow | null> {
  const row = await db.select().from(dict).where(eq(dict.term, term)).get()
  return row ?? null
}

// ────────────────── 写路径（dict.md §3：三来源一律 upsert 同一张表，列对列覆盖） ──────────────────

/** 批量 upsert（词库补缺 / 词库增量 / 单条读穿共用）。列对列覆盖；无缓存元数据列。 */
export async function upsertDicts(db: Db, rows: readonly LocalDictRow[]): Promise<void> {
  if (rows.length === 0) return
  const stmts: BatchItem<'sqlite'>[] = rows.map((r) => {
    const { dictId: _pk, ...content } = r
    return db.insert(dict).values(r).onConflictDoUpdate({ target: dict.dictId, set: content })
  })
  await runBatch(db, stmts)
}

// ────────────────── 清理（dict.md §5：只增不删，唯一删除路径） ──────────────────

/** 已缓存词条数（设置页「清空词典缓存」入口旁诊断）。 */
export async function cachedDictCount(db: Db): Promise<number> {
  return (await db.select({ n: count() }).from(dict).get())?.n ?? 0
}

/** 唯一删除路径：全删词典缓存（设置页手动清空）。读穿 + 词库补缺随后自动补齐，无数据损失。 */
export async function clearDictCache(db: Db): Promise<void> {
  await db.delete(dict).run()
}

// ────────────────── 水位线访问器（词库增量，dict.md §3/§4） ──────────────────

const META_DICT_SINCE = 'dict_updates_since'

/** 词库词典增量水位线（GET /dict/updates?since=）。初值由首灌完成时的 server 时间置入（engine）。 */
export async function getDictUpdatesSince(db: Db): Promise<number> {
  return Number((await getMeta(db, META_DICT_SINCE)) ?? '0')
}

export async function setDictUpdatesSince(db: Db, since: number): Promise<void> {
  await setMeta(db, META_DICT_SINCE, String(Math.trunc(since)))
}

/** 水位线更新语句（供 engine 把首灌初值折进 pull 一页 batch 原子提交）。 */
export function setDictUpdatesSinceStmt(db: Db, since: number): BatchItem<'sqlite'> {
  return setMetaStmt(db, META_DICT_SINCE, String(Math.trunc(since)))
}

const META_DICT_REFRESH_DAY = 'dict_refresh_day'

/**
 * 词库词典增量的「今天已刷」标记：存最近一次增量刷新所属今日窗口的起点（dayWindow(now).startMs）。
 * 每天首次进单词本区时，页面比对本值 ≠ 今日窗口起点 → 触发一次 refreshDictUpdates（cache/dict.md §3）。
 */
export async function getDictRefreshDay(db: Db): Promise<number> {
  return Number((await getMeta(db, META_DICT_REFRESH_DAY)) ?? '0')
}

export async function setDictRefreshDay(db: Db, dayStartMs: number): Promise<void> {
  await setMeta(db, META_DICT_REFRESH_DAY, String(Math.trunc(dayStartMs)))
}
