// SyncEngine **类自身的接线**测试（sync.md §3.4 客户端回合 / §4 逃生舱）——两份收敛仿真
//（sync/convergence.test.ts、reading/convergence.test.ts、sync/convergence-full.test.ts）都在文件头明说
// 「SyncEngine 类自身的接线不在本测试范围」，因为它绑死了 db 单例与 api 模块；那三份验证的是「机械件 + 规格化编排」。
// 本文件补上剩下那一半：**真实 SyncEngine 实例**（new 出来直接 runRoundSafe / forceReset，
// 刻意不调 start()——避开 setInterval 与假定时器），只把它绑死的三样东西换成替身：
//
//   ① db 单例：`vi.mock('@/platform')` 把 dbBridge.exec/batch 指向进程内 better-sqlite3
//      （复用 main/dbExecutor 的 runStmt/runBatch）⇒ 真实 db 单例、真实 runBatch、真实九个集合模块原样工作；
//   ② api 模块：`vi.mock('@/api/sync')` 转发给 sync-testkit 的九集合 FakeServer；需要时改成抛错 / 挂起，
//      用来构造故障与竞态（stopped 门、断点续传、单飞）；
//   ③ 副作用模块：toast / purgeRemovedBookFiles / fillMissingDict 换成 spy（只看调用时机与参数，不做真事）。
//
// 于是这里能钉住、且只能在这里钉住的东西：回合编排顺序、防污染 stopped 门、首灌锚点、补缺钩子、
// 删书文件收尾的时机、fail-loudly 提示、时钟校准持久化、逃生舱语义。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── vi.mock 全部写在文件顶部（hoisting）；工厂返回的函数体只在被调用时才解引用下面的模块级变量 ──

/** 当前测试的内存库：每个用例重建，dbBridge 转发到它（生产 db 单例因此指向本用例的库）。 */
let currentSqlite: import('better-sqlite3').Database | null = null

vi.mock('@/platform', () => ({
  dbBridge: {
    open: async () => {},
    close: async () => {},
    exec: async (sql: string, params: unknown[], method: 'run' | 'all' | 'get' | 'values') =>
      execStmt(currentSqlite!, { sql, params, method }),
    batch: async (stmts: { sql: string; params: unknown[]; method: 'run' | 'all' | 'get' | 'values' }[]) =>
      execBatch(currentSqlite!, stmts),
  },
  // 下面几个桥本用例用不到，但 @/api/request 等模块会 import，缺了会在模块求值期炸。
  authBridge: { get: async () => null, set: async () => {}, clear: async () => {} },
  booksBridge: {},
  shellBridge: {},
  suggestBridge: {},
  translateBridge: {},
  ttsBridge: {},
}))

/** api.pull / api.push 的当前实现（每个用例装配；默认转发给 FakeServer）。 */
let pullImpl: (req: SyncPullRequest) => Promise<SyncPullResponse>
let pushImpl: (req: SyncPushRequest) => Promise<SyncPushResponse>

vi.mock('@/api/sync', () => ({
  pull: (req: SyncPullRequest) => pullImpl(req),
  push: (req: SyncPushRequest) => pushImpl(req),
}))

const toastErrorSpy = vi.fn()
const toastWarningSpy = vi.fn()
vi.mock('@/lib/toast', () => ({
  toast: {
    error: (m: string) => toastErrorSpy(m),
    warning: (m: string) => toastWarningSpy(m),
    info: (m: string) => m,
  },
}))

/** 删书后的本机文件收尾（fs 桥编排）——只 spy 调用时机与参数。 */
const purgeSpy = vi.fn()
vi.mock('@/reading/library', () => ({
  purgeRemovedBookFiles: (hashes: readonly string[]) => {
    purgeSpy([...hashes])
    return Promise.resolve()
  },
}))

/** 词库补缺（后台取数）——只 spy 计数。 */
const fillMissingSpy = vi.fn()
vi.mock('@/wordbook/service', () => ({
  fillMissingDict: () => {
    fillMissingSpy()
    return Promise.resolve()
  },
}))

