# foliate-js（readest fork）· vendor 登记

- 来源：<https://github.com/readest/foliate-js>（`johnfactotum/foliate-js` 的 fork，readest 的生产阅读引擎）
- Commit：`98fc0d56619dca0412c301e2410c69409a793a48`（2026-07-17）
- 许可：**MIT**（见同目录 `LICENSE`，随源码保留；readest 应用本体 `apps/readest-app` 是 AGPL，只可参考不可复制，与本目录无关）
- 配对关系：`third-party/readest` 快照的 submodule gitlink 正是本 commit。**升级必须成对**——更新 readest 参照快照时同步把本目录换到新 gitlink，反之亦然，不单边动。

## 拷贝范围

- 全量源码，除 `.git` 与 `vendor/pdfjs/` 下的 pdfjs 5.7 构建产物（`pdf.mjs` / `pdf.worker.mjs` / `*.map` / `cmaps/` / `standard_fonts/`，约 12M，属运行时静态资源不入库）。
- `vendor/pdfjs/` 只保留 fork 定制过的 `annotation_layer_builder.css`、`text_layer_builder.css`。

## 使用纪律

- 本目录**只读**：不改代码、不顺手升级。确需打补丁 → 补丁单独成 commit 并在本文件登记，升级时重放。
- 业务代码不直接 import 本目录内部模块，统一经阅读域（reading）的 adapter/门面收口。

## 接线备忘（adapter 落地时处理，现状未接入任何构建产物）

- `fixed-layout.js` 顶层 import npm 包 `construct-style-sheets-polyfill`：接入时需加依赖或 alias shim。
- `pdf.js` 经 bundler alias `@pdfjs/pdf.min.mjs` 加载 pdfjs，并在运行时从 `/vendor/pdfjs/` 路径取 worker / cmaps / 字体 / CSS：需从 npm `pdfjs-dist` 拷贝到 `src/renderer/public/vendor/pdfjs/`。注意 fork 按 pdfjs **5.7** 编写，desktop 现依赖 **6.1**，接线时须验证 API 兼容。
  - ⚠️ **接 PDF 时必须先处理这个坑**：`pdf.js:1` 的 `pdfjsPath` 用的是**绝对路径** `` `/vendor/pdfjs/${path}` ``（另有 6 处引用它：workerSrc、两个 CSS、wasmUrl、cMapUrl、standardFontDataUrl）。prod 的 renderer 从 `file://` 加载，前导 `/` 解析到**盘符根**而非应用资源目录，全部取不到——dev 正常、正式版必炸。当前 `shared/books.ts` 的 `BOOK_FORMATS` 只有 `epub`，PDF 进不了阅读器，故此路径不可达、未打补丁。同根因的业务侧实例已修（`pages/resources/phonetic.tsx` 改用 `./`）。
- 引擎为无类型 ESM JS：只给 adapter 实际用到的 API 面手写薄 `.d.ts`，不全量补类型。
