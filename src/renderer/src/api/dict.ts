// 词典取数层：wire DTO + 端点调用 + DTO→本地行映射。走静默 apiGet/apiPost（未命中/离线由上层降级）。
//
// 端点（server 三个读端点）：
//   GET  /dict/lookup?q=                    单条查词（DictVO，raw_json 不下发）
//   POST /dict/batch { dictIds }            按 id 批量取（词库补缺 / 按 id 回填）
//   GET  /dict/updates?since=&afterId=       词库词典增量，键集翻页（cache/dict.md §3）
import { apiGet, apiPost } from './request'
import type { LocalDictRow } from '@/dict/types'

// ────────────────── 词典 DTO（server DictVO；部分字段 snake_case，见 @JsonProperty） ──────────────────

/** server DictVO：JSON 节点（ec/collins/…）以嵌套 JSON 下发，本地原样 stringify 存文本（dict.md §1）。 */
interface DictVo {
  id: number
  term: string
  term_type: number
  uk_phonetic?: string | null
  us_phonetic?: string | null
  uk_audio_url?: string | null
  us_audio_url?: string | null
  audio_url?: string | null
  ec?: unknown
  collins?: unknown
  syno?: unknown
  rel_word?: unknown
  phrs?: unknown
  individual?: unknown
  example_sentence?: unknown
}

const jsonText = (v: unknown): string | null => (v == null ? null : JSON.stringify(v))

/** DictVO → 本地 dict 行：snake→camel，JSON 节点原样 stringify。 */
export function dictVoToLocal(vo: DictVo): LocalDictRow {
  return {
    dictId: vo.id,
    term: vo.term,
    termType: vo.term_type,
    ukPhonetic: vo.uk_phonetic ?? null,
    usPhonetic: vo.us_phonetic ?? null,
    ukAudioUrl: vo.uk_audio_url ?? null,
    usAudioUrl: vo.us_audio_url ?? null,
    audioUrl: vo.audio_url ?? null,
    ec: jsonText(vo.ec),
    collins: jsonText(vo.collins),
    syno: jsonText(vo.syno),
    relWord: jsonText(vo.rel_word),
    phrs: jsonText(vo.phrs),
    individual: jsonText(vo.individual),
    exampleSentence: jsonText(vo.example_sentence),
  }
}

/** 单条查词。未收录时 server 抛业务码 120002（YOUDAO_NO_RESULT），经静默模式以 ServerError(120002) 到达调用方，由 dict/service 分流三态。 */
export async function fetchDictByTerm(term: string): Promise<LocalDictRow> {
  const vo = await apiGet<DictVo>(`/dict/lookup?q=${encodeURIComponent(term)}`)
  return dictVoToLocal(vo)
}

/** 按 id 批量取：词库补缺与「按 dict_id 回填」的取数入口。空入参不发请求。 */
export async function fetchDictBatch(dictIds: readonly number[]): Promise<LocalDictRow[]> {
  if (dictIds.length === 0) return []
  const vos = await apiPost<DictVo[]>('/dict/batch', { dictIds })
  return vos.map(dictVoToLocal)
}

/** 词库词典增量（键集翻页）：入参 since/afterId，返回增量行 + 下一页游标 (nextSince, nextAfterId) + done。 */
export interface DictUpdatesResult {
  rows: LocalDictRow[]
  nextSince: number
  nextAfterId: number
  done: boolean
}

export async function fetchDictUpdates(since: number, afterId: number): Promise<DictUpdatesResult> {
  const res = await apiGet<{
    updates: DictVo[]
    nextSince: number
    nextAfterId: number
    done: boolean
  }>(`/dict/updates?since=${since}&afterId=${afterId}`)
  return {
    rows: res.updates.map(dictVoToLocal),
    nextSince: res.nextSince,
    nextAfterId: res.nextAfterId,
    done: res.done,
  }
}
