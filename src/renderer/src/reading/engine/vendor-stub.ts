// 空 stub —— 顶掉 foliate `fixed-layout.js` 顶层的 `import 'construct-style-sheets-polyfill'`。
//
// 那是个纯副作用导入，为老浏览器补 `adoptedStyleSheets`；Electron 的 Chromium 原生支持，装真包纯属
// 多余，但不给打包器一个可解析的模块它就构建不过，故用本空模块 alias 掉（见 electron.vite.config.ts）。
// 另一个 alias `@pdfjs/pdf.min.mjs` 已指向真实 pdfjs，不再走这里。
export {}
