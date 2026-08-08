/**
 * 朗读的纯文本工具 —— 语言 / 脚本判定与合成前文本规整。无 DOM / 无副作用，独立单测。
 */

// CJK 主区间（含中日韩统一表意文字 + 扩展 A + 假名 + 谚文）。
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/

/** 文本是否含 CJK 字符（时长估算的脚本分支用：中文按字算速率、拉丁按词）。 */
export function isCjk(text: string): boolean {
  return CJK_RE.test(text)
}

/** 送 Edge 合成前规整：折叠所有空白为单空格并去首尾（main 侧也做一次，这里先行以便估时长/缓存 key 稳定）。 */
export function normalizeSynthText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
