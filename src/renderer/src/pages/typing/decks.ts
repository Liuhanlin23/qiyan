export interface TypingWord {
  term: string
  phonetic: string
  meaning: string
  example?: string
  exampleZh?: string
}

export interface QwertyDeckMeta {
  id: string
  name: string
  level: string
  file: string
  /** 句子库模式：'trans-is-en'（sentences4000 格式）或 'name-is-en'（NCE / IELTS 900 双语句子格式）。 */
  sentenceFormat?: 'trans-is-en' | 'name-is-en'
}

interface QwertyRawEntry {
  name?: string
  trans?: string[]
  usphone?: string
  ukphone?: string
  lesson?: string
}

/** 从 qwerty-learner 与 NCE-Flow 导入的离线分级词库与双语句库目录（存放于 public/dicts/，按需加载）。 */
export const QWERTY_DECK_CATALOG: QwertyDeckMeta[] = [
  { id: 'xiaoxue6', name: '小学英语 (PEP)', level: '小学', file: 'xiaoxue6.json' },
  { id: 'zhongkao', name: '初中 / 中考核心', level: '初中', file: 'zhongkao.json' },
  { id: 'ket2021', name: '剑桥 KET (2021)', level: 'KET', file: 'ket2021.json' },
  { id: 'pet2024', name: '剑桥 PET (2024)', level: 'PET', file: 'pet2024.json' },
  { id: 'gaokao3500', name: '高考 3500 词', level: '高中', file: 'gaokao3500.json' },
  { id: 'cet4', name: '大学四级 CET-4', level: '四级', file: 'cet4.json' },
  { id: 'cet6', name: '大学六级 CET-6', level: '六级', file: 'cet6.json' },
  { id: 'ielts', name: '雅思 IELTS', level: '雅思', file: 'ielts.json' },
  {
    id: 'nce1-sentences',
    name: '新概念 1 句子库',
    level: '句子',
    file: 'nce1-sentences.json',
    sentenceFormat: 'name-is-en',
  },
  {
    id: 'nce2-sentences',
    name: '新概念 2 句子库',
    level: '句子',
    file: 'nce2-sentences.json',
    sentenceFormat: 'name-is-en',
  },
  {
    id: 'nce3-sentences',
    name: '新概念 3 句子库',
    level: '句子',
    file: 'nce3-sentences.json',
    sentenceFormat: 'name-is-en',
  },
  {
    id: 'nce4-sentences',
    name: '新概念 4 句子库',
    level: '句子',
    file: 'nce4-sentences.json',
    sentenceFormat: 'name-is-en',
  },
  {
    id: 'ielts-oral-900',
    name: '雅思口语 900 句',
    level: '句子',
    file: 'ielts-oral-900.json',
    sentenceFormat: 'name-is-en',
  },
  {
    id: 'sentences4000',
    name: '4000 核心例句库',
    level: '句子',
    file: 'sentences4000.json',
    sentenceFormat: 'trans-is-en',
  },
]

const deckCache = new Map<string, TypingWord[]>()

export async function loadQwertyDeck(meta: QwertyDeckMeta): Promise<TypingWord[]> {
  const cached = deckCache.get(meta.id)
  if (cached) return cached

  const res = await fetch(`./dicts/${meta.file}`)
  if (!res.ok) {
    throw new Error(`加载词库失败 (${res.status}): ${meta.file}`)
  }
  const raw = (await res.json()) as QwertyRawEntry[]

  const words: TypingWord[] = raw
    .filter((item) => typeof item.name === 'string' && item.name.trim().length > 0)
    .map((item) => {
      const phone = (item.usphone || item.ukphone || '').trim()
      const phonetic = phone ? (phone.startsWith('/') ? phone : `/${phone}/`) : ''
      const transText = Array.isArray(item.trans) ? item.trans.filter(Boolean).join('；') : ''

      if (meta.sentenceFormat === 'name-is-en') {
        const en = item.name!.trim()
        return {
          term: item.lesson || meta.name,
          phonetic: '',
          meaning: transText || '双语句子',
          example: en,
          exampleZh: transText || '双语句子',
        }
      }

      if (meta.sentenceFormat === 'trans-is-en') {
        return {
          term: item.name!.trim(),
          phonetic,
          meaning: `核心词：${item.name!.trim()}`,
          example: transText,
          exampleZh: `关键词：${item.name!.trim()}`,
        }
      }

      return {
        term: item.name!.trim(),
        phonetic,
        meaning: transText || '暂无释义',
      }
    })

  deckCache.set(meta.id, words)
  return words
}
