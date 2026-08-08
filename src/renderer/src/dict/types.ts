// 词典内容缓存的本地行形状（dict 表，raw_json 不下发；无缓存元数据列）。语义见 docs/feature/cache/dict.md。
// 命名一律 camelCase；列结构镜像 server dict；JSON 节点原样存文本。

// ────────────────── 词典内容（dict 表，raw_json 不下发；无缓存元数据列） ──────────────────

/** 一条本地 dict 行（读写同形，列结构镜像 server dict；JSON 节点原样存文本）。 */
export interface LocalDictRow {
  dictId: number
  term: string
  termType: number
  ukPhonetic: string | null
  usPhonetic: string | null
  ukAudioUrl: string | null
  usAudioUrl: string | null
  audioUrl: string | null
  ec: string | null
  collins: string | null
  syno: string | null
  relWord: string | null
  phrs: string | null
  individual: string | null
  exampleSentence: string | null
}
