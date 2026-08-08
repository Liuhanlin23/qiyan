// 句子翻译转发原语：renderer 直连 Google/Azure 翻译接口会被 CORS / Origin 校验拦截，
// main 的 fetch 默认不带 Origin（对齐 suggest.ts）。最初移植自 readest 的 google / azure provider
// （third-party/readest .../services/translators/providers），去掉 tauri fetch 与多语言，
// 原文写死 en、译文写死中文（Google 用 zh-CN、Azure 用 zh-Hans）；Azure 已因上游换协议而偏离
// readest 实现（见下方 translateWithAzure 注释）。
//
// 与 suggest 的失败处置不同：翻译失败要让用户看到错误提示（而非静默降级），故非 200 / 超时 / 解析
// 失败一律 throw —— 经 ipcMain.handle 传播为 renderer 端 invoke 的 rejection，由弹层显示错误文案。
import { ipcMain } from 'electron'
import type { TranslateProvider, TranslateRequest } from '../shared/translate'

/** 翻译请求超时：句子翻译比联想慢，给足 10s，超时即放弃并报错。 */
const TIMEOUT_MS = 10_000

// ─────────────────────────── Google 翻译（gtx 免费接口，一步 GET）───────────────────────────

/** 调 Google 网页版 gtx 接口，返回拼接后的中文译文。 */
async function translateWithGoogle(text: string): Promise<string> {
  const url = new URL('https://translate.googleapis.com/translate_a/single')
  url.searchParams.set('client', 'gtx')
  url.searchParams.set('dt', 't')
  url.searchParams.set('sl', 'en')
  url.searchParams.set('tl', 'zh-CN')
  url.searchParams.set('q', text)

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Google translate failed with status ${res.status}`)

  // 响应形如 [[["译文段","原文段",...], ...], ...]：取 data[0] 里每段的第 0 元素拼接。
  const data = (await res.json()) as unknown
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('Google translate returned an unexpected shape')
  }
  return (data[0] as unknown[])
    .filter((seg): seg is unknown[] => Array.isArray(seg) && typeof seg[0] === 'string')
    .map((seg) => seg[0] as string)
    .join('')
}

// ─────────────────────────── Azure / Microsoft 翻译（Edge 免费接口，一步）───────────────────────────

/**
 * 调 Microsoft Edge 翻译接口，返回中文译文。
 *
 * 2026-08 微软换了协议：旧的两步流程（`edge.microsoft.com/translate/auth` 换 Bearer token 再调
 * `api-edge.cognitive.microsofttranslator.com`）已下线（auth 端点恒 404），换成免鉴权的单步
 * POST `edge.microsoft.com/translate/translatetext`（Edge 151 整页翻译抓包逆向：请求体为纯字符串
 * 数组，响应形状与旧接口一致）。readest 上游截至快照仍是旧协议，勿再对齐它。
 */
async function translateWithAzure(text: string): Promise<string> {
  const url = new URL('https://edge.microsoft.com/translate/translatetext')
  url.searchParams.set('from', 'en')
  url.searchParams.set('to', 'zh-Hans')

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([text]),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Azure translate failed with status ${res.status}`)

  // 响应形如 [{ translations: [{ text: "译文", to: "zh-Hans" }] }]。
  const data = (await res.json()) as Array<{ translations?: Array<{ text?: unknown }> }>
  const translated = data?.[0]?.translations?.[0]?.text
  if (typeof translated !== 'string') throw new Error('Azure translate returned an unexpected shape')
  return translated
}

const TRANSLATORS: Record<TranslateProvider, (text: string) => Promise<string>> = {
  google: translateWithGoogle,
  azure: translateWithAzure,
}

/** main whenReady 时注册一次。 */
export function registerTranslateIpc(): void {
  ipcMain.handle('translate:sentence', async (_event, req: TranslateRequest): Promise<string> => {
    const text = req.text.replaceAll('\n', ' ').trim()
    if (!text) return ''
    return TRANSLATORS[req.provider](text)
  })
}
