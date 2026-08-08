// wordbook 数据层的正确性单测：聚焦「为什么这些行为重要」——变更流同步语义（LWW 仲裁 / compare-and-clear /
// 墓碑物理删 / append-only 幂等）、词库四段互斥全覆盖、今日记账推导口径、词典缓存纯读只增、补缺终止与世代号护栏、
// 日边界 4:00。业务语义变了这些测试就该失败。
//
// 生产与测试跑同一套数据函数，只是执行器不同：生产经 IPC 到 main 的 better-sqlite3，
// 测试把 sqlite-proxy 回调指向进程内 better-sqlite3（复用 main/dbExecutor）。
import Database from 'better-sqlite3'
import { drizzle as betterDrizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as proxyDrizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runBatch as execBatch, runStmt as execStmt } from '../../../main/dbExecutor'

// 世代号护栏：partial-mock '@/db/client' 只覆写 currentDbGeneration（保留真 runBatch/db），供 service 测试控制账号切换。
const hoisted = vi.hoisted(() => ({ gen: { value: 1 } }))
vi.mock('@/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/client')>()
  return { ...actual, currentDbGeneration: () => hoisted.gen.value }
})
// 取数层 mock：service 补缺测试注入网络响应，不打真 HTTP（词典读穿/增量测试见 dict/dict.test.ts）。
vi.mock('@/api/dict', () => ({
  fetchDictBatch: vi.fn(),
  fetchDictUpdates: vi.fn(),
  fetchDictByTerm: vi.fn(),
}))

import { runBatch, type Db } from '@/db/client'
import type { NoteRow, ReviewLogRow, SettingsRow, WordRow } from '@/sync/protocol'
import * as api from '@/api/dict'
import * as collections from './collections'
import { settings as settingsCollection } from '@/settings/collection'
import * as words from './words'
import * as notes from './notes'
import * as reviewLog from './reviewLog'
import * as dict from '@/dict/dict'
import * as service from './service'
import { dayWindow, nextDayAt } from './time'
import type { LocalDictRow } from '@/dict'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../drizzle', import.meta.url))

interface TestDb {
  db: Db
  sqlite: Database.Database
}

function makeDb(): TestDb {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrate(betterDrizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR })
  const db = proxyDrizzle(
    async (sql, params, method) => execStmt(sqlite, { sql, params, method }) as { rows: any[] },
    async (queries) => execBatch(sqlite, queries) as { rows: any[] }[],
  )
  return { db, sqlite }
}

beforeEach(() => {
  vi.resetAllMocks()
  hoisted.gen.value = 1
})

// ────────────────── wire 行工厂 ──────────────────

function wireWord(over: Partial<WordRow> & { dictId: number }): WordRow {
  return {
    syncVer: 0, editTime: 0, isDeleted: 0, joinTime: 0, due: null, stability: 0, difficulty: 0,
    scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, state: 0, lastReview: null, ...over,
  }
}
function wireSettings(over: Partial<SettingsRow> = {}): SettingsRow {
  return { syncVer: 0, editTime: 0, settingKey: 'wordbook.newPerDay', value: '20', ...over }
}
function localDict(dictId: number, term = `w${dictId}`): LocalDictRow {
  return {
    dictId, term, termType: 1, ukPhonetic: null, usPhonetic: null, ukAudioUrl: null,
    usAudioUrl: null, audioUrl: null, ec: null, collins: null, syno: null, relWord: null,
    phrs: null, individual: null, exampleSentence: null,
  }
}

// ────────────────── 原始读/种子（测试用，非数据函数） ──────────────────

const readWord = (h: TestDb, dictId: number) =>
  h.sqlite.prepare(
    `SELECT state, due, edit_time AS editTime, join_time AS joinTime, is_deleted AS isDeleted, dirty,
            last_review AS lastReview, learning_steps AS learningSteps FROM user_word WHERE dict_id=?`,
  ).get(dictId) as { state: number; due: number | null; editTime: number; joinTime: number; isDeleted: number; dirty: number; lastReview: number | null; learningSteps: number } | undefined

