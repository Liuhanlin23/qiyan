/**
 * 划词查词的取词规则（docs/feature/reading/lookup.md §取词）—— 纯字符串函数，不碰 DOM，
 * 便于在 node 环境单测。
 *
 * 铁律：**取词只服务查词**。清洗结果单独作为 `EngineSelection.lookupTerm` 回抛，绝不回写选区的
 * `text` / `cfi`——用户拖到哪就高亮到哪，标注语义不受取词影响。
 *
 * **用户选什么就查什么**：只归一化（剥空白与标点），不猜他想选的是别的。选了半个词就查半个词，
 * 查不到诚实显示未收录并降级到翻译——替用户「补全」会静默查到他没选的词，比查不到更糟。
 *
 * 正则里的不可见 / 易混字符一律用 `\u` 转义写出，别在源码里留肉眼看不见的字面量。
 */

/** EPUB 跨行断词插入的软连字符（U+00AD，不可见）：不剥则断开的 `soap` 永远查不中。 */
const SOFT_HYPHEN = /­/g

/** 正文默认弯撇号（U+2019 / U+02BC），词典是 ASCII 撇号：`don’t` 不归一就对不上拼写。 */
const CURLY_APOSTROPHE = /[’ʼ]/g

/** 短语查词的词数上限：覆盖 `get away with it` 这类，排除整句（lookup.md §取词·守卫与降级）。 */
export const LOOKUP_MAX_WORDS = 5

/** 查询词长度上限，与 server controller / service 一致。 */
export const LOOKUP_MAX_LENGTH = 120

/** 剥掉一个词首尾的非字母数字字符（词**内**的 `'` 与 `-` 因此得以保留）。 */
function stripEdgePunctuation(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '')
}

/**
 * 清洗为查询词：剥软连字符 → 弯撇号归一 → **逐词**剥首尾标点 → 折叠空白。
 * 逐词剥而非整体剥，否则 `soap, and water` 中间那个逗号会留在查询词里。
 *
 * 大小写不动：`term` 码点精确匹配、`Polish`/`polish` 是两个词条，大小写与屈折形的模糊解析
 * 是 server（有道回源）的职责（docs/feature/lookup/lookup.md §3）。
 */
export function cleanLookupTerm(raw: string): string {
  return raw
    .replace(SOFT_HYPHEN, '')
    .replace(CURLY_APOSTROPHE, "'")
    .split(/\s+/)
    .map(stripEdgePunctuation)
    .filter(Boolean)
    .join(' ')
}

/** 查询词的词数（已清洗过的词，空串为 0）。 */
export function countLookupWords(term: string): number {
  return term ? term.split(' ').length : 0
}

/**
 * 取词后的可查性判定（lookup.md §取词·守卫与降级）：
 * - `none`：清洗后为空（全是标点 / 符号）→ 工具栏隐藏「查词」入口
 * - `ok`：1 ~ 5 个词且不超长 → 正常查
 * - `too-long`：超词数或超长度 → 不发请求，浮层直接给降级态（主动作是「翻译这段」）
 */
export type LookupTermVerdict = 'none' | 'ok' | 'too-long'

export function judgeLookupTerm(term: string): LookupTermVerdict {
  const words = countLookupWords(term)
  if (words === 0) return 'none'
  if (words > LOOKUP_MAX_WORDS || term.length > LOOKUP_MAX_LENGTH) return 'too-long'
  return 'ok'
}
