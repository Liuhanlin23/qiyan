// dict 行（有道原始 JSON 节点）+ 行学习状态 → 领域富类型 Word 的适配器（页面接线的共同前置）。
// 页面组件一律吃 Word（types/word.ts），门面下发 LocalDictRow（JSON 文本列）+ 数字态/epoch，本模块居中翻译。
//
// 节点形状取自 server YoudaoParser「浅清洗原样透传」（证据：server/.../YoudaoParser.java + 单测夹具 abundance.json）：
//   ec / collins / syno / rel_word / phrs = 有道节点原样；example_sentence = blng_sents_part 浅清洗。
// 有道数据字段缺失/形状不齐是常态（不可数名词无 wfs、短语无 collins…），全程防御式取值，缺则给空数组/undefined。
import type {
  CollinsEntry,
  Example,
  Inflection,
  LearnState,
  SynonymGroup,
  Word,
} from '@/types/word'
import type { WordStateBrief } from './types'
import type { LocalDictRow } from '@/dict'
import { nextDayAt } from './time'

// ────────────────── 防御式 JSON 取值原语 ──────────────────

/** 安全 JSON.parse：非字符串/空/坏 JSON 一律回 null（有道列可能为 NULL 文本或历史脏数据）。 */
function parseJson(text: string | null): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 取 obj[key]（obj 非对象则 undefined）。 */
function get(v: unknown, key: string): unknown {
  return isObj(v) ? v[key] : undefined
}

/** 有道 `l.i` 既可能是字符串（phrs/return-phrase）也可能是字符串数组（ec.trs）——统一摊平成 string[]。 */
function flatLi(node: unknown): string[] {
  const i = get(get(node, 'l'), 'i')
  if (typeof i === 'string') return i ? [i] : []
  return asArray(i).map(str).filter(Boolean)
}

/** 取 `l.i` 的首个字符串（用于单值场景 headword / return-phrase）。 */
function firstLi(node: unknown): string {
  return flatLi(node)[0] ?? ''
}

// ────────────────── 各节点 → Word 字段 ──────────────────

/** ec.word[0]：权威拼写 return-phrase.l.i + 简明释义 trs（每条 tr.l.i 摊平）+ 变形 wfs[].wf + 考试标签 exam_type。 */
function fromEc(ec: unknown): {
  word: string
  simpleSenses: string[]
  inflections: Inflection[]
  tags: string[]
} {
  const w0 = get(ec, 'word')
  const word0 = asArray(w0)[0]
  const word = firstLi(get(word0, 'return-phrase'))
  const simpleSenses = asArray(get(word0, 'trs')).flatMap((trGroup) =>
    asArray(get(trGroup, 'tr')).flatMap((tr) => flatLi(tr)),
  )
  const inflections: Inflection[] = asArray(get(word0, 'wfs'))
    .map((w) => get(w, 'wf'))
    .map((wf) => ({ label: str(get(wf, 'name')), value: str(get(wf, 'value')) }))
    .filter((f) => f.label || f.value)
  const tags = asArray(get(ec, 'exam_type')).map(str).filter(Boolean)
  return { word, simpleSenses, inflections, tags }
}

/** collins.collins_entries[].entries.entry[].tran_entry[] → CollinsEntry（pos / tran / 例句 eng_sent·chn_sent）。 */
function fromCollins(collins: unknown): CollinsEntry[] {
  return asArray(get(collins, 'collins_entries')).flatMap((ce) =>
    asArray(get(get(ce, 'entries'), 'entry')).flatMap((entry) =>
      asArray(get(entry, 'tran_entry')).map((te) => ({
        pos: str(get(get(te, 'pos_entry'), 'pos')),
        tran: str(get(te, 'tran')),
        examples: asArray(get(get(te, 'exam_sents'), 'sent')).map((s) => ({
          en: str(get(s, 'eng_sent')),
          zh: str(get(s, 'chn_sent')),
        })),
      })),
    ),
  )
}

/** syno.synos[].syno → SynonymGroup（pos / meaning=tran / words=ws[].w）。 */
function fromSyno(syno: unknown): SynonymGroup[] {
  return asArray(get(syno, 'synos'))
    .map((g) => get(g, 'syno'))
    .map((s) => ({
      pos: str(get(s, 'pos')),
      meaning: str(get(s, 'tran')),
      words: asArray(get(s, 'ws')).map((w) => str(get(w, 'w'))).filter(Boolean),
    }))
    .filter((g) => g.words.length > 0)
}