const readNote = (h: TestDb, dictId: number) =>
  h.sqlite.prepare('SELECT note, edit_time AS editTime, is_deleted AS isDeleted, dirty FROM user_word_note WHERE dict_id=?')
    .get(dictId) as { note: string; editTime: number; isDeleted: number; dirty: number } | undefined

const readSetting = (h: TestDb, key = 'wordbook.newPerDay') =>
  h.sqlite.prepare('SELECT value, edit_time AS editTime, dirty FROM user_setting WHERE setting_key=?')
    .get(key) as { value: string; editTime: number; dirty: number } | undefined

/** 种一条本地 user_word 脏行（LWW 仲裁前置态，raw）。joinTime 默认 = editTime（加入即同值）；可独立指定以测加入序不被 editTime 覆盖。 */
function seedWord(h: TestDb, dictId: number, over: { editTime?: number; joinTime?: number; state?: number; due?: number | null; lastReview?: number | null; isDeleted?: number; dirty?: number } = {}): void {
  const editTime = over.editTime ?? 0
  h.sqlite.prepare(
    'INSERT INTO user_word (dict_id, due, state, last_review, join_time, edit_time, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?)',
  ).run(dictId, over.due ?? null, over.state ?? 0, over.lastReview ?? null, over.joinTime ?? editTime, editTime, over.isDeleted ?? 0, over.dirty ?? 1)
}

function seedLog(h: TestDb, dictId: number, reviewTime: number, preState: number, dirty = 0): void {
  h.sqlite.prepare(
    'INSERT INTO user_review_log (dict_id, review_time, rating, duration_ms, pre_state, pre_stability, pre_difficulty, dirty) VALUES (?,?,?,?,?,?,?,?)',
  ).run(dictId, reviewTime, 3, 0, preState, 0, 0, dirty)
}

const applyWord = (h: TestDb, row: WordRow) => runBatch(h.db, [collections.words.applyRemoteStmt(h.db, row)])
const dictIds = (h: TestDb) => (h.sqlite.prepare('SELECT dict_id AS id FROM dict ORDER BY dict_id').all() as Array<{ id: number }>).map((r) => r.id)

// ══════════════════ words 集合：LWW 仲裁（sync.md §3） ══════════════════

describe('words LWW 仲裁（与 server >= 覆盖互补，tie 远端赢）', () => {
  let h: TestDb
  beforeEach(() => { h = makeDb() })

  it('本地无行 + 非墓碑远端 → 插入（新设备 pull 灌库）', async () => {
    await applyWord(h, wireWord({ dictId: 9, state: 2, editTime: 100 }))
    expect(readWord(h, 9)).toMatchObject({ state: 2, editTime: 100, isDeleted: 0, dirty: 0 })
  })

  it('本地无行 + 远端墓碑 → 无事可做', async () => {
    await applyWord(h, wireWord({ dictId: 9, isDeleted: 1, editTime: 100 }))
    expect(readWord(h, 9)).toBeUndefined()
  })

  it('本地脏且 editTime 更大 → 保留本地待推', async () => {
    seedWord(h, 9, { state: 3, editTime: 200 })
    await applyWord(h, wireWord({ dictId: 9, state: 2, editTime: 100 }))
    expect(readWord(h, 9)).toMatchObject({ state: 3, editTime: 200, dirty: 1 })
  })

  it('本地脏但 editTime 更小 → 接受远端并清 dirty', async () => {
    seedWord(h, 9, { state: 3, editTime: 50 })
    await applyWord(h, wireWord({ dictId: 9, state: 2, editTime: 100 }))
    expect(readWord(h, 9)).toMatchObject({ state: 2, editTime: 100, dirty: 0 })
  })

  it('editTime 相等（tie）本地脏 → 接受远端（保留条件是严格大于）', async () => {
    seedWord(h, 9, { state: 3, editTime: 100 })
    await applyWord(h, wireWord({ dictId: 9, state: 2, editTime: 100 }))
    expect(readWord(h, 9)).toMatchObject({ state: 2, dirty: 0 })
  })

  it('本地干净行 → 永远接受远端', async () => {
    await applyWord(h, wireWord({ dictId: 9, state: 2, editTime: 100 }))
    await applyWord(h, wireWord({ dictId: 9, state: 1, editTime: 80 }))
    expect(readWord(h, 9)).toMatchObject({ state: 1, editTime: 80, dirty: 0 })
  })

  it('远端墓碑 + 本地不占优 → 物理删行（避免幽灵卡）', async () => {
    await applyWord(h, wireWord({ dictId: 9, state: 2, editTime: 100 }))
    await applyWord(h, wireWord({ dictId: 9, isDeleted: 1, editTime: 150 }))
    expect(readWord(h, 9)).toBeUndefined()
  })

  it('远端墓碑 + 本地脏占优 → 保留本地', async () => {
    seedWord(h, 9, { state: 3, editTime: 200 })
    await applyWord(h, wireWord({ dictId: 9, isDeleted: 1, editTime: 100 }))
    expect(readWord(h, 9)).toMatchObject({ state: 3, editTime: 200, dirty: 1 })
  })
})

