// 格式表的两条守门规则：**能进书架的**（formatFromFileName，导入入口）与**能进阅读器的**（isBookFormat，
// 开书关卡 + 幽灵书判定）。两者都拿库里 / 用户给的自由字符串当输入，放宽任何一条都等于把野字符串
// 拼进文件路径，故逐条钉死。新增格式时本文件应当只需加正例，既有断言不该动。
import { describe, expect, it } from 'vitest'
import { BOOK_EXTENSIONS, formatFromFileName, isBookFormat } from './books'

describe('formatFromFileName', () => {
  it('按后缀认出支持的格式', () => {
    expect(formatFromFileName('The Old Man and the Sea.epub')).toBe('epub')
  })

  it('后缀大小写不敏感——用户机器上的 .EPUB 与 .epub 是同一种书', () => {
    expect(formatFromFileName('MOBY-DICK.EPUB')).toBe('epub')
  })

  it('不认识的后缀与无后缀一律返回 null，由调用方拒绝导入', () => {
    expect(formatFromFileName('notes.txt')).toBeNull()
    expect(formatFromFileName('README')).toBeNull()
    // 「epub」只出现在名字里而非后缀：不能凭包含关系放行，否则落盘扩展名会与真实内容对不上。
    expect(formatFromFileName('epub-guide.pdf')).toBeNull()
  })

  it('每种可选后缀都能被认回来——对话框放行的，导入必须认识', () => {
    for (const ext of BOOK_EXTENSIONS) expect(formatFromFileName(`book.${ext}`)).not.toBeNull()
  })
})

describe('isBookFormat', () => {
  it('放行表内格式，挡住表外字符串', () => {
    expect(isBookFormat('epub')).toBe(true)
    // 别端用更新版本导入的格式会经同步进到本机 user_book：元数据行照收，但进不了阅读器。
    expect(isBookFormat('pdf')).toBe(false)
  })

  it('挡住会污染文件路径的形状——format 直接参与拼 `book.<format>`', () => {
    expect(isBookFormat('../../etc/passwd')).toBe(false)
    expect(isBookFormat('')).toBe(false)
    // 原型链上的键不算「表里有」：`in` 对 toString / constructor 会误判为真。
    expect(isBookFormat('toString')).toBe(false)
    expect(isBookFormat('constructor')).toBe(false)
  })
})
