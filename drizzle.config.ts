// drizzle-kit 配置：本地 SQLite（每用户一个库文件）。schema 是唯一真相，住在 renderer 数据层
// （meta 表 + 词书六张表合并于一处）。`npm run db:generate` 据此产出 ./drizzle 下带序号的
// SQL migration + journal（进 git，打包走 extraResources），main 开库时 migrate 执行。
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/renderer/src/db/schema.ts',
  out: './drizzle',
})