describe('words collectDirty / compare-and-clear', () => {
  let h: TestDb
  beforeEach(() => { h = makeDb() })

  it('collectDirty 只收脏行，映射为 wire（syncVer=0、camelCase）', async () => {
    seedWord(h, 9, { state: 2, due: 111, editTime: 100 })
    await applyWord(h, wireWord({ dictId: 8, state: 2, editTime: 50 })) // 干净行不该被收
    const dirty = await collections.words.collectDirty(h.db)
    expect(dirty).toHaveLength(1)
    expect(dirty[0]).toMatchObject({ dictId: 9, due: 111, state: 2, editTime: 100, syncVer: 0, isDeleted: 0 })
  })

  it('editTime 匹配 → 清 dirty；在途改过（editTime 变新）→ 保留重推', async () => {
    seedWord(h, 9, { state: 2, editTime: 100 })
    await runBatch(h.db, collections.words.clearAcceptedStmts(h.db, [wireWord({ dictId: 9, editTime: 100 })]))
    expect(readWord(h, 9)).toMatchObject({ dirty: 0 })

    seedWord(h, 8, { state: 2, editTime: 100 })
    h.sqlite.prepare('UPDATE user_word SET edit_time=200 WHERE dict_id=8').run()
    await runBatch(h.db, collections.words.clearAcceptedStmts(h.db, [wireWord({ dictId: 8, editTime: 100 })]))
    expect(readWord(h, 8)).toMatchObject({ dirty: 1, editTime: 200 })
  })

  it('reconcile 时序：先 applyRemote（被拒行覆盖）再 clearAccepted → 被拒行不被误清', async () => {
    seedWord(h, 9, { state: 2, editTime: 100 })
    await applyWord(h, wireWord({ dictId: 9, state: 1, editTime: 150 })) // rejected 带回，覆盖
    await runBatch(h.db, collections.words.clearAcceptedStmts(h.db, [wireWord({ dictId: 9, editTime: 100 })]))
    expect(readWord(h, 9)).toMatchObject({ state: 1, editTime: 150, dirty: 0 })
  })
})

// ══════════════════ notes 集合：墓碑物理删 ══════════════════

