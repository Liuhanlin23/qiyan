// EPUB 元数据整形：dc:title / dc:creator 在 EPUB 里是「字符串 | 语言映射 | 数组」的多态，
// 落 user_book 前先规整成单行文本。纯函数、不碰引擎，便于单测钉住各种形状。
//
// 整形逻辑拷自 readest `apps/readest-app/src/utils/book.ts`（AGPL-3.0）。

/** 语言映射：同一个标题按语言给多份（`{ en: 'Title', zh: '标题' }`）。 */
export interface LanguageMap {
  [key: string]: string
}

/** 贡献者（作者 / 译者…）：名字本身又可能是语言映射。 */
export interface Contributor {
  name: LanguageMap
}

/** 界面语言：本项目 UI 固定中文，语言映射给了多语时优先取这一支。 */
const UI_LANG = 'zh'

/** 语言映射 → 单行文本：优先界面语言，没有则取书里给的第一支。 */
function formatLanguageMap(x: string | LanguageMap | null | undefined): string {
  if (!x) return ''
  if (typeof x === 'string') return x
  const first = Object.keys(x)[0]
  if (!first) return ''
  return x[UI_LANG] || x[first] || ''
}

/** 书的主语言码（`zh-CN` → `zh`）：多作者用哪种连接词由它决定。 */
function bookLangCode(lang: string | string[] | null | undefined): string {
  const primary = typeof lang === 'string' ? lang : lang?.[0]
  return primary ? primary.split('-')[0] : ''
}

// 多作者的连接方式：中文书走窄式（`甲 乙`，空格并列）——长式会插进「和」，人名之间读着别扭；
// 其余语言按书自己的语言给「A, B, and C」这类长式。
function listFormatter(langCode: string): Intl.ListFormat {
  if (langCode === 'zh') return new Intl.ListFormat('en', { style: 'narrow', type: 'unit' })
  try {
    return new Intl.ListFormat(langCode || UI_LANG, { style: 'long', type: 'conjunction' })
  } catch {
    // 适配：坏语言码回退。`dc:language` 是书里的原始值，野书常写 `en_US` / `zh_CN` 甚至非 ASCII，
    // 非法标签会让 Intl 抛 RangeError —— 整本书就此导不进来，为个连接词不值当。
    return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })
  }
}

export function formatTitle(title: string | LanguageMap | null | undefined): string {
  return typeof title === 'string' ? title : formatLanguageMap(title)
}

export function formatAuthors(
  contributors: string | string[] | Contributor | Contributor[] | null | undefined,
  bookLang?: string | string[] | null,
): string {
  const langCode = bookLangCode(bookLang) || 'en'
  if (Array.isArray(contributors)) {
    return listFormatter(langCode).format(
      contributors.map((c) => (typeof c === 'string' ? c : formatLanguageMap(c?.name))),
    )
  }
  return typeof contributors === 'string' ? contributors : formatLanguageMap(contributors?.name)
}