/** rel_word.rels[].rel.words[] → "word — tran"（WordDetailBody TwoLineList 按 " — " 拆分渲染）。 */
function fromRelWord(relWord: unknown): string[] {
  return asArray(get(relWord, 'rels'))
    .map((g) => get(g, 'rel'))
    .flatMap((rel) =>
      asArray(get(rel, 'words')).map((w) => {
        const head = str(get(w, 'word'))
        const tran = str(get(w, 'tran')).trim()
        return tran ? `${head} — ${tran}` : head
      }),
    )
    .filter(Boolean)
}

/** phrs.phrs[].phr → "headword — 释义"（headword.l.i 单值 + trs[].tr.l.i 拼接）。 */
function fromPhrs(phrs: unknown): string[] {
  return asArray(get(phrs, 'phrs'))
    .map((p) => get(p, 'phr'))
    .map((phr) => {
      const head = firstLi(get(phr, 'headword'))
      const tran = asArray(get(phr, 'trs'))
        .map((t) => firstLi(get(t, 'tr')))
        .filter(Boolean)
        .join('；')
      return tran ? `${head} — ${tran}` : head
    })
    .filter(Boolean)
}

/** example_sentence.sentence-pair[] → Example（英文优先带高亮的 sentence-eng，回落 sentence；中文 sentence-translation；sentence-speech 为服务端拼好的真人音频完整 URL）。 */
function fromExampleSentence(node: unknown): Example[] {
  return asArray(get(node, 'sentence-pair'))
    .map((sp) => ({
      english: str(get(sp, 'sentence-eng')) || str(get(sp, 'sentence')),
      chinese: str(get(sp, 'sentence-translation')),
      audioUrl: str(get(sp, 'sentence-speech')) || undefined,
    }))
    .filter((e) => e.english)
}

// ────────────────── 状态映射 ──────────────────

/** ec 文本 → 简明释义数组（笔记卡取首条作一行简义）。 */
export function parseSimpleSenses(ecText: string | null): string[] {
  return fromEc(parseJson(ecText)).simpleSenses
}

const STATE_BY_NUM: readonly LearnState[] = ['new', 'learning', 'review', 'relearning', 'mastered']

/** 数字态 0-4 → LearnState（越界回 'new' 兜底）。 */
export function toLearnState(state: number): LearnState {
  return STATE_BY_NUM[state] ?? 'new'
}

/** due(epoch) 相对今日窗口右开界 → 'today'（今日到期或逾期）/ 'later'；无 due 返回 undefined（仅 review/relearning 有意义）。 */
function toDueLabel(due: number | null, now: number): 'today' | 'later' | undefined {
  if (due == null) return undefined
  return due < nextDayAt(now) ? 'today' : 'later'
}

/** 音标标量列包成 /…/ 展示串（有道 ukphone/usphone 无斜杠，空则空串）。 */
function fmtPhonetic(p: string | null): string {
  return p ? `/${p}/` : ''
}

// ────────────────── 对外：行 → Word ──────────────────

/**
 * dict 行 + 学习状态 → Word。status 为 null 表示不带学习态（查词场景，词未加入词库时），此时 state/due 不设。
 * now 用校准钟 epoch ms（判 due 归今日与否）。
 */
export function dictRowToWord(row: LocalDictRow, status: WordStateBrief | null, now: number): Word {
  const ec = fromEc(parseJson(row.ec))
  const word: Word = {
    word: ec.word || row.term,
    phoneticUK: fmtPhonetic(row.ukPhonetic),
    phoneticUS: fmtPhonetic(row.usPhonetic),
    simpleSenses: ec.simpleSenses,
    collinsEntries: fromCollins(parseJson(row.collins)),
    inflections: ec.inflections,
    examples: fromExampleSentence(parseJson(row.exampleSentence)),
    derived: fromRelWord(parseJson(row.relWord)),
    phraseGroup: fromPhrs(parseJson(row.phrs)),
    synonymGroups: fromSyno(parseJson(row.syno)),
    tags: ec.tags,
  }
  if (status) {
    word.state = toLearnState(status.state)
    word.due = toDueLabel(status.due, now)
  }
  return word
}

/**
 * 缺行占位 Word（dict 未命中/补缺未完成，词表右栏与学习卡先用拼写占位，补缺后自动回归——dict.md §2）。
 * 只填 term + 学习态，其余内容空；组件对空数组/空释义已有「暂无」兜底。
 */
export function placeholderWord(term: string, status: WordStateBrief | null, now: number): Word {
  const word: Word = {
    word: term,
    phoneticUK: '',
    phoneticUS: '',
    simpleSenses: [],
    collinsEntries: [],
    inflections: [],
    examples: [],
    derived: [],
    phraseGroup: [],
    synonymGroups: [],
  }
  if (status) {
    word.state = toLearnState(status.state)
    word.due = toDueLabel(status.due, now)
  }
  return word
}
