// main 进程 AI 转发原语：支持 OpenAI 兼容接口（OpenAI / DeepSeek / 通义 / SiliconFlow）及本地 Ollama。
// 在 main 进程发起请求以绕过 renderer CORS 限制。
import { ipcMain } from 'electron'
import type { AiCompleteRequest, AiCompleteResult } from '../shared/ai'

const AI_TIMEOUT_MS = 45_000

async function completeChat(req: AiCompleteRequest): Promise<AiCompleteResult> {
  const base = req.baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new Error('请先在设置中配置 AI 接口地址（Base URL）')
  const model = req.model.trim()
  if (!model) throw new Error('请先在设置中配置 AI 模型名称')

  const endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (req.apiKey.trim()) {
    headers.Authorization = `Bearer ${req.apiKey.trim()}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: req.messages,
        temperature: req.temperature ?? 0.4,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`AI 请求失败 (${res.status}): ${errText.slice(0, 200) || res.statusText}`)
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }
    if (data.error?.message) throw new Error(data.error.message)
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) throw new Error('AI 返回内容为空')
    return { content }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('AI 请求超时，请检查网络或本地 Ollama 服务状态')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export function registerAiIpc(): void {
  ipcMain.handle('ai:complete', (_e, req: AiCompleteRequest) => completeChat(req))
}