import { runBatch as execBatch, runStmt as execStmt } from '../../../main/dbExecutor'
import { db } from '@/db/client'
import { getMeta } from '@/db/meta'
import { AuthError } from '@/api/request'
import { addWords } from '@/wordbook/words'
import { setNote } from '@/wordbook/notes'
import * as booksData from '@/reading/books'
import { SyncEngine } from './engine'
import type {
  BookRow,
  SettingsRow,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  WordRow,
} from './protocol'
import {
  bookHashOf,
  dirtyCounts,
  dumpState,
  FakeServer,
  getCursor,
  migrateNewSqlite,
  NO_DIRTY,
  tableCounts,
  type Device,
} from './sync-testkit'

/** 服务端时钟：默认贴着本地钟（offset≈0，不触发 notifyClockSkew），E11 单独换一只带偏差的。 */
const realClock = { now: () => Date.now() }

const H1 = bookHashOf(1)
const H2 = bookHashOf(2)

const settingsRow = (settingKey: string, value: string, editTime: number): SettingsRow => ({
  syncVer: 0,
  editTime,
  settingKey,
  value,
})
const bookRow = (bookHash: string, editTime: number, patch: Partial<BookRow> = {}): BookRow => ({
  syncVer: 0,
  editTime,
  isDeleted: 0,
  bookHash,
  title: `书 ${bookHash.slice(-2)}`,
  author: '作者',
  format: 'epub',
  importedAt: editTime,
  ...patch,
})
const wordRow = (dictId: number, editTime: number): WordRow => ({
  syncVer: 0,
  editTime,
  isDeleted: 0,
  dictId,
  joinTime: editTime,
  due: null,
  stability: 0,
  difficulty: 0,
  scheduledDays: 0,
  learningSteps: 0,
  reps: 0,
  lapses: 0,
  state: 0,
  lastReview: null,
})

