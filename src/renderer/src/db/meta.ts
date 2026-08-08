// 框架 meta 键值表的通用读写原语。语义访问器一律归拥有它的模块（directory-convention §三『私有状态归域』）。
// 全部读写走 drizzle（经 sqlite-proxy 到 main 执行），异步。
import { eq } from 'drizzle-orm'
import type { Db } from './client'
import { meta } from './schema'

export async function getMeta(db: Db, key: string): Promise<string | null> {
  const row = await db.select({ value: meta.value }).from(meta).where(eq(meta.key, key)).get()
  return row ? row.value : null
}

/** upsert 语句（不执行）：供成批写路径与 setMeta 复用。返回值既是 BatchItem 也可 .run() 单发。 */
export function setMetaStmt(db: Db, key: string, value: string) {
  return db
    .insert(meta)
    .values({ key, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } })
}

export async function setMeta(db: Db, key: string, value: string): Promise<void> {
  await setMetaStmt(db, key, value).run()
}
