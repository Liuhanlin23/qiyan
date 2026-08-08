// renderer 的本地库客户端：drizzle sqlite-proxy 实例。SQL + 参数经平台桥（dbBridge.exec/batch）到 main 执行。
// renderer 全程不碰 better-sqlite3；生产与单测跑同一套查询代码，只是执行器一个经 IPC、一个在进程内。
import {
  drizzle,
  type AsyncBatchRemoteCallback,
  type AsyncRemoteCallback,
} from 'drizzle-orm/sqlite-proxy'
import type { BatchItem } from 'drizzle-orm/batch'
import { dbBridge } from '@/platform'

/** 数据层函数统一接收的库句柄类型（供测试注入指向进程内 better-sqlite3 的同型实例）。 */
export type Db = ReturnType<typeof drizzle>

// ProxyResult.rows 声明为 unknown（get 返回单行位置数组/undefined，非严格 any[]）；drizzle 回调类型要 any[]，
// 运行时形状已由 main/dbExecutor 对齐（已被单测钉死），此处 as 收窄类型即可。
const execCallback: AsyncRemoteCallback = (sql, params, method) =>
  dbBridge.exec(sql, params, method) as Promise<{ rows: any[] }>
const batchCallback: AsyncBatchRemoteCallback = (queries) =>
  dbBridge.batch(queries) as Promise<{ rows: any[] }[]>

/**
 * 全局单例（单窗口、单登录用户）：physical open/close 在 main，这里只是转发。
 * - 单语句：drizzle 调 exec 回调 → { rows }（run=[]、all/values=位置数组的数组、get=单行位置数组/undefined）。
 * - 成批：drizzle.batch 调 batch 回调 → { rows }[]（main 包 better-sqlite3 事务，全成或全滚）。
 */
export const db: Db = drizzle(execCallback, batchCallback)

/**
 * 成批提交一组 drizzle 语句：多语句写路径先在内存组装、一次提交，禁交错读写事务。
 * 传入的应是**未执行**的查询构建器（不带 .run()/.all()）；空集为无操作。
 */
export async function runBatch(db: Db, items: BatchItem<'sqlite'>[]): Promise<void> {
  if (items.length === 0) return
  await db.batch(items as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
}

// 库世代号：每次开/关库 +1。取代旧 main 用「UserDb 对象身份」判断账号切换（renderer 的 db 是无状态单例）——
// 在飞后台任务（预取）捕获开始时的世代，落库前比对，账号切换即中止，避免写到已换的库。
let generation = 0

/** 当前库世代号。 */
export const currentDbGeneration = (): number => generation

/** 登录 / 冷启动：让 main 打开该用户库（开库 + migrate）。 */
export async function openUserDb(userId: number): Promise<void> {
  generation++
  await dbBridge.open(userId)
}

/** 登出 / 换账号：让 main 关库。 */
export async function closeUserDb(): Promise<void> {
  generation++
  await dbBridge.close()
}