describe('notes LWW（墓碑物理删）', () => {
  let h: TestDb
  beforeEach(() => { h = makeDb() })

  it('远端墓碑 + 本地不占优 → 物理删本地笔记行', async () => {
    await runBatch(h.db, [collections.notes.applyRemoteStmt(h.db, { syncVer: 0, editTime: 100, isDeleted: 0, dictId: 9, note: 'hi' })])
    await runBatch(h.db, [collections.notes.applyRemoteStmt(h.db, { syncVer: 0, editTime: 150, isDeleted: 1, dictId: 9, note: '' })])
    expect(readNote(h, 9)).toBeUndefined()
  })

  it('clearNote 置墓碑 + dirty；collectDirty → isDeleted=1；clearAccepted 墓碑 → 物理删', async () => {
    await notes.setNote(h.db, 9, 'hi', 100)
    await notes.clearNote(h.db, 9, 200)
    expect(readNote(h, 9)).toMatchObject({ isDeleted: 1, dirty: 1 })
    const dirty = await collections.notes.collectDirty(h.db)
    expect(dirty[0]).toMatchObject({ dictId: 9, isDeleted: 1, editTime: 200 } as Partial<NoteRow>)
    await runBatch(h.db, collections.notes.clearAcceptedStmts(h.db, dirty))
    expect(readNote(h, 9)).toBeUndefined() // 被接受的墓碑行物理删
  })

  it('setNote 复活墓碑行（isDeleted 归 0、dirty 重置）', async () => {
    await notes.setNote(h.db, 9, 'a', 100)
    await notes.clearNote(h.db, 9, 200)
    await notes.setNote(h.db, 9, 'b', 300)
    expect(await notes.getNote(h.db, 9)).toBe('b')
    expect(readNote(h, 9)).toMatchObject({ isDeleted: 0, dirty: 1, editTime: 300 })
  })

  it('clearNote 幂等护栏（T7）：对已墓碑（已同步 dirty=0）行再清空 → editTime/dirty 不变、不重新脏化', async () => {
    await notes.setNote(h.db, 9, 'hi', 100)
    await notes.clearNote(h.db, 9, 200)
    h.sqlite.prepare('UPDATE user_word_note SET dirty=0 WHERE dict_id=9').run() // 模拟墓碑已推送被接受
    await notes.clearNote(h.db, 9, 999) // useWordNote 空输入每击键会重复调用
    expect(readNote(h, 9)).toMatchObject({ isDeleted: 1, editTime: 200, dirty: 0 }) // editTime 不被推到 999、不重新置 dirty
  })
})

// ══════════════════ reviewLogs 集合：append-only 幂等 ══════════════════

describe('reviewLogs append-only（幂等 apply + clear）', () => {
  let h: TestDb
  beforeEach(() => { h = makeDb() })

  const wireLog = (over: Partial<ReviewLogRow> & { dictId: number; reviewTime: number }): ReviewLogRow => ({
    syncVer: 0, rating: 3, durationMs: 0, preState: 1, preStability: 0, preDifficulty: 0, ...over,
  })

  it('apply 幂等：同 (dictId, reviewTime) 重复插入不覆盖、只留一行', async () => {
    await runBatch(h.db, [collections.reviewLogs.applyRemoteStmt(h.db, wireLog({ dictId: 9, reviewTime: 1000, rating: 1 }))])
    await runBatch(h.db, [collections.reviewLogs.applyRemoteStmt(h.db, wireLog({ dictId: 9, reviewTime: 1000, rating: 3 }))])
    const rows = h.sqlite.prepare('SELECT rating FROM user_review_log WHERE dict_id=9 AND review_time=1000').all()
    expect(rows).toEqual([{ rating: 1 }]) // 首插值保留，重复静默忽略
  })

  it('collectDirty 收脏行；clearAccepted 按主键 + dirty 清（行不可变、无 editTime 比对）', async () => {
    seedLog(h, 9, 1000, 1, 1) // dirty=1
    const dirty = await collections.reviewLogs.collectDirty(h.db)
    expect(dirty[0]).toMatchObject({ dictId: 9, reviewTime: 1000, syncVer: 0 })
    await runBatch(h.db, collections.reviewLogs.clearAcceptedStmts(h.db, dirty))
    expect((h.sqlite.prepare('SELECT dirty FROM user_review_log WHERE dict_id=9 AND review_time=1000').get() as { dirty: number }).dirty).toBe(0)
  })
})

// ══════════════════ 一页多集合 apply 原子性（engine pull 应用形状） ══════════════════

describe('一页多集合 apply 合入同一 batch（原子）', () => {
  it('words + notes + settings + reviewLogs 一批全部落库', async () => {
    const h = makeDb()
    await runBatch(h.db, [
      collections.words.applyRemoteStmt(h.db, wireWord({ dictId: 1, state: 2, editTime: 10 })),
      collections.notes.applyRemoteStmt(h.db, { syncVer: 0, editTime: 10, isDeleted: 0, dictId: 1, note: 'n' }),
      settingsCollection.applyRemoteStmt(h.db, wireSettings({ editTime: 10, settingKey: 'wordbook.newPerDay', value: '30' })),
      collections.reviewLogs.applyRemoteStmt(h.db, { syncVer: 0, dictId: 1, reviewTime: 500, rating: 3, durationMs: 0, preState: 0, preStability: 0, preDifficulty: 0 }),
    ])
    expect(readWord(h, 1)?.state).toBe(2)
    expect(readNote(h, 1)?.note).toBe('n')
    expect(readSetting(h)?.value).toBe('30')
    expect(h.sqlite.prepare('SELECT count(*) n FROM user_review_log').get()).toEqual({ n: 1 })
  })
})

