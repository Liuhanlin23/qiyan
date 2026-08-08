import { describe, expect, it } from 'vitest'
import { cleanLookupTerm, countLookupWords, judgeLookupTerm } from './lookupTerm'

/**
 * 取词规则（docs/feature/reading/lookup.md §取词）。
 *
 * 每条测的是**为什么要这么取**，不是字符串怎么变：取词错一点，打到有道的就是一个查不到的脏 term，
 * 既让用户看到「未收录」，又把垃圾塞进服务端 Caffeine 负缓存挤占真词的缓存位（docs/feature/lookup/lookup.md §5）。
 *
 * 不可见 / 易混字符在测试里一律用 `\u` 转义构造，顺带反查源码正则里的字符没写错。
 */

describe('cleanLookupTerm', () => {
  it('剥掉 EPUB 跨行断词的软连字符——不剥则这个词永远查不中', () => {
    expect(cleanLookupTerm('so\u00ADap')).toBe('soap')
  })

  it('弯撇号归一为 ASCII——正文用 U+2019，词典拼写是 ASCII，不归一就对不上', () => {
    expect(cleanLookupTerm('don\u2019t')).toBe("don't")
  })

  it('剥首尾标点但保留词内撇号与连字符', () => {
    expect(cleanLookupTerm('"soap,"')).toBe('soap')
    expect(cleanLookupTerm("(don't)")).toBe("don't")
    expect(cleanLookupTerm('—well-known—')).toBe('well-known')
  })

  it('逐词剥而非整体剥：词间标点也要清掉', () => {
    // 整体剥首尾会把中间那个逗号留在查询词里，打到有道就是一个必然查不到的脏 term。
    expect(cleanLookupTerm('soap, and water')).toBe('soap and water')
  })

  it('跨行选区的换行折叠成单空格，与 server 归一化口径一致', () => {
    expect(cleanLookupTerm('  soap\n  and   water ')).toBe('soap and water')
  })

  it('选区带的边界空白只剥不扩——用户选什么就查什么，不去够相邻的词', () => {
    // 选区多带一格空白（拖选多拖一点 / 双击带尾随空格 / 跨行换行）是常态。
    // 若据此去够相邻词，用户会静默查到他没选的词：选 "ran" 却查出 "run well"。
    expect(cleanLookupTerm('ran ')).toBe('ran')
    expect(cleanLookupTerm(' ran')).toBe('ran')
    expect(cleanLookupTerm('ran\n')).toBe('ran')
  })

  it('选了半个词就查半个词——查不到由未收录态诚实反馈，不替用户补全', () => {
    expect(cleanLookupTerm('oap')).toBe('oap')
  })

  it('大小写不动——Polish/polish 是两个词条，模糊解析是 server 的职责', () => {
    expect(cleanLookupTerm('Polish')).toBe('Polish')
  })

  it('全是标点 / 符号的选区清成空串，据此隐藏「查词」入口', () => {
    expect(cleanLookupTerm('—— ... !?')).toBe('')
  })
})

describe('judgeLookupTerm', () => {
  it('空词 → none：工具栏不显示「查词」', () => {
    expect(judgeLookupTerm('')).toBe('none')
  })

  it('单词与短语都可查——短语正是学习者要查的', () => {
    expect(judgeLookupTerm('soap')).toBe('ok')
    expect(judgeLookupTerm('give up on')).toBe('ok')
    expect(judgeLookupTerm('get away with it')).toBe('ok')
  })

  it('复合词按一个词算，不因连字符顶掉词数上限', () => {
    expect(countLookupWords('state-of-the-art')).toBe(1)
    expect(judgeLookupTerm('state-of-the-art')).toBe('ok')
  })

  it('超过 5 个词 → too-long：不发请求，直接降级到翻译', () => {
    // 拦住「选中整段点查词」——那段文本会原样打到有道并进负缓存。
    expect(judgeLookupTerm('wash your hands with soap and water')).toBe('too-long')
  })

  it('超长（>120 字符）→ too-long，与 server 上限一致', () => {
    expect(judgeLookupTerm('a'.repeat(121))).toBe('too-long')
  })
})
