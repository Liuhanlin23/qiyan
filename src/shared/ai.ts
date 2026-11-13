/** 跨进程共享的 AI 对话补全契约（支持 OpenAI 兼容接口与本地 Ollama）。 */

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiCompleteRequest {
  baseUrl: string
  apiKey: string
  model: string
  messages: AiChatMessage[]
  temperature?: number
}

export interface AiCompleteResult {
  content: string
}