// ══════════════════ addWords 显式建行 + 重复加入幂等 + 墓碑复活 ══════════════════

describe('words.addWords（显式建行 state=0，db/04）', () => {
  let h: TestDb
  beforeEach(() => { h = makeDb() })

  it('批量建行 state=0、dirty=1、打 editTime + joinTime（加入即同值）', async () => {
    await words.addWords(h.db, [1, 2], 100)
    expect(readWord(h, 1)).toMatchObject({ state: 0, editTime: 100, joinTime: 100, isDeleted: 0, dirty: 1 })
    expect(readWord(h, 2)).toMatchObject({ state: 0, editTime: 100, joinTime: 100, dirty: 1 })
  })

  it('重复加入未删行 → 保持不动（不洗掉已学状态、不刷新 joinTime）', async () => {
    seedWord(h, 1, { state: 2, due: 500, editTime: 50, joinTime: 10, dirty: 0 })
    await words.addWords(h.db, [1], 300)
    expect(readWord(h, 1)).toMatchObject({ state: 2, due: 500, editTime: 50, joinTime: 10, dirty: 0 }) // 未变
  })

  it('墓碑行复活 → 重置 state=0 + 新 editTime + 新 joinTime（加入序刷新）+ dirty', async () => {
    seedWord(h, 1, { state: 2, editTime: 50, joinTime: 10, isDeleted: 1, dirty: 0 })
    await words.addWords(h.db, [1], 300)
    expect(readWord(h, 1)).toMatchObject({ state: 0, editTime: 300, joinTime: 300, isDeleted: 0, dirty: 1 })
  })

  it('评分覆盖 editTime 不动 joinTime → 加入序稳定（本特性核心）', async () => {
    // 早加入（joinTime=10）后被评分（editTime 被推到 999）；晚加入的新词 joinTime=20、editTime=20。
    seedWord(h, 1, { state: 0, joinTime: 10, editTime: 999 })
    seedWord(h, 2, { state: 0, joinTime: 20, editTime: 20 })
    const all = await words.listAll(h.db)
    expect(all.map((w) => w.dictId)).toEqual([1, 2]) // 按 joinTime，不受 editTime 影响
  })
})

// ══════════════════ removeWords 置墓碑（移出词库）+ 幂等 + 加入-移出-复活闭环 ══════════════════

describe('words.removeWords（移出词库 = 置墓碑，db/04）', () => {
  let h: TestDb
  beforeEach(() => { h = makeDb() })

  it('置墓碑 isDeleted=1 + dirty + editTime；保留 FSRS 状态（复活语义依赖，非物理删）', async () => {
    seedWord(h, 9, { state: 2, due: 500, lastReview: 400, joinTime: 10, editTime: 50, dirty: 0 })
    await words.removeWords(h.db, [9], 700)
    // 状态字段原样保留（只翻 is_deleted），删除靠墓碑传播到别端，不是物理 DELETE。
    expect(readWord(h, 9)).toMatchObject({ state: 2, due: 500, isDeleted: 1, editTime: 700, dirty: 1 })
  })

  it('只作用于未删行 → 重复移除幂等（不刷新 editTime、不脏化）', async () => {
    seedWord(h, 9, { state: 2, isDeleted: 1, editTime: 50, dirty: 0 })
    await words.removeWords(h.db, [9], 700)
    expect(readWord(h, 9)).toMatchObject({ isDeleted: 1, editTime: 50, dirty: 0 }) // 未变
  })

  it('移出→重新加入（addWords 复活）：state 归 0 + 新 joinTime（加入序刷新，从头学）', async () => {
    seedWord(h, 9, { state: 2, due: 500, joinTime: 10, editTime: 50, dirty: 0 })
    await words.removeWords(h.db, [9], 700)
    await words.addWords(h.db, [9], 900)
    expect(readWord(h, 9)).toMatchObject({ state: 0, due: null, joinTime: 900, editTime: 900, isDeleted: 0, dirty: 1 })
  })
})

