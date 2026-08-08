# 启言（QiYan）

> 把生词读进长期记忆

启言是一款开源的英语学习桌面应用。它把「读原文 → 遇到生词 → 查词收藏 → 间隔重复」串成一条闭环：你在阅读中遇到的词，会自动进入基于 FSRS 算法的复习队列，在你快要忘记的那一刻重新出现。

**下载地址：[nvwa.world](https://nvwa.world)**（目前提供 Windows 版，macOS 测试中）

## 功能

- **单词本** —— 基于 FSRS 间隔重复算法的单词卡复习，按遗忘曲线安排每日任务；支持自建词书与官方词书。
- **查词** —— 内置词典查询，释义、音标、例句一次呈现，一键收藏进词书。
- **阅读** —— 导入 EPUB / PDF 原文阅读，划词即时翻译与查词，生词直接入库。
- **资源** —— 音标训练（英音 / 美音发音对照）、四六级真题等学习材料。

数据本地优先：学习记录存在本机 SQLite 库中，核心功能离线可用。

## 技术栈

Electron（main / preload / renderer 三进程）+ React 19 + TypeScript + Tailwind v4 + Radix，本地库为 better-sqlite3 + Drizzle。阅读引擎基于 [foliate-js](src/renderer/src/vendor/foliate-js/)（readest 的 MIT fork，详见目录内 `VENDOR.md`）。

架构与编码约定见 [CLAUDE.md](CLAUDE.md)。


## 许可证

代码以 [AGPL-3.0-or-later](LICENSE) 发布。例外：

- `src/renderer/src/vendor/foliate-js/`：MIT（随目录附带其 LICENSE）
- `src/renderer/public/phonetic/` 下的音标发音音频版权归原作者所有，来源与署名见各目录的 `index.json`

**商标声明**：「启言」「QiYan」名称及应用图标（`build/` 下品牌资源）不在开源许可的授权范围内。分发修改版本时请更换名称与图标。

## 贡献

欢迎 issue 与 PR，贡献条款见 [CONTRIBUTING.md](CONTRIBUTING.md)。