/** 一个可手动 resolve 的 Promise（构造「网络在飞」的竞态）。 */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('SyncEngine 接线（sync.md §3.4 回合编排 / 防污染护栏 / §4 逃生舱）', () => {
  let sqlite: import('better-sqlite3').Database
  /** 供 sync-testkit 的 dump / 计数工具用（db 是**生产单例**，不是新建的 proxy 实例）。 */
  let dev: Device
  let server: FakeServer
  let engine: SyncEngine

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    toastErrorSpy.mockClear()
    toastWarningSpy.mockClear()
    purgeSpy.mockClear()
    fillMissingSpy.mockClear()
    sqlite = migrateNewSqlite()
    currentSqlite = sqlite
    dev = { name: 'E', db, sqlite }
    server = new FakeServer(realClock)
    pullImpl = async (req) => server.pull(req)
    pushImpl = async (req) => server.push(req)
    engine = new SyncEngine()
  })

  afterEach(() => {
    engine.stop() // 本文件从不调 start()，这里只是防御性收尾
    vi.restoreAllMocks()
    sqlite.close()
    currentSqlite = null
  })

  const metaOf = (key: string): string | null => getMetaSync(key)
  const getMetaSync = (key: string): string | null =>
    ((sqlite.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined)
      ?.value ?? null)

  // ────────────────── E1 回合编排 ──────────────────

  it('E1 回合编排：有脏行 → pull → push → 收口 pull；收口后脏行 0、游标 = 服务端最大号、lastSyncAt 有值', async () => {
    server.seed({ settings: [settingsRow('wordbook.newPerDay', '30', 1000)] })
    await addWords(db, [11, 12], 2000) // 本地脏行

    await engine.runRoundSafe()

    expect(server.calls, 'E1 一回合 = pullLoop → pushDirty → 收口 pullLoop').toEqual([
      'pull',
      'push',
      'pull',
    ])
    expect(dirtyCounts(dev), 'E1 收口后九表无脏行').toEqual(NO_DIRTY)
    expect(await getCursor(db), 'E1 游标 = 服务端最大号（收口 pull 把自己发号的行拉回）').toBe(
      server.maxVer(),
    )
    expect(tableCounts(dev).words, 'E1 本地两条词行还在').toBe(2)
    expect(tableCounts(dev).settings, 'E1 服务端那条设置已拉下来').toBe(1)
    expect(server.count('words'), 'E1 两条词行已到服务端').toBe(2)

    const status = engine.getStatus()
    expect(status.lastSyncAt, 'E1 lastSyncAt 有值').not.toBeNull()
    expect(status.lastError, 'E1 无错误').toBeNull()
    expect(status.running, 'E1 回合结束后 running 复位').toBe(false)
    expect(status.cursor, 'E1 状态里的游标缓存 = 服务端最大号').toBe(server.maxVer())
    expect(status.pendingDirty, 'E1 push 后重算的待推脏行为 0').toBe(0)
  })

  // ────────────────── E2 无脏行不收口 ──────────────────

  it('E2 无脏行不收口：库干净 → 一回合只 pull 不 push、不做收口 pull（空回合近乎免费）', async () => {
    server.seed({ settings: [settingsRow('wordcard.accent', '"uk"', 1000)] })

    await engine.runRoundSafe()

    expect(server.calls, 'E2 只有一次 pull（无脏行 → 不 push、不收口）').toEqual(['pull'])
    expect(server.pushCalls, 'E2 push 调用数 0（空 push 短路在客户端就发生）').toBe(0)
    expect(tableCounts(dev).settings, 'E2 设置照常拉下来').toBe(1)
    expect(engine.getStatus().lastError).toBeNull()
  })

  // ────────────────── E3 stopped 防污染门（换账号护栏） ──────────────────

  // 「网络在飞时登出」用 impl 内部调 stop() 精确建模：await 返回时 stopped 必已置好，
  // 不靠 setTimeout 撞时序（撞不上就退化成空转的假绿）。gate 只用来钉「确实进了那个 await」。
  it('E3a stopped 门（pull 在飞）：await 返回后不写库——游标不动、无行落库', async () => {
    const gate = deferred<SyncPullResponse>()
    let pullCalls = 0
    pullImpl = async () => {
      pullCalls++
      engine.stop() // 网络在飞时登出 / 换账号：db 单例已可能指向新库
      return gate.promise
    }

    const round = engine.runRoundSafe()
    gate.resolve({
      changes: { words: [wordRow(99, 5000)], settings: [settingsRow('wordbook.newPerDay', '99', 5000)] },
      nextSince: 42,
      done: true,
      serverTimeMs: Date.now(),
    })
    await round

    expect(pullCalls, 'E3a 确实发出过 pull 并拿到了带行的响应（否则本用例是空转）').toBe(1)
    expect(await getCursor(db), 'E3a 游标不动（写穿 = 污染新账号库）').toBe(0)
    expect(tableCounts(dev), 'E3a 一行都没落库').toEqual(NO_DIRTY)
    expect(metaOf('clock_offset_ms'), 'E3a 连时钟校准都没落盘（stopped 门在 calibrate 之前）').toBeNull()
  })

  it('E3b stopped 门（push 在飞）：await 返回后不做 reconcile——脏行保留待下次登录续推、游标不动', async () => {
    await addWords(db, [21, 22], 1000)
    const gate = deferred<SyncPushResponse>()
    let pushCalls = 0
    pushImpl = async () => {
      pushCalls++
      engine.stop()
      return gate.promise
    }

    const round = engine.runRoundSafe()
    gate.resolve({ maxAssignedVer: 7, rejected: {}, skippedInvalid: 0, serverTimeMs: Date.now() })
    await round

    expect(pushCalls, 'E3b 确实走到了 push 的 await（否则本用例是空转）').toBe(1)
    expect(dirtyCounts(dev).words, 'E3b 未做 compare-and-clear，脏行留库等下次登录续推').toBe(2)
    expect(await getCursor(db), 'E3b 游标不动').toBe(0)
    expect(server.pullCalls, 'E3b 收口 pull 没有发生（pushDirty 在 stopped 门后直接返回 false）').toBe(1)
  })

  /**
   * E3c：stopped 门只挡「写库」，不挡「发请求」——pullLoop 因 stopped 提前返回后，runRound 仍会往下走进
   * pushDirty，把当前库的脏行**发出去**，再在回执后才撞上第二道 stopped 门。同时这一回合还会更新
   * lastSyncAt / 清 lastError，设置页看上去像一次成功同步。
   * 两者都不导致数据损坏（collectAllDirty 读的是**当前** db 单例，推的是当前账号自己的行；且不落库不清 dirty），
   * 但都与「停手」的直觉有出入 —— 钉住现状，口径归报告「待拍板」（#3 / #4）。
   */
  it('E3c stopped 门的边界（现状钉桩）：pullLoop 停手后仍会发出一次 push；该回合仍记为「同步成功」', async () => {
    await addWords(db, [31], 1000)
    let pushCalls = 0
    pullImpl = async () => {
      engine.stop()
      return { changes: {}, nextSince: 0, done: true, serverTimeMs: Date.now() }
    }
    pushImpl = async (req) => {
      pushCalls++
      return server.push(req)
    }

    await engine.runRoundSafe()

    expect(pushCalls, 'E3c 现状：stopped 之后 push 照发（护栏在回执之后，不在请求之前）').toBe(1)
    expect(dirtyCounts(dev).words, 'E3c 但回执不落库：dirty 保留，下次登录续推').toBe(1)
    expect(await getCursor(db), 'E3c 游标不动').toBe(0)
    expect(engine.getStatus().lastSyncAt, 'E3c 现状：停手回合仍更新 lastSyncAt（设置页会显示成功）').not.toBeNull()
  })

  // ────────────────── E4 AuthError 停手 ──────────────────

  it('E4 AuthError：runRoundSafe 不抛、lastError = auth（停手等重新登录，不退避重试）', async () => {
    pullImpl = async () => {
      throw new AuthError('令牌失效')
    }

    await expect(engine.runRoundSafe(), 'E4 静默回合不抛给调用方').resolves.toBeUndefined()
    expect(engine.getStatus().lastError, 'E4 lastError 用哨兵值 auth 而非消息').toBe('auth')
    expect(engine.getStatus().lastSyncAt, 'E4 失败回合不更新 lastSyncAt').toBeNull()
  })

  // ────────────────── E5 一般失败与恢复（断点续传） ──────────────────

  it('E5 一般失败与恢复：第二页抛网络错 → 第一页已应用的行与游标保留；下回合从断点续传，无重复无遗漏', async () => {
    // 三条设置行，强制每页 1 行（limit 由本用例接管，逼出多页）
    server.seed({
      settings: [
        settingsRow('wordbook.newPerDay', '31', 1000),
        settingsRow('wordcard.accent', '"uk"', 1001),
        settingsRow('reading.fontSize', '20', 1002),
      ],
    })
    let pulls = 0
    pullImpl = async (req) => {
      pulls++
      if (pulls === 2) throw new Error('模拟网络中断')
      return server.pull({ since: req.since, limit: 1 })
    }

    await engine.runRoundSafe()
    expect(engine.getStatus().lastError, 'E5 一般失败记消息（不是 auth）').toBe('模拟网络中断')
    expect(tableCounts(dev).settings, 'E5 第一页已应用的行保留').toBe(1)
    const breakpoint = await getCursor(db)
    expect(breakpoint, 'E5 游标停在第一页的断点上（不回滚、不跳过）').toBe(1)

    // 下回合从断点续传
    await engine.runRoundSafe()
    expect(engine.getStatus().lastError, 'E5 恢复后 lastError 清 null').toBeNull()
    expect(tableCounts(dev).settings, 'E5 三行到齐（无遗漏）').toBe(3)
    expect(await getCursor(db), 'E5 游标追平服务端最大号').toBe(server.maxVer())
    expect(dumpState(dev).settings.map((r) => r.settingKey), 'E5 无重复行（自然键 upsert 兜底也逐条对得上）').toEqual(
      ['reading.fontSize', 'wordbook.newPerDay', 'wordcard.accent'],
    )
  })

  // ────────────────── E6 单飞 ──────────────────

  it('E6 单飞：running 期间并发调 runRoundSafe → 只跑一回合（api 调用计数不翻倍）', async () => {
    const gate = deferred<SyncPullResponse>()
    let pulls = 0
    pullImpl = async (req) => {
      pulls++
      if (pulls === 1) return gate.promise
      return server.pull(req)
    }

    const first = engine.runRoundSafe()
    const second = engine.runRoundSafe() // running=true 已同步置好 → 直接返回
    const third = engine.runRoundSafe()
    gate.resolve({ changes: {}, nextSince: 0, done: true, serverTimeMs: Date.now() })
    await Promise.all([first, second, third])

    expect(pulls, 'E6 三次调用只产生一次 pull').toBe(1)
    expect(server.pushCalls, 'E6 无脏行 → 无 push').toBe(0)
    // 单飞标志复位后仍可正常再跑一回合
    await engine.runRoundSafe()
    expect(pulls, 'E6 回合结束后单飞标志复位，下一次照常发 pull').toBe(2)
  })

  // ────────────────── E7 首灌锚点（词典增量水位线） ──────────────────

  it('E7 首灌锚点：游标 0 起步全量拉完（done）→ dict_updates_since = 本次 serverTimeMs；游标非 0 的常规回合不触碰它', async () => {
    const firstServerTime = 1_700_000_000_000
    server = new FakeServer({ now: () => firstServerTime })
    pullImpl = async (req) => server.pull(req)
    pushImpl = async (req) => server.push(req)
    server.seed({ settings: [settingsRow('wordbook.newPerDay', '30', 1000)] })

    expect(metaOf('dict_updates_since'), 'E7 首灌前无水位线').toBeNull()
    await engine.runRoundSafe()
    expect(metaOf('dict_updates_since'), 'E7 首灌完成锚点：水位线 = 本次 serverTimeMs').toBe(
      String(firstServerTime),
    )
    expect(await getCursor(db), 'E7 首灌后游标非 0（后续回合不再是首灌）').toBe(server.maxVer())

    // 常规回合（游标非 0）：serverTimeMs 变了、且**确实拉到了新行**，也不许触碰水位线
    const laterServerTime = firstServerTime + 999_999
    const cursorAfterFirstLoad = await getCursor(db)
    server = new FakeServer({ now: () => laterServerTime })
    // 新服务端号池从 1 起：先灌够 cursorAfterFirstLoad 条占位行，后面这两条才落在游标之上、真的会被拉下来
    for (let i = 0; i < cursorAfterFirstLoad; i++) {
      server.seed({ settings: [settingsRow(`filler.k${i}`, '1', 900)] })
    }
    server.seed({
      settings: [settingsRow('wordcard.accent', '"uk"', 2000), settingsRow('reading.fontSize', '20', 2001)],
    })
    await engine.runRoundSafe()
    expect(tableCounts(dev).settings, 'E7 常规回合确实拉到了新行（否则本段是空转）').toBe(3)
    expect(metaOf('dict_updates_since'), 'E7 游标非 0 的常规回合不触碰水位线').toBe(
      String(firstServerTime),
    )
  })

  /**
   * 报告 #1：`startSince` 是**本次 pullLoop 调用进入时**的游标（engine.ts:195）。首灌翻页到一半失败后，
   * 游标已推进到断点，下回合续传那一轮 `startSince > 0` ⇒ `startSince === 0 && res.done` 永不成立 ⇒
   * 首灌锚点（词典增量水位线初值）**再也不会落下**，`getDictUpdatesSince` 一直返回 0，
   * 下一次日常词典增量刷新会以 `since=0` 请求全量增量历史。
   * 本用例断言的是**应然**（续传拉完 = 首灌完成 ⇒ 锚点该落下），当前实现做不到 → `it.fails` 标记预期失败。
   */
  it.fails('E7-resume 首灌中途失败 → 续传拉完后应补上首灌锚点【当前实现不会，见报告 #1】', async () => {
    const serverTime = 1_700_000_555_000
    server = new FakeServer({ now: () => serverTime })
    server.seed({
      settings: [
        settingsRow('wordbook.newPerDay', '31', 1000),
        settingsRow('wordcard.accent', '"uk"', 1001),
        settingsRow('reading.fontSize', '20', 1002),
      ],
    })
    let pulls = 0
    pullImpl = async (req) => {
      pulls++
      if (pulls === 2) throw new Error('首灌第二页断网')
      return server.pull({ since: req.since, limit: 1 })
    }

    await engine.runRoundSafe() // 首灌中断在第二页
    expect(metaOf('dict_updates_since'), '中断时锚点当然还没落（前提）').toBeNull()
    expect(await getCursor(db), '游标已推进到断点（前提）').toBe(1)

    await engine.runRoundSafe() // 续传把剩下的拉完
    expect(await getCursor(db), '全量确实拉完了（前提）').toBe(server.maxVer())
    expect(
      metaOf('dict_updates_since'),
      '【报告 #1】续传拉完 = 首灌完成，锚点应落下；实际恒为 null',
    ).toBe(String(serverTime))
  })

  it('E7-empty 空库首灌：拉不到任何行也算首灌完成 → 水位线照样落下（否则词典增量永远无初值）', async () => {
    const serverTime = 1_700_000_123_456
    server = new FakeServer({ now: () => serverTime })
    pullImpl = async (req) => server.pull(req)

    await engine.runRoundSafe()
    expect(metaOf('dict_updates_since'), 'E7-empty 空页 done=true 同样触发锚点').toBe(String(serverTime))
    expect(await getCursor(db), 'E7-empty 空页游标仍为 0').toBe(0)
  })

  // ────────────────── E8 删书文件收尾 ──────────────────

  it('E8a pull 页含 books 墓碑 → purgeRemovedBookFiles 收到正确 hash 列表（活行不入列）', async () => {
    server.seed({ books: [bookRow(H1, 1000), bookRow(H2, 1001)] })
    await engine.runRoundSafe()
    expect(purgeSpy, 'E8a 全是活行 → 不调 purge').not.toHaveBeenCalled()

    server.seed({ books: [bookRow(H1, 2000, { isDeleted: 1 })] })
    await engine.runRoundSafe()

    expect(purgeSpy, 'E8a 拉到墓碑 → 调一次 purge').toHaveBeenCalledTimes(1)
    expect(purgeSpy.mock.calls[0][0], 'E8a 只带墓碑行的 hash，活行不入列').toEqual([H1])
    expect(tableCounts(dev).books, 'E8a 本地墓碑应用 = 物理删，只剩另一本').toBe(1)
  })

  it('E8b push 被拒的 books 墓碑：reconcile 阶段**不直接调** purge，由收口 pull 统一触发（恰一次）', async () => {
    // 本地有一条 books 脏行（改名，editTime 较早）
    server.seed({ books: [bookRow(H1, 1000)] })
    await engine.runRoundSafe()
    await booksData.renameBook(db, H1, '本地改的书名', 2000)
    expect(dirtyCounts(dev).books, 'E8b 本地确有一条 books 脏行').toBe(1)
    purgeSpy.mockClear()

    // 服务端在**本回合的开局 pull 之后**才出现更新的墓碑 ⇒ 本地脏行 push 必被拒（2000 < 3000）
    let seeded = false
    pullImpl = async (req) => {
      const res = server.pull(req)
      if (!seeded) {
        seeded = true
        server.seed({ books: [bookRow(H1, 3000, { isDeleted: 1 })] })
      }
      return res
    }
    let rejectedBooks = 0
    pushImpl = async (req) => {
      const res = server.push(req)
      rejectedBooks += (res.rejected.books ?? []).length
      return res
    }

    await engine.runRoundSafe()

    expect(rejectedBooks, 'E8b 前提成立：push 确实被拒回一条 books 墓碑（否则测的不是 reconcile 那条路）').toBe(
      1,
    )
    expect(purgeSpy, 'E8b 同一条墓碑只触发一次 purge——reconcile 不调，收口 pull 调').toHaveBeenCalledTimes(
      1,
    )
    expect(purgeSpy.mock.calls[0][0], 'E8b 收口 pull 带回同一条墓碑').toEqual([H1])
    expect(tableCounts(dev).books, 'E8b 本地行已随墓碑物理删').toBe(0)
    expect(dirtyCounts(dev), 'E8b 被拒行的 dirty 由 rejected 应用清掉，不再重推').toEqual(NO_DIRTY)
  })

  // ────────────────── E9 补缺钩子 ──────────────────

  it('E9 补缺钩子：pull 应用过 words 行 → fillMissingDict 恰一次；纯 settings 页 → 不调', async () => {
    server.seed({ settings: [settingsRow('wordbook.newPerDay', '30', 1000)] })
    await engine.runRoundSafe()
    expect(fillMissingSpy, 'E9 纯 settings 页不触发词库补缺').not.toHaveBeenCalled()

    server.seed({ words: [wordRow(51, 2000), wordRow(52, 2001)] })
    await engine.runRoundSafe()
    expect(fillMissingSpy, 'E9 一轮 pullLoop 里应用过 words 行 → 补缺恰调一次（不按行数翻倍）').toHaveBeenCalledTimes(
      1,
    )
  })

  /**
   * 报告 #2（与 #1 同根）：`appliedWords` 是**单次 pullLoop 调用内**的局部标志，钩子在循环出口才触发。
   * 首灌翻页到一半失败时，含 words 的那一页已落库、标志已置真，但异常从 pullLoop 抛出 ⇒ 钩子被跳过；
   * 续传那一轮若余下页面不含 words，`appliedWords` 恒假 ⇒ 词库补缺**再也不会被触发**，
   * 这批词的词典内容一直缺（直到用户本端再选词、或别端又推来 words 行）。
   * 本用例断言的是**应然**（首灌把词行搬进来了 ⇒ 补缺该被触发过），当前实现做不到 → `it.fails`。
   */
  it.fails('E9-resume 首灌中途失败：words 已落库但补缺钩子被跳过，续传轮也不再触发【见报告 #2】', async () => {
    server.seed({ words: [wordRow(41, 1000)] }) // ver 1（第一页）
    server.seed({ settings: [settingsRow('wordcard.accent', '"uk"', 1001)] }) // ver 2
    server.seed({ settings: [settingsRow('reading.fontSize', '20', 1002)] }) // ver 3
    let pulls = 0
    pullImpl = async (req) => {
      pulls++
      if (pulls === 2) throw new Error('首灌第二页断网')
      return server.pull({ since: req.since, limit: 1 })
    }

    await engine.runRoundSafe()
    expect(tableCounts(dev).words, '含 words 的第一页确实已落库（前提）').toBe(1)
    expect(fillMissingSpy, '中断时钩子还没轮到（前提）').not.toHaveBeenCalled()

    await engine.runRoundSafe() // 续传：余下两页不含 words
    expect(await getCursor(db), '全量确实拉完了（前提）').toBe(server.maxVer())
    expect(
      fillMissingSpy,
      '【报告 #2】首灌把词行搬进来了，词库补缺应被触发过一次；实际零次',
    ).toHaveBeenCalled()
  })

  // ────────────────── E10 skippedInvalid fail-loudly ──────────────────

  it('E10 skippedInvalid fail-loudly：多批累计 → toast.error 恰一条、总数正确', async () => {
    server.skippedInvalidPerPush = 3
    const ids = Array.from({ length: 201 }, (_, i) => i + 1) // 201 行 → 200 + 1 两批
    await addWords(db, ids, 1000)

    await engine.runRoundSafe()

    expect(server.pushCalls, 'E10 201 行脏行 → 200+1 两批（sync.md §3.4）').toBe(2)
    expect(toastErrorSpy, 'E10 一次推送只提示一条（跳过后 dirty 已清、不再重推）').toHaveBeenCalledTimes(1)
    expect(toastErrorSpy.mock.calls[0][0], 'E10 提示里是两批累计的总数 6').toContain('6')
  })

  it('E10-zero skippedInvalid = 0 → 静默（不打扰用户）', async () => {
    await addWords(db, [61, 62], 1000)
    await engine.runRoundSafe()
    expect(toastErrorSpy, 'E10-zero 无非法行 → 无提示').not.toHaveBeenCalled()
  })

  // ────────────────── E11 时钟校准持久化 ──────────────────

  it('E11 时钟校准：回执 serverTimeMs 与本地偏差大 → offset 落 meta（clock_offset_ms）+ toast.warning', async () => {
    const SKEW = 10 * 60 * 1000 // 本地慢 10 分钟，超 5 分钟阈值
    server = new FakeServer({ now: () => Date.now() + SKEW })
    pullImpl = async (req) => server.pull(req)
    pushImpl = async (req) => server.push(req)

    await engine.runRoundSafe()

    const offset = Number(metaOf('clock_offset_ms'))
    expect(Math.abs(offset - SKEW), `E11 offset 落盘（实测 ${offset}，期望 ≈${SKEW}）`).toBeLessThan(5000)
    expect(toastWarningSpy, 'E11 偏差超阈值 → 大声提示（故意不节流）').toHaveBeenCalled()
  })

  it('E11-quiet 偏差在阈值内 → offset 照样落盘但不提示', async () => {
    await engine.runRoundSafe()
    expect(metaOf('clock_offset_ms'), 'E11-quiet offset 恒落盘（校准是每回合的事）').not.toBeNull()
    expect(toastWarningSpy, 'E11-quiet 阈值内静默').not.toHaveBeenCalled()
  })

  // ────────────────── E12 逃生舱 forceReset ──────────────────

  it('E12 forceReset：best-effort 推完脏行 → 清空九表 + dict 缓存 → 游标 0 → 全量重灌', async () => {
    // 服务端存量 + 本地脏行 + 本地缓存（dict 也在 LOCAL_TABLES 清库名单里）
    server.seed({
      settings: [settingsRow('wordbook.newPerDay', '30', 1000)],
      books: [bookRow(H2, 1001)],
    })
    await addWords(db, [71, 72], 2000)
    await setNote(db, 71, '本地未推的笔记', 2001)
    sqlite.prepare('INSERT INTO dict (dict_id, term, term_type) VALUES (?,?,?)').run(71, 'seventy-one', 1)
    expect(dirtyCounts(dev).words, 'E12 forceReset 前确有脏行').toBe(2)

    await engine.forceReset()

    expect(server.count('words'), 'E12 脏行被 best-effort 推完（没白丢）').toBe(2)
    expect(server.count('notes'), 'E12 笔记同样推上去了').toBe(1)
    expect(dirtyCounts(dev), 'E12 重灌回来的行一律 dirty=0').toEqual(NO_DIRTY)
    expect(await getCursor(db), 'E12 清库归 0 后重新拉满，游标 = 服务端最大号').toBe(server.maxVer())
    expect(tableCounts(dev), 'E12 九表内容 = 服务端全量（推上去的 + 别端存量）').toEqual({
      ...NO_DIRTY,
      words: 2,
      notes: 1,
      settings: 1,
      books: 1,
    })
    expect(
      sqlite.prepare('SELECT count(*) AS n FROM dict').get(),
      'E12 dict 缓存随清库一并清空（随后由词库补缺重建，sync.md §4）',
    ).toEqual({ n: 0 })
    expect(engine.getStatus().lastError, 'E12 逃生舱成功后无错误').toBeNull()
    expect(engine.getStatus().lastSyncAt, 'E12 lastSyncAt 更新').not.toBeNull()
  })

  it('E12-fail push 抛错也照样清库重灌（best-effort 语义）：未推成功的本地脏行按约定丢失', async () => {
    server.seed({ settings: [settingsRow('wordcard.accent', '"uk"', 1000)] })
    await addWords(db, [81], 2000)
    pushImpl = async () => {
      throw new Error('推送失败')
    }

    await engine.forceReset()

    expect(server.count('words'), 'E12-fail 脏行没能推上去').toBe(0)
    expect(tableCounts(dev).words, 'E12-fail 未 push 成功的脏行清库即丢（sync.md §4 已声明的代价）').toBe(0)
    expect(tableCounts(dev).settings, 'E12-fail 服务端存量照常全量重灌').toBe(1)
    expect(await getCursor(db), 'E12-fail 重灌后游标 = 服务端最大号').toBe(server.maxVer())
    expect(dirtyCounts(dev), 'E12-fail 重灌回来的行 dirty=0').toEqual(NO_DIRTY)
    expect(engine.getStatus().lastError, 'E12-fail push 失败被内层吞掉，不算逃生舱失败').toBeNull()
  })

  it('E12-stopped forceReset 同样受 stopped 门保护（登出后点重置不清库）', async () => {
    await addWords(db, [91], 1000)
    engine.stop()
    await engine.forceReset()
    expect(tableCounts(dev).words, 'E12-stopped 停手后 forceReset 直接返回，不动库').toBe(1)
    expect(server.pullCalls, 'E12-stopped 也不发任何请求').toBe(0)
  })

  // getMeta 与裸 SQL 读的一致性（本文件的 metaOf 走裸 SQL，这里钉一次两条路同源）
  it('metaOf 与生产 getMeta 读同一行（本文件断言基座的自检）', async () => {
    await engine.runRoundSafe()
    expect(await getMeta(db, 'clock_offset_ms')).toBe(metaOf('clock_offset_ms'))
  })
})
