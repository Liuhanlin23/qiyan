// 元数据整形的形状契约测试。EPUB 的 dc:title / dc:creator 允许「字符串 | 语言映射 | 数组」自由组合，
// 这些分支平时全靠导入一本真书才会走到——测试把它们钉死，免得整形逻辑退化成只认字符串那一支，
// 导致一部分书进书架时标题/作者变成 `[object Object]` 或空白。
import { describe, expect, it } from 'vitest'
import { formatAuthors, formatTitle } from './metadata'

describe('formatTitle', () => {
  it('字符串标题原样返回', () => {
    expect(formatTitle('The Old Man and the Sea')).toBe('The Old Man and the Sea')
  })

  it('语言映射优先取界面语言（zh）那一支', () => {
    expect(formatTitle({ en: 'The Old Man and the Sea', zh: '老人与海' })).toBe('老人与海')
  })

  it('语言映射没有界面语言时退回书里给的第一支（而不是空白）', () => {
    expect(formatTitle({ fr: 'Le Vieil Homme et la Mer', en: 'The Old Man and the Sea' })).toBe(
      'Le Vieil Homme et la Mer',
    )
  })

  it('缺标题给空串，由调用方回退文件名', () => {
    expect(formatTitle(undefined)).toBe('')
    expect(formatTitle({})).toBe('')
  })
})

describe('formatAuthors', () => {
  it('单个作者：字符串与 { name } 对象两种形状都收', () => {
    expect(formatAuthors('Ernest Hemingway')).toBe('Ernest Hemingway')
    expect(formatAuthors({ name: { en: 'Ernest Hemingway' } })).toBe('Ernest Hemingway')
  })

  it('多作者按书的语言连接（英文书用长式）', () => {
    expect(formatAuthors([{ name: { en: 'Ann' } }, { name: { en: 'Bob' } }], 'en')).toBe('Ann and Bob')
    expect(formatAuthors(['Ann', 'Bob', 'Cid'], ['en-US'])).toBe('Ann, Bob, and Cid')
  })

  it('中文书的多作者不插「和」，只空格并列', () => {
    expect(formatAuthors(['甲', '乙'], 'zh-CN')).toBe('甲 乙')
  })

  it('书语言缺失时按英文连接（不至于因为没写 dc:language 就丢作者）', () => {
    expect(formatAuthors(['Ann', 'Bob'])).toBe('Ann and Bob')
  })

  it('缺作者给空串', () => {
    expect(formatAuthors(undefined)).toBe('')
  })

  // 坏语言码不该炸掉整次导入：`dc:language` 是书里的原始值，Intl 只认合法 BCP 47 标签。
  it.each(['en_US', 'zh_CN', '中文'])('语言码 %s 非法时回退英文连接，不抛', (lang) => {
    expect(formatAuthors(['Ann', 'Bob'], lang)).toBe('Ann and Bob')
  })
})
