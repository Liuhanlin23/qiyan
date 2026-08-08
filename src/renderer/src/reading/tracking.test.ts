// 阅读事件落库的单测：内核行为已由拷来的 trackerCore.test.ts 钉住，这里只钉**我们自己加的那一层**——
// ① 秒→毫秒的换算（内核按秒计、本表按毫秒存，换错了统计出来的时长会差 1000 倍，光看代码看不出来）；
// ② `fraction` 取「刚离开的那一页」的比例，不是新页的（片段结束时的位置）；
// ③ 短于下限的停留不落行（连着翻页不该记成一堆 1s 片段）；
// ④ 自然键幂等：同 `(bookHash, startTime)` 重放不叠加，且不覆盖已有行（append-only 行不可变）。
//
// 建库方式同 reading.test.ts：真 drizzle migrate 一个内存库，数据函数与生产同一套。
import Database from 'better-sqlite3'
import { drizzle as betterDrizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle as proxyDrizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runBatch as execBatch, runStmt as execStmt } from '../../../main/dbExecutor'
import type { Db } from '@/db/client'
import { userReadingEvent } from '@/db/schema'
import { addReadingEvent } from './events'
import { createReadingTracker } from './tracking'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../drizzle', import.meta.url))

function makeDb(): Db {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrate(betterDrizzle(sqlite), { migrationsFolder: MIGRATIONS_DIR })
  return proxyDrizzle(
    async (sql, params, method) => execStmt(sqlite, { sql, params, method }) as { rows: any[] },
    async (queries) => execBatch(sqlite, queries) as { rows: any[] }[],
  )
}

const HASH = 'a'.repeat(32)
/** 整秒起点：内核按秒计时，用整秒起点让断言里的毫秒值一眼可读。 */
const T0 = 1_700_000_000_000

let db: Db
/** 可控校准钟（epoch ms）：测时长必须能自己拨表。 */
let now = T0

// 假定时器：空闲截断是 120s 的真定时器，既要能拨到点，也免得测试跑完还挂着一堆待触发的 timeout。
beforeEach(() => {
  vi.useFakeTimers()
  db = makeDb()
  now = T0
})

afterEach(() => {
  vi.useRealTimers()
})

const rows = (): Promise<
  { startTime: number; durationMs: number; fraction: number; dirty: number }[]
> =>
  db
    .select({
      startTime: userReadingEvent.startTime,
      durationMs: userReadingEvent.durationMs,
      fraction: userReadingEvent.fraction,
      dirty: userReadingEvent.dirty,
    })
    .from(userReadingEvent)
    .where(eq(userReadingEvent.bookHash, HASH))
    .orderBy(userReadingEvent.startTime)
    .all()

const newTracker = () => createReadingTracker(db, HASH, () => now)

describe('createReadingTracker', () => {
  it('换页结算成一行：时长换成毫秒，fraction 取刚离开的那一页', async () => {
    const tracker = newTracker()
    await tracker.onPage(1, 100, 0.1)
    now += 30_000
    await tracker.onPage(2, 100, 0.2)

    expect(await rows()).toEqual([
      // 记的是「在第 1 页停了 30s」——比例是第 1 页的 0.1，不是刚翻到的 0.2。
      { startTime: T0, durationMs: 30_000, fraction: 0.1, dirty: 1 },
    ])
  })

  it('关书结算最后一段，且不会重复结算', async () => {
    const tracker = newTracker()
    await tracker.onPage(1, 100, 0.1)
    now += 10_000
    await tracker.stop()
    now += 10_000
    await tracker.stop()

    expect(await rows()).toEqual([{ startTime: T0, durationMs: 10_000, fraction: 0.1, dirty: 1 }])
  })

  it('停着不翻页到点自动结算，此后不再计时（空闲截断）', async () => {
    const tracker = newTracker()
    await tracker.onPage(1, 100, 0.1)
    now += 120_000
    await vi.advanceTimersByTimeAsync(120_000)
    expect(await rows()).toEqual([{ startTime: T0, durationMs: 120_000, fraction: 0.1, dirty: 1 }])

    // 结算后就暂停了：又挂了十分钟也不会凭空多出时长（人不在看，不该算阅读）。
    now += 600_000
    await tracker.stop()
    expect(await rows()).toHaveLength(1)
  })

  // 窗口切走会 stop 结算，切回来靠「同页重喂位置」续计（useReadingTracker 的 visibilitychange）。
  // 若 stop 后同页重喂被内核的「同页不重开」挡住，切回来就永远不再计时——这条钉住那个前提。
  it('stop 后同页重喂即重新开始计时，新片段从重喂那一刻起算', async () => {
    const tracker = newTracker()
    await tracker.onPage(1, 100, 0.1)
    now += 10_000
    await tracker.stop() // 窗口切走：结算第一段

    now += 600_000 // 切走期间不计时
    await tracker.onPage(1, 100, 0.1) // 切回来：同页重喂
    const resumedAt = now
    now += 30_000
    await tracker.onPage(2, 100, 0.2)

    expect(await rows()).toEqual([
      { startTime: T0, durationMs: 10_000, fraction: 0.1, dirty: 1 },
      { startTime: resumedAt, durationMs: 30_000, fraction: 0.1, dirty: 1 },
    ])
  })

  it('短于下限的停留不落行（连着翻页不记成一堆碎片）', async () => {
    const tracker = newTracker()
    await tracker.onPage(1, 100, 0.1)
    now += 1_000
    await tracker.onPage(2, 100, 0.2)
    now += 1_000
    await tracker.onPage(3, 100, 0.3)

    expect(await rows()).toEqual([])
  })
})

describe('addReadingEvent', () => {
  it('同 (bookHash, startTime) 重放不叠加、也不覆盖已有行', async () => {
    await addReadingEvent(db, { bookHash: HASH, startTime: T0, durationMs: 30_000, fraction: 0.1 })
    // 迟到的重放（同步重拉 / 外壳重挂载）：行不可变，第一条说了算。
    await addReadingEvent(db, { bookHash: HASH, startTime: T0, durationMs: 90_000, fraction: 0.9 })

    expect(await rows()).toEqual([{ startTime: T0, durationMs: 30_000, fraction: 0.1, dirty: 1 }])
  })
})