// ══════════════════ 评分落库 / 标熟 / 取消标熟 ══════════════════

describe('words.applyRating / setMastered / unmaster', () => {
  let h: TestDb
  beforeEach(() => { h = makeDb() })

  it('applyRating：user_word 整行覆盖 + user_review_log 追加（一批原子）；日志幂等', async () => {
    seedWord(h, 9, { state: 0, editTime: 10, dirty: 0 })
    const word = { dictId: 9, due: 8888, stability: 2.5, difficulty: 5, scheduledDays: 3, learningSteps: 1, reps: 1, lapses: 0, state: 1, lastReview: 8000 }
    const log = { dictId: 9, reviewTime: 8000, rating: 3, durationMs: 1200, preState: 0, preStability: 0, preDifficulty: 0 }
    await words.applyRating(h.db, word, log, 8000)
    expect(readWord(h, 9)).toMatchObject({ state: 1, due: 8888, editTime: 8000, dirty: 1 })
    expect(h.sqlite.prepare('SELECT count(*) n FROM user_review_log WHERE dict_id=9 AND review_time=8000').get()).toEqual({ n: 1 })
    // 幂等：同 reviewTime 再评一次不重复插日志
    await words.applyRating(h.db, word, log, 8000)
    expect(h.sqlite.prepare('SELECT count(*) n FROM user_review_log WHERE dict_id=9').get()).toEqual({ n: 1 })
  })

  it('setMastered → state=4、dirty；保留 FSRS 字段', async () => {
    seedWord(h, 9, { state: 2, due: 500, lastReview: 400, dirty: 0 })
    await words.setMastered(h.db, 9, 700)
    expect(readWord(h, 9)).toMatchObject({ state: 4, due: 500, editTime: 700, dirty: 1 })
  })

  it('unmaster：已学过（last_review 非空）回 state=2、due 不变、learning_steps=0', async () => {
    seedWord(h, 9, { state: 4, due: 500, lastReview: 400, dirty: 0 })
    h.sqlite.prepare('UPDATE user_word SET learning_steps=2 WHERE dict_id=9').run()
    await words.unmaster(h.db, 9, 700)
    expect(readWord(h, 9)).toMatchObject({ state: 2, due: 500, learningSteps: 0, editTime: 700, dirty: 1 })
  })

  it('unmaster：从未学过（last_review 为空）回 state=0（不产生 due=null 的 state=2 幽灵）', async () => {
    seedWord(h, 9, { state: 4, due: null, lastReview: null, dirty: 0 })
    await words.unmaster(h.db, 9, 700)
    expect(readWord(h, 9)).toMatchObject({ state: 0, editTime: 700, dirty: 1 })
  })

  it('unmaster 只作用于 state=4 行', async () => {
    seedWord(h, 9, { state: 2, lastReview: 400, dirty: 0 })
    await words.unmaster(h.db, 9, 700)
    expect(readWord(h, 9)).toMatchObject({ state: 2, dirty: 0 }) // 未变
  })
})

// ══════════════════ 词表四段互斥全覆盖（含 Relearning 按到期归段） ══════════════════

