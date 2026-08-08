// 把 pdfjs 的运行时静态资源同步到 `src/renderer/public/vendor/pdfjs/`。
//
// 为什么需要：阅读引擎 `vendor/foliate-js/pdf.js` 渲染 PDF 时，从**固定路径** `/vendor/pdfjs/` 取
// worker / cmaps / 字体 / wasm / 两个 CSS（见该文件顶部 `pdfjsPath`）。这些路径是 vendor 里写死的，
// 不走打包器解析，只能落到 public 下。
//
// 为什么不直接入库：约 5MB 纯构建产物，且必须与 package.json 里的 `pdfjs-dist` 严格同版本——入库就
// 等于多一份会悄悄漂移的副本（vendor/foliate-js/VENDOR.md 同样把这批资源排除在拷贝范围外）。
// 故一律从 node_modules 复制，npm 包即唯一事实源；产物目录进 .gitignore。
import { createRequire } from 'node:module'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = require.resolve('pdfjs-dist/package.json')
const src = dirname(pkgPath)
const dest = join(root, 'src/renderer/public/vendor/pdfjs')
// fork 定制过的两个 CSS 由 vendor 目录保管（VENDOR.md「拷贝范围」），不来自 npm 包。
const forkCss = join(root, 'src/renderer/src/vendor/foliate-js/vendor/pdfjs')

const { version } = JSON.parse(await readFile(pkgPath, 'utf8'))
const stampPath = join(dest, '.synced-version')
if (await readFile(stampPath, 'utf8').catch(() => null) === version) process.exit(0)

await mkdir(dest, { recursive: true })
// worker 的地址由 foliate 显式设为 `/vendor/pdfjs/pdf.worker.min.mjs`。
await cp(join(src, 'build/pdf.worker.min.mjs'), join(dest, 'pdf.worker.min.mjs'))
await cp(join(src, 'cmaps'), join(dest, 'cmaps'), { recursive: true })
await cp(join(src, 'standard_fonts'), join(dest, 'standard_fonts'), { recursive: true })
// wasm 平铺到根：foliate 传的 `wasmUrl` 就是 `/vendor/pdfjs/` 本身（JBIG2 / OpenJPEG 等解码器）。
await cp(join(src, 'wasm'), dest, { recursive: true })
for (const css of ['text_layer_builder.css', 'annotation_layer_builder.css']) {
  await cp(join(forkCss, css), join(dest, css))
}
await writeFile(stampPath, version)
console.log(`[sync-pdfjs] pdfjs-dist ${version} → src/renderer/public/vendor/pdfjs/`)
