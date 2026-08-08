# 启言桌面端

「启言」英语学习 App 的桌面端：Electron（main / preload / renderer 三进程）+ React 19 + TypeScript + Tailwind v4 + Radix/CDS，本地库为 better-sqlite3 + Drizzle。

## 常用命令

```bash
npm run dev               # 启动开发（electron-vite）
npm run typecheck         # 类型检查（node + web 两套 tsconfig 全跑）
npm run test              # vitest 单测（跑在 Electron 内嵌 Node 里，与应用共用 electron ABI；勿用 npx vitest 直启）
npm run db:generate       # 改 db/schema.ts 后生成 drizzle 迁移
npm run check:no-raw-sql  # 校验渲染层没有裸 SQL（.prepare）
npm run rebuild           # 维修命令：Electron 升级后或 better-sqlite3 报 ABI 错时重编原生模块（日常无需手动切 ABI）
```

## 规范真源（内部文档）

目录 / 分层 / IPC 约定、接口与错误处理、技术选型，以及业务规则（feature）与本地表结构（db）的规范文档在私有仓 `qiyan-internal` 中维护，公开仓不包含。外部贡献者以代码现状与下面的红线为准。

## 红线（完整规则在上述规范里）

- 路由用 **HashRouter**（Electron 走 `file://`，必须 hash）。
- **TDD 常设豁免（纯视觉工作）**：样式 / 布局 / CDS token 与组件使用免「测试先行」，验收 = 符合 cds-web + Demo 展厅人工走查；紧邻的逻辑（状态 / 派生数据 / 计算 / 事件处理）仍必须测试先行。
- 样式与组件：统一使用 `components/ui/` 下的 CDS 组件与 Tailwind token，不手写裸 hex / px（内部有 `cds-web` skill 约束，外部贡献参照现有组件写法）。
- 本地库只经 Drizzle 访问，渲染层**禁止裸 SQL**；改表结构 = 改 `db/schema.ts` + `npm run db:generate`。
- 页面只从业务域模块的 `index` 门面导入（`wordbook` / `dict` / `settings` / `lookup`），不深入模块内部文件。
- renderer 侧**只有 `platform/`** 允许接触 `window.electronAPI/dbAPI/shellAPI/suggestAPI` 桥。
- `src/renderer/src/vendor/foliate-js/` 是阅读引擎（readest 的 **MIT fork**）的**只读 vendor**：不改内部代码、不单独升级（须与上游 readest 快照成对换版本），业务代码不直接 import 其内部模块，经阅读域 adapter 收口——来源 / commit / 接线备忘见目录内 `VENDOR.md`。

## UI Demo 展厅（重要规则）

当我让你「构建 / 做一个 UI demo」时，**默认直接把它加进 UI Demo 展厅**，不要另起临时页面或独立入口：

1. 在 `src/renderer/src/pages/demos/`（复杂 demo 放 `examples/` 子目录）下新建 demo 组件，用模拟数据，按真实主内容区的风格来写。
2. 在 [src/renderer/src/pages/demos/registry.tsx](src/renderer/src/pages/demos/registry.tsx) 的 `DEMOS` 数组里追加一项 `DemoEntry`，列表页 `/demos` 与详情页自动收录，**无需改路由**。

展厅仅 DEV 注册（`import.meta.env.DEV`），不进生产包。demo 挂在 AppShell 内（带侧栏），预览到的就是「放进真实 app 里」的样子。加完告诉我访问 `#/demos` 预览即可。
