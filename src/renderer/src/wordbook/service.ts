// wordbook 词库补缺编排 + 缺行发现（dict.md §3：user_word 反连接 dict 找「我的词库缺哪些 dict 行」）。
// 补缺属单词本域：只有反连接 user_word 的部分留守，读穿 / 增量等纯词典缓存机制已上提至 @/dict。
// 一切在线取数 best-effort：离线 / server 未实现 / 出错一律降级、不抛给调用方（dict.md：最坏后果 = 在线回填软失败）。
import { and, count, eq, notExists, sql } from 'drizzle-orm'
import { currentDbGeneration, type Db } from '@/db/client'
import { dict, userWord } from '@/db/schema'
import * as api from '@/api/dict'
import { upsertDicts } from '@/dict/dict'
import type { LocalDictRow } from '@/dict'

/** 词库补缺分页大小（每页 POST /dict/batch 的 dict_id 数）。 */
const DICT_BATCH_PAGE = 100

// 单库单飞补缺（单窗口，模块级布尔足够）；账号切换靠库世代号中止，不靠此标志。
let fillingMissing = false

// ────────────────── 缺行发现（dict.md §3：user_word 反连接 dict） ──────────────────

/** 相关子查询：该 dict_id 是否已在 dict 表落库。 */
function hasDictRow(db: Db) {
  return db.select({ one: sql`1` }).from(dict).where(eq(dict.dictId, userWord.dictId))
}

/** 词库里（is_deleted=0）dict 表尚无内容的 dict_id（补缺用；每次重算，断点续传天然成立）。 */
export async function missingDictIds(db: Db): Promise<number[]> {
  const rows = await db
    .select({ dictId: userWord.dictId })
    .from(userWord)
    .where(and(eq(userWord.isDeleted, 0), notExists(hasDictRow(db))))
    .all()
  return rows.map((r) => r.dictId)
}

/** 缺行数（补缺进度诊断，dict.md「带进度」）。 */
export async function missingDictCount(db: Db): Promise<number> {
  return (
    (
      await db
        .select({ n: count() })
        .from(userWord)
        .where(and(eq(userWord.isDeleted, 0), notExists(hasDictRow(db))))
        .get()
    )?.n ?? 0
  )
}

// ────────────────── 词库补缺（登录首灌 / 别端新增 / 本端选词后，dict.md §3） ──────────────────

/**
 * 词库补缺：反连接找缺行 → 分页 POST /dict/batch → upsert；每页重算缺行（断点续传天然成立）。
 * 后台运行、单飞、世代号护栏。终止性护栏：某页返回 0 行（server 全缺/略过）即停——否则不可取的缺行会死循环。
 */
export async function fillMissingDict(db: Db): Promise<void> {
  if (fillingMissing) return
  fillingMissing = true
  const gen = currentDbGeneration()
  try {
    for (;;) {
      if (currentDbGeneration() !== gen) return // 库已随登出/换账号切换
      const missing = await missingDictIds(db)
      if (missing.length === 0) return
      const page = missing.slice(0, DICT_BATCH_PAGE)
      let rows: LocalDictRow[]
      try {
        rows = await api.fetchDictBatch(page)
      } catch {
        return // 某页失败即停，剩余缺行下次补（缺行每次重算，续传免状态）
      }
      if (currentDbGeneration() !== gen) return
      if (rows.length === 0) return // 本页无任何新行可取（server 全缺/略过）→ 停，避免死循环
      await upsertDicts(db, rows)
    }
  } finally {
    fillingMissing = false
  }
}
