// LWW 集合的参数化构造器（形态 A′：机械件参数化、编排硬编码，sync.md §3.5）。
// 七个 LWW 集合（words / notes / settings / books / progress / annotations / bookmarks）的
// collect/apply/clear 三件套 SQL 形状完全一致，只在「表 / 自然键列 / 载荷列 / 有无墓碑」上不同——
// 由本构造器数据驱动生成，避免七份手抄的条件写。
//
// 仲裁语义（与 server 的 `>=` 覆盖互补，两端一致）：
//   apply 保留本地条件 = dirty=1 AND local.edit_time > remote.edit_time（严格大于，tie 远端赢）；
//   墓碑行物理删（本地不留死行）；clear = 自然键 + dirty=1 + edit_time=推送快照 三条件收口。
// 全部返回**未执行**的 drizzle 语句（BatchItem），由引擎合进一页 batch 原子提交；collect 走异步 SELECT。
//
// 注：七张 LWW 表的 dirty / edit_time / is_deleted 列命名一致（drizzle 属性名 == wire 字段名），
// 故构造器按固定属性名读取存储行 / 装配 wire 行；这是本模块与 schema 的约定耦合（改列名须同步此处）。
import { and, eq, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Db } from '@/db/client'

/** wire 行的公共可读形状：LWW 行必带 editTime；墓碑集合带 isDeleted（按 prop 取键/载荷时内部转 Record 访问）。 */
interface LwwWireRow {
  editTime: number
  isDeleted?: 0 | 1
}

/** 自然键列描述：键值来自 wire 行并回填到 wire（words/notes 的 dictId、settings 的 settingKey）。 */
export interface KeyColumn {
  col: AnySQLiteColumn
  /** drizzle 属性名（= 存储行属性 = insert 键 = wire 字段名，四者同名）。 */
  prop: string
  /** 键出现在 wire 行上（键值取自 wire、collect 时回填到 wire）。 */
  wire?: boolean
}

/** 业务载荷列描述：prop 同时是 drizzle 属性名、存储行属性名、wire 字段名（三者同名）。 */
export interface PayloadColumn {
  col: AnySQLiteColumn
  prop: string
  /** wire 行缺该字段时的兜底值（防御 server 省略字段）。 */
  default?: unknown
}

export interface LwwSpec {
  table: SQLiteTable
  key: KeyColumn[]
  payload: PayloadColumn[]
  hasTombstone: boolean
}

/** 一个 LWW 集合对外的三件套（engine 显式按固定顺序调用）。 */
export interface LwwCollection<Row extends LwwWireRow> {
  collectDirty(db: Db): Promise<Row[]>
  applyRemoteStmt(db: Db, row: Row): BatchItem<'sqlite'>
  clearAcceptedStmts(db: Db, rows: readonly Row[]): BatchItem<'sqlite'>[]
}

export function lwwCollection<Row extends LwwWireRow>(spec: LwwSpec): LwwCollection<Row> {
  const { table, key, payload, hasTombstone } = spec
  // 固定属性名的同步控制列（七张 LWW 表命名一致）。
  const t = table as unknown as Record<string, AnySQLiteColumn>
  const dirtyCol = t.dirty
  const editTimeCol = t.editTime
  const targetCols = key.map((k) => k.col)

  /** 自然键谓词：键值取自 wire 行 row[prop]。 */
  const keyPredicate = (row: Row): SQL =>
    and(...key.map((k) => eq(k.col, (row as Record<string, unknown>)[k.prop]))) as SQL

  /** 保留本地条件：本地脏且 editTime 严格更大 → 不接受远端。 */
  const keepLocal = (row: Row): SQL =>
    sql`not (${dirtyCol} = 1 and ${editTimeCol} > ${row.editTime})`

  /** 由 wire 行装配 INSERT 值（键 + 载荷 + editTime + dirty=0 + [isDeleted=0]）。 */
  const insertValues = (row: Row): Record<string, unknown> => {
    const v: Record<string, unknown> = {}
    for (const k of key) v[k.prop] = (row as Record<string, unknown>)[k.prop]
    for (const p of payload) v[p.prop] = (row as Record<string, unknown>)[p.prop] ?? p.default ?? null
    v.editTime = row.editTime
    v.dirty = 0
    if (hasTombstone) v.isDeleted = 0
    return v
  }

  /** ON CONFLICT DO UPDATE 的 set（载荷 + editTime + dirty + [isDeleted]，排除键列）。 */
  const conflictSet = (values: Record<string, unknown>): Record<string, unknown> => {
    const keyProps = new Set(key.map((k) => k.prop))
    const set: Record<string, unknown> = {}
    for (const [prop, val] of Object.entries(values)) if (!keyProps.has(prop)) set[prop] = val
    return set
  }

  /** 存储行 → wire 行（syncVer=0 + editTime + [isDeleted] + wire 键 + 载荷）。 */
  const toWire = (r: Record<string, unknown>): Row => {
    const w: Record<string, unknown> = { syncVer: 0, editTime: r.editTime }
    if (hasTombstone) w.isDeleted = r.isDeleted === 1 ? 1 : 0
    for (const k of key) if (k.wire) w[k.prop] = r[k.prop]
    for (const p of payload) w[p.prop] = r[p.prop] ?? p.default ?? null
    return w as unknown as Row
  }

  return {
    async collectDirty(db) {
      const rows = (await db.select().from(table).where(eq(dirtyCol, 1)).all()) as Record<
        string,
        unknown
      >[]
      return rows.map(toWire)
    },

    applyRemoteStmt(db, row) {
      if (hasTombstone && row.isDeleted === 1) {
        return db.delete(table).where(and(keyPredicate(row), keepLocal(row)))
      }
      const values = insertValues(row)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (db.insert(table) as any)
        .values(values)
        .onConflictDoUpdate({ target: targetCols, set: conflictSet(values), setWhere: keepLocal(row) })
    },

    clearAcceptedStmts(db, rows) {
      return rows.map((row) => {
        const cond = and(keyPredicate(row), eq(dirtyCol, 1), eq(editTimeCol, row.editTime))
        return row.isDeleted === 1
          ? db.delete(table).where(cond)
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (db.update(table) as any).set({ dirty: 0 }).where(cond)
      })
    },
  }
}
