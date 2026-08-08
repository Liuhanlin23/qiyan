// 跨进程共享的本地库桥契约（main 执行器实现 / preload 传参 / renderer sqlite-proxy 消费的单一事实源）。
// main 是唯一持有 better-sqlite3 的进程；renderer 经此桥把 drizzle 编译出的参数化语句送到 main 执行。
// 形状与 drizzle-orm/sqlite-proxy 的回调契约对齐：结果一律 `{ rows }`，行值按列位置排布（main 侧 .raw() 保证）。

/** drizzle-proxy 的执行方法：run=写、all/values=多行、get=单行。 */
export type SqlMethod = 'run' | 'all' | 'values' | 'get'

/** 一条参数化语句（drizzle 编译产物）。params 为位置绑定值，sql 只含 `?` 占位、不含用户数据。 */
export interface ProxyStmt {
  sql: string
  params: unknown[]
  method: SqlMethod
}

/**
 * 执行结果，形状同 sqlite-proxy 回调期望：
 * - run → `{ rows: [] }`
 * - all/values → `{ rows: 位置数组的数组 }`
 * - get → `{ rows: 单行位置数组 | undefined }`（proxy 的 mapGetResult 直接把 rows 当作行本身）
 */
export interface ProxyResult {
  rows: unknown
}