describe('words.listSegment / segmentCounts（四段互斥全覆盖）', () => {
  const NOW = new Date(2026, 6, 15, 10, 0, 0).getTime() // 本地 2026-07-15 10:00
  let h: TestDb
  let nd: number
  beforeEach(() => {
    h = makeDb()
    nd = nextDayAt(NOW)
    seedWord(h, 1, { state: 0, editTime: 1 }) // 未学习 new
    seedWord(h, 2, { state: 2, due: nd - 2000, editTime: 2 }) // 待复习 due（Review 到期）
    seedWord(h, 3, { state: 2, due: nd + 2000, editTime: 3 }) // 记忆中（未到期）
    seedWord(h, 4, { state: 4, editTime: 4 }) // 已标熟 mastered
    seedWord(h, 5, { state: 3, due: nd - 1000, editTime: 5 }) // Relearning 到期 → 待复习 due
    seedWord(h, 6, { state: 1, due: null, editTime: 6 }) // Learning due 空 → 记忆中
  })

  it('segmentCounts 四段互斥、总和 = 全部行', async () => {
    const c = await words.segmentCounts(h.db, NOW)
    expect(c).toEqual({ new: 1, due: 2, memorizing: 2, mastered: 1 })
    expect(c.new + c.due + c.memorizing + c.mastered).toBe(6)
  })

  it('listSegment 各段成员正确（due 段含到期 Review + Relearning，按 due 升序）', async () => {
    expect((await words.listSegment(h.db, 'new', NOW)).map((w) => w.dictId)).toEqual([1])
    expect((await words.listSegment(h.db, 'due', NOW)).map((w) => w.dictId)).toEqual([2, 5]) // due 2000 先于 1000? 2:-2000 早于 5:-1000
    expect((await words.listSegment(h.db, 'memorizing', NOW)).map((w) => w.dictId).sort()).toEqual([3, 6])
    expect((await words.listSegment(h.db, 'mastered', NOW)).map((w) => w.dictId)).toEqual([4])
  })

  it('term 冗余来自 dict（缺行 term=null 占位）+ 前缀搜索大小写不敏感', async () => {
    await dict.upsertDicts(h.db, [localDict(2, 'Apple'), localDict(3, 'apricot')])
    const items = await words.listSegment(h.db, 'memorizing', NOW)
    expect(items.find((w) => w.dictId === 3)?.term).toBe('apricot')
    expect(items.find((w) => w.dictId === 6)?.term).toBeNull() // dict 缺行占位
    const hit = await words.listSegment(h.db, 'memorizing', NOW, { search: 'AP' })
    expect(hit.map((w) => w.dictId)).toEqual([3]) // lower(term) like 'ap%' 命中 apricot；缺行不参与
  })
})

// ══════════════════ 搜索 LIKE 通配符转义（% / _ 按字面匹配） ══════════════════

describe('words 搜索 LIKE 通配符转义（T9）', () => {
  const NOW = new Date(2026, 6, 15, 10, 0, 0).getTime()
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
    // 两词同在 new 段（state=0），命中差异只由 term 与转义决定，不被段谓词干扰。
    seedWord(h, 1, { state: 0, editTime: 1 })
    seedWord(h, 2, { state: 0, editTime: 2 })
  })

  it('% 按字面匹配（listSegment）：搜 "50%" 只命中以 50% 开头的词，不误命中 5000', async () => {
    await dict.upsertDicts(h.db, [localDict(1, '50%off'), localDict(2, '5000')])
    const hit = await words.listSegment(h.db, 'new', NOW, { search: '50%' })
    expect(hit.map((w) => w.dictId)).toEqual([1]) // 未转义会把 % 当通配符连 5000 一并命中
  })

  it('_ 按字面匹配（listSegment）：搜 "a_b" 不误命中 axb', async () => {
    await dict.upsertDicts(h.db, [localDict(1, 'a_b'), localDict(2, 'axb')])
    const hit = await words.listSegment(h.db, 'new', NOW, { search: 'a_b' })
    expect(hit.map((w) => w.dictId)).toEqual([1]) // 未转义会把 _ 当单字符通配连 axb 一并命中
  })

  it('listAll 路径同样按字面匹配（第二处 LIKE 站点）', async () => {
    await dict.upsertDicts(h.db, [localDict(1, '50%off'), localDict(2, '5000')])
    const hit = await words.listAll(h.db, { search: '50%' })
    expect(hit.map((w) => w.dictId)).toEqual([1])
  })
})

// ══════════════════ 今日记账推导（pre_state=0 判新学、按词去重、跨 4:00 窗口） ══════════════════

describe('reviewLog 今日推导（study.md §每日记账）', () => {
  it('新学=有 pre_state=0 日志的词；复习=有日志但无 pre_state=0 的词；均按词去重；跨窗口排除', async () => {
    const h = makeDb()
    const now = new Date(2026, 6, 15, 12, 0, 0).getTime()
    const { startMs, endMs } = dayWindow(now)
    seedLog(h, 1, startMs + 1000, 0) // 词1 今日新学
    seedLog(h, 1, startMs + 2000, 1) // 词1 今日又复习一次 → 仍只记新学（按词去重）
    seedLog(h, 2, startMs + 1000, 2) // 词2 今日复习（无 pre=0）
    seedLog(h, 3, startMs - 1000, 0) // 窗口前 → 不计
    seedLog(h, 4, endMs + 1000, 0) // 窗口后 → 不计
    expect(await reviewLog.todayNewCount(h.db, startMs, endMs)).toBe(1) // 仅词1
    expect(await reviewLog.todayReviewCount(h.db, startMs, endMs)).toBe(1) // 仅词2
    expect((await reviewLog.todayStudiedWords(h.db, startMs, endMs)).sort()).toEqual([1, 2])
  })
})

