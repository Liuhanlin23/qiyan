// AI 学习辅助模块：基于设置中的 OpenAI 兼容接口（含本地 Ollama）提供语境词义解析与主题词库生成。
import { aiBridge } from '@/platform'
import { getSettings } from '@/settings'

export interface AiGeneratedWord {
  term: string
  phonetic: string
  meaning: string
  example: string
  exampleZh?: string
}

async function runPrompt(system: string, user: string, temperature = 0.4): Promise<string> {
  const s = await getSettings()
  const res = await aiBridge.complete({
    baseUrl: s.aiBaseUrl,
    apiKey: s.aiApiKey,
    model: s.aiModel,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })
  return res.content
}

/** 对指定英文单词/短语进行 AI 深度解析（释义、词根助记、地道例句、近义辨析）。 */
export async function explainWordWithAi(term: string, contextSentence?: string): Promise<string> {
  const contextPart = contextSentence?.trim()
    ? `\n所在语境句：${contextSentence.trim()}\n请优先结合该语境句解释词义。`
    : ''
  return runPrompt(
    '你是一位专业、简洁的英语学习导师。请用中文清晰分段回答，避免冗长客套。',
    `请解析英语词汇「${term.trim()}」：${contextPart}
1. 核心释义与词性（如有语境句，先说明句中含义）
2. 词根词缀或记忆技巧
3. 2 条地道英文例句（附中文翻译）
4. 常见易混词或近义词简析`,
    0.3,
  )
}

/** 根据主题让 AI 生成一组用于打字/听写练习的词汇表。 */
export async function generateTypingDeckWithAi(topic: string, count = 12): Promise<AiGeneratedWord[]> {
  const raw = await runPrompt(
    '你是一个英语词库生成器。请严格只输出 JSON 数组，不要包含 markdown 代码块或其他解释文字。',
    `请围绕主题「${topic.trim()}」生成 ${count} 个适合英语学习的常用单词或短语，返回 JSON 数组，每项格式为：
{"term":"英文单词或短语","phonetic":"/音标/","meaning":"简明中文释义","example":"一句地道英文例句","exampleZh":"例句中文翻译"}`,
    0.5,
  )

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI 未返回有效 JSON 词表，请重试')
  }

  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Array<Partial<AiGeneratedWord>>
  const items = parsed
    .filter((item) => typeof item.term === 'string' && item.term.trim().length > 0)
    .map((item) => ({
      term: item.term!.trim(),
      phonetic: typeof item.phonetic === 'string' ? item.phonetic.trim() : '',
      meaning: typeof item.meaning === 'string' ? item.meaning.trim() : '',
      example: typeof item.example === 'string' ? item.example.trim() : '',
      exampleZh: typeof item.exampleZh === 'string' ? item.exampleZh.trim() : '',
    }))

  if (items.length === 0) {
    throw new Error('AI 生成的词表为空，请更换主题重试')
  }
  return items
}
