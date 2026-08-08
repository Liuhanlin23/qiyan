# App 图标资源

打包时嵌进应用包的图标。目录名 `build/` 是 electron-builder 的默认 `buildResources`，
它会自动认领 `icon.icns`（macOS）、`icon.ico`（Windows）与 `icon.png`（Linux），
无需在 `../electron-builder.yml` 里逐平台写 icon 路径。

**只在打包产物上生效**：`npm run release:win` / `release:mac` / `release:linux` 出来的
安装包与可执行文件会带上图标；`npm run dev` 跑的是 node_modules 里的 Electron 可执行文件，
Windows / Linux 任务栏顶的仍是 Electron 默认图标（macOS 例外，见下表 `icon.png` 一行）。

| 文件 | 用途 |
| --- | --- |
| `app-icon.png` | 设计源图，1254×1254。改图标只改这个，其余三个由下面的命令重新生成 |
| `icon.png` | 1024×1024 母版。dev 期 `src/main/appIcon.ts` 拿它设 Dock 图标；Linux 打包也取它 |
| `icon.icns` | macOS 应用包图标 |
| `icon.ico` | Windows exe 图标，同时被 NSIS 安装程序认领 |

图形铺满画布，四周不留边距——留边距会让图标在任务栏 / 桌面的固定格子里比周边应用小一圈。

## 重新生成

改完 `app-icon.png` 后，在 `../`（desktop 根）执行：

```bash
node scripts/gen-icons.mjs
```

脚本裁掉源图四周的透明边，把图形本体拉满 1024×1024 母版，再降采样出三个平台的成品。
只依赖 Node 内置模块，Windows / macOS / Linux 都能跑。

源图要求：PNG、非隔行、8 位深，图形本体四周是**全透明**像素（脚本靠 alpha 裁边）。
本体应当接近正方形——长宽差超过 2% 脚本会告警，因为拉满画布时形变会开始可见。
