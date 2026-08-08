# styles 说明

Tailwind v4 `@theme` + 三层 token,复刻 Claude(cds)。全部手写,改即生效。

## 文件

| 文件 | 作用 |
|---|---|
| `primitives.css` | 调色盘原值(`--gray-50`…),无语义,只供 system 引用 |
| `system.css` | 语义/角色 token + 组件 token,含明暗两套 |
| `theme.css` | `@theme` 把语义 token 登记成 Tailwind 工具类(纯 `var()` 转发) |
| `globals.css` | 入口:`@import` 全部 + 全局重置 + `dark:` 变体 |
| `button.css` / `overlays.css` / `speaker.css` | 手写动效 |

数据流:`primitives → system → theme → bg-* / text-* / … → 组件`。`main.tsx` 只 import `globals.css`。

## 用法

- 组件只用语义工具类(`bg-surface-1`、`text-text-100`、`border-border-300`)。
- 禁止直用原始色(`bg-gray-20`)或写死 hex(`bg-[#fff]`)。
- 颜色随主题自动翻转,组件不写两套。

## 明暗

`:root` 亮色 → `[data-mode=dark]` 覆盖同名变量 → `@media (prefers-color-scheme)` 兜底跟系统。
只在暗色加样式用 `dark:` 前缀。

## 改 token

| 操作 | 改哪 |
|---|---|
| 调原始色 | `primitives.css` |
| 新增语义 token | `system.css` 定义(亮+暗)+ `theme.css` 接 `--color-*`,缺一不生效 |
| 改名 | system + theme + 所有 className,三处同步 |
| 删 | 先清组件引用,再删 system + theme |
