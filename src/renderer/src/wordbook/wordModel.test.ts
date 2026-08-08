// wordModel 适配器单测：钉死「有道原始 JSON 节点 → 领域 Word」的字段级映射契约（规则 7：映射口径变了就该失败）。
// 用真实夹具 dict-abundance.json（从 server 单测夹具 abundance.json 抽取干净 dict 列，节点原样）——
// 保证适配器对真实有道形状成立，而非对臆想的形状成立。另覆盖防御式降级（坏 JSON / 缺节点 / 缺行占位）与状态映射。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { dictRowToWord, placeholderWord, toLearnState } from './wordModel'
import type { WordStateBrief } from './types'
import type { LocalDictRow } from '@/dict'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/dict-abundance.json', import.meta.url))
const abundance = JSON.parse(readFileSync(FIXTURE, 'utf8')) as LocalDictRow

// 固定 now = 2026-01-15 10:00 本地；次日 4:00 为窗口右开界。到期判定用它。
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime()
const BEFORE_NEXT_DAY = new Date(2026, 0, 15, 20, 0, 0, 0).getTime() // 今日窗口内
const AFTER_NEXT_DAY = new Date(2026, 0, 20, 10, 0, 0, 0).getTime() // 数日后

/** 一个内容全空的 dict 行（各 JSON 列为 null）——测防御式降级。 */
function emptyRow(overrides: Partial<LocalDictRow> = {}): LocalDictRow {
  return {
    dictId: 1,
    term: 'ghost',
    termType: 1,
    ukPhonetic: null,
    usPhonetic: null,
    ukAudioUrl: null,
    usAudioUrl: null,
    audioUrl: null,
    ec: null,
    collins: null,
    syno: null,
    relWord: null,
    phrs: null,
    individual: null,
    exampleSentence: null,
    ...overrides,
  }
}

describe('dictRowToWord — 真实有道夹具（abundance）', () => {
  const w = dictRowToWord(abundance, null, NOW)

  it('权威拼写取 ec.word[0].return-phrase.l.i；音标包成 /…/', () => {
    expect(w.word).toBe('abundance')
    expect(w.phoneticUK).toBe('/əˈbʌndəns/')
    expect(w.phoneticUS).toMatch(/^\/.*\/$/)
  })

  it('简明释义摊平 ec.word[0].trs[].tr[].l.i（字符串数组，词性前缀在文本内）', () => {
    expect(w.simpleSenses.length).toBeGreaterThan(0)
    expect(w.simpleSenses[0]).toContain('大量')
    expect(w.simpleSenses[0]).toMatch(/^n\./) // 词性前缀嵌在释义串里
  })

  it('考试标签取 ec.exam_type（string[]）', () => {
    expect(w.tags).toEqual(['高中', 'CET4', 'CET6', '考研', 'IELTS', 'GRE', 'SAT'])
  })

  it('柯林斯：pos←pos_entry.pos、tran←tran、例句 en←eng_sent/zh←chn_sent', () => {
    expect(w.collinsEntries.length).toBeGreaterThan(0)
    const first = w.collinsEntries[0]
    expect(first.pos).toBe('N-SING-COLL')
    expect(first.tran).toContain('abundance')
    expect(first.examples[0].en).toContain('Mexico')
    expect(first.examples[0].zh).toContain('墨西哥')
  })

  it('近义词组：meaning←syno.tran、words←ws[].w', () => {
    const g = w.synonymGroups[0]
    expect(g.pos).toBe('n.')
    expect(g.meaning).toContain('充裕')
    expect(g.words).toContain('plenty')
  })

  it('派生词：rel_word.rels[].rel.words[] 拼成 "word — tran"（供 TwoLineList 拆分）', () => {
    expect(w.derived[0]).toBe('abundant — 丰富的；充裕的；盛产')
  })

  it('固定搭配：phrs headword — 释义', () => {
    expect(w.phraseGroup[0]).toBe('in abundance — 大量的；丰富的；充足的')
  })

  it('例句：英文优先 sentence-eng（带高亮）、中文 sentence-translation', () => {
    expect(w.examples.length).toBeGreaterThan(0)
    expect(w.examples[0].english).toContain('<b>abundance</b>') // 带高亮的 sentence-eng
    expect(w.examples[0].chinese).toContain('加拿大猞猁')
  })

  it('无 wfs 的不可数名词：inflections 为空数组（不抛错）', () => {
    expect(w.inflections).toEqual([])
  })
})

describe('dictRowToWord — 防御式降级', () => {
  it('各 JSON 列为 null：不抛错，内容字段全空，word 回落 term', () => {
    const w = dictRowToWord(emptyRow(), null, NOW)
    expect(w.word).toBe('ghost')
    expect(w.simpleSenses).toEqual([])
    expect(w.collinsEntries).toEqual([])
    expect(w.examples).toEqual([])
    expect(w.tags).toEqual([])
  })

  it('坏 JSON 文本：吞掉解析异常回落空，不污染其它列', () => {
    const w = dictRowToWord(emptyRow({ ec: '{不是合法json', collins: 'null' }), null, NOW)
    expect(w.word).toBe('ghost')
    expect(w.collinsEntries).toEqual([])
  })
})

describe('状态映射', () => {
  it('数字态 0-4 → LearnState', () => {
    expect(['new', 'learning', 'review', 'relearning', 'mastered'].map((_, i) => toLearnState(i))).toEqual([
      'new',
      'learning',
      'review',
      'relearning',
      'mastered',
    ])
  })

  it('越界数字态回落 new', () => {
    expect(toLearnState(9)).toBe('new')
  })

  it('due 在今日窗口内 → today，之后 → later，无 due → undefined', () => {
    const today: WordStateBrief = { state: 2, due: BEFORE_NEXT_DAY }
    const later: WordStateBrief = { state: 2, due: AFTER_NEXT_DAY }
    expect(dictRowToWord(emptyRow(), today, NOW).due).toBe('today')
    expect(dictRowToWord(emptyRow(), later, NOW).due).toBe('later')
    expect(dictRowToWord(emptyRow(), { state: 0, due: null }, NOW).due).toBeUndefined()
  })

  it('带状态时 state 落到 Word.state', () => {
    expect(dictRowToWord(emptyRow(), { state: 3, due: BEFORE_NEXT_DAY }, NOW).state).toBe('relearning')
  })
})

describe('placeholderWord — 缺行占位', () => {
  it('只留 term + 学习态，内容空（补缺后由真行覆盖）', () => {
    const w = placeholderWord('phantom', { state: 1, due: null }, NOW)
    expect(w.word).toBe('phantom')
    expect(w.state).toBe('learning')
    expect(w.simpleSenses).toEqual([])
    expect(w.collinsEntries).toEqual([])
  })
})
