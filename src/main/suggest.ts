// 有道 suggest 转发原语：renderer 直连有道被 Origin 校验 403，main 的 fetch 默认不带 Origin 头
// （docs/feature/lookup/lookup.md §2）。仅做请求与响应裁剪：无缓存、无记账、不抛业务错误——
// 非 200 / 超时 / 解析不出一律返回空数组（联想是增强能力，失败静默）。
import { ipcMain } from 'electron'
import type { SuggestEntry } from '../shared/suggest'

/** 有道 suggest 端点（docs/feature/lookup/lookup.md §2）。 */
const SUGGEST_URL = 'https://dict.youdao.com/suggest?num=8&doctype=json'

/** 转发超时：联想失败快速放弃，不拖住输入。 */
const TIMEOUT_MS = 3000

/** main whenReady 时注册一次。 */
export function registerSuggestIpc(): void {
  ipcMain.handle('suggest:query', async (_event, q: string): Promise<SuggestEntry[]> => {
    try {
      const res = await fetch(`${SUGGEST_URL}&q=${encodeURIComponent(q)}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) return []
      const json = (await res.json()) as {
        data?: { entries?: Array<{ entry?: unknown; explain?: unknown }> }
      }
      const entries = json?.data?.entries
      if (!Array.isArray(entries)) return []
      // 响应裁剪：只取 entry/explain 两字段回传 renderer。
      return entries
        .filter((e): e is { entry: string; explain?: unknown } => typeof e?.entry === 'string')
        .map((e) => ({ entry: e.entry, explain: typeof e.explain === 'string' ? e.explain : '' }))
    } catch {
      return [] // 超时 / 网络 / 解析失败：静默降级为无候选
    }
  })
}