// ══════════════════ 日边界 4:00（anki timing.rs：凌晨属昨日、4:00 翻转） ══════════════════

describe('time.dayWindow（本地 4:00 边界）', () => {
  const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

  it('凌晨 03:59 属昨日窗口', () => {
    const w = dayWindow(at(2026, 7, 15, 3, 59))
    expect(w.startMs).toBe(at(2026, 7, 14, 4, 0))
    expect(w.endMs).toBe(at(2026, 7, 15, 4, 0))
  })

  it('04:00 整翻转进今日窗口', () => {
    const w = dayWindow(at(2026, 7, 15, 4, 0))
    expect(w.startMs).toBe(at(2026, 7, 15, 4, 0))
    expect(w.endMs).toBe(at(2026, 7, 16, 4, 0))
  })

  it('nextDayAt = 今日窗口右开界（到期判定界）', () => {
    expect(nextDayAt(at(2026, 7, 15, 10, 0))).toBe(at(2026, 7, 16, 4, 0))
  })
})

// ══════════════════ 缺行发现（词库反连接 dict，dict.md §3） ══════════════════

describe('缺行发现（词库反连接 dict）', () => {
  let h: TestDb
  beforeEach(() => { h = makeDb() })

  it('missingDictIds = 词库(is_deleted=0) 反连接 dict 找缺行', async () => {
    seedWord(h, 1, {}); seedWord(h, 2, {}); seedWord(h, 3, {}); seedWord(h, 4, { isDeleted: 1 })
    await dict.upsertDicts(h.db, [localDict(1)])
    expect(await service.missingDictIds(h.db)).toEqual([2, 3]) // 1 已缓存、4 已删
    expect(await service.missingDictCount(h.db)).toBe(2)
  })
})

// ══════════════════ service：补缺终止/世代号护栏（api mock） ══════════════════

describe('service.fillMissingDict（补缺终止 + 世代号护栏）', () => {
  let h: TestDb
  beforeEach(() => {
    h = makeDb()
    seedWord(h, 1, {}); seedWord(h, 2, {}); seedWord(h, 3, {})
  })

  it('补齐全部缺行（分页 → upsert）', async () => {
    vi.mocked(api.fetchDictBatch).mockImplementation(async (ids) => ids.map((id) => localDict(id)))
    await service.fillMissingDict(h.db)
    expect(dictIds(h)).toEqual([1, 2, 3])
    expect(await service.missingDictCount(h.db)).toBe(0)
  })

  it('终止性：某页返回 0 行（server 全缺）即停，不死循环', async () => {
    // id=3 永远取不到；页 [1,2,3]→[1,2]，页 [3]→[] → 停
    vi.mocked(api.fetchDictBatch).mockImplementation(async (ids) => ids.filter((id) => id !== 3).map((id) => localDict(id)))
    await service.fillMissingDict(h.db)
    expect(dictIds(h)).toEqual([1, 2])
    expect(vi.mocked(api.fetchDictBatch)).toHaveBeenCalledTimes(2)
  })

  it('世代号中止：取数在途换账号 → 落库前中止，不写换后账号的库', async () => {
    vi.mocked(api.fetchDictBatch).mockImplementation(async (ids) => {
      hoisted.gen.value += 1 // 模拟登出/换账号
      return ids.map((id) => localDict(id))
    })
    await service.fillMissingDict(h.db)
    expect(dictIds(h)).toEqual([]) // gen 变 → 未 upsert
    expect(vi.mocked(api.fetchDictBatch)).toHaveBeenCalledTimes(1)
  })
})

// service 词典读穿 / 词库增量键集翻页测试见 dict/dict.test.ts（读穿/增量已上提至 @/dict/service）。
