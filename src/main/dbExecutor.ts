// 本地库执行器（纯 better-sqlite3，无 electron 依赖）：把一条 ProxyStmt 在给定连接上执行、
// 按 sqlite-proxy 期望的 `{ rows }` 形状返回。生产（main/db.ts 经 IPC）与单测（进程内库）复用同一份，
// 保证「生产与测试跑同一套执行语义」。
//
// 这里是全 app 唯一动手写 SQL 执行的地方（.prepare/.raw），是被授权的平台原语——业务代码在 renderer，
// 经 drizzle sqlite-proxy 编译语句，永不触碰 better-sqlite3（红线守卫 check:no-raw-sql 只扫 renderer）。
import type { Database } from 'better-sqlite3'
import type { ProxyResult, ProxyStmt } from '../shared/db'

/** 执行一条语句。写走 run；读走 .raw() 取位置数组（proxy 按列位置回填字段）。 */
export function runStmt(sqlite: Database, { sql, params, method }: ProxyStmt): ProxyResult {
  const stmt = sqlite.prepare(sql)
  if (method === 'run') {
    stmt.run(...params)
    return { rows: [] }
  }
  const raw = stmt.raw()
  // get 返回单行位置数组或 undefined；all/values 返回位置数组的数组。
  return { rows: method === 'get' ? raw.get(...params) : raw.all(...params) }
}

/** 一批语句在单个事务内全成或全滚：多语句写路径先组装、一次提交。 */
export function runBatch(sqlite: Database, stmts: readonly ProxyStmt[]): ProxyResult[] {
  const tx = sqlite.transaction((list: readonly ProxyStmt[]) => list.map((s) => runStmt(sqlite, s)))
  return tx(stmts)
}
