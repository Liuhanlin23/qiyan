// Edge「大声朗读」语音合成引擎（main 侧，无 electron 依赖，便于纯函数单测；IPC 注册见 tts.ts）。
//
// 移植自 readest 的 edgeTTS.ts / EdgeTTSClient（third-party/readest .../libs/edgeTTS.ts,
// .../services/tts）的 Node wss 路径，去掉 https 代理回退、tauri / cloudflare 分支与离线缓存，
// 只留 wss 直连（引擎仅 Edge、无兜底，见 docs/feature/reading/tts.md）。readest 应用本体为 AGPL、
// 只可参考不可复制（CLAUDE.md），此处为参照协议重写——同 main/translate.ts 既有做法。
//
// 失败（连接失败 / 超时 / 无音频）一律 throw，经 ipcMain.handle 传播为 renderer 的 invoke rejection，
// 由上层决定提示与回滚（初始化失败则回滚并提示）。
import { createHash, randomBytes } from 'node:crypto'
import { WebSocket } from 'ws'
import type { TtsSynthesizeRequest, TtsSynthesizeResult, TtsWordBoundary } from '../shared/tts'

const EDGE_SPEECH_URL =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
const EDGE_API_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const CHROMIUM_FULL_VERSION = '143.0.3650.75'
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0]

/** 合成超时：一句话的往返；给足 15s，超时即放弃并报错。 */
const TIMEOUT_MS = 15_000

const WIN_EPOCH_OFFSET = 11_644_473_600 // 1601→1970 秒偏移（可被 300 整除，5 分钟分桶对齐 unix 网格）
const S_TO_NS = 1_000_000_000

/**
 * Sec-MS-GEC 签名：Windows 文件时间（1601 纪元）向下取整到最近 5 分钟、拼 TrustedClientToken 后
 * SHA-256、大写 hex。服务端按同样规则校验，故 5 分钟内稳定、跨桶变化。
 * 见 https://github.com/rany2/edge-tts/issues/290#issuecomment-2464956570
 */
export function generateSecMsGec(): string {
  let ticks = Math.floor(Date.now() / 1000)
  ticks += WIN_EPOCH_OFFSET
  ticks -= ticks % 300
  ticks *= S_TO_NS / 100
  const strToHash = `${ticks.toFixed(0)}${EDGE_API_TOKEN}`
  return createHash('sha256').update(strToHash).digest('hex').toUpperCase()
}

/** XML 文本转义：合成入参是纯文本，未转义的 & < > 会破坏 SSML 令 Edge 报错。 */
function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 把纯文本包进 Edge 要的 SSML 信封（移植自 readest genSSML，改为转义纯文本、不含 foliate 标记）。 */
export function genSSML(lang: string, text: string, voice: string, rate: number): string {
  return `
    <speak version="1.0" xml:lang="${lang}">
      <voice name="${voice}">
        <prosody rate="${rate}" >
            ${escapeXml(text)}
        </prosody>
      </voice>
    </speak>
  `
}

interface AudioMetadataEntry {
  Type?: string
  Data?: { Offset?: number; Duration?: number; text?: { Text?: string } }
}

/** 解析 audio.metadata 帧的 WordBoundary 条目为逐词边界（移植自 readest parseAudioMetadataBody）。 */
export function parseAudioMetadataBody(body: string): TtsWordBoundary[] {
  try {
    const parsed = JSON.parse(body) as { Metadata?: AudioMetadataEntry[] }
    const boundaries: TtsWordBoundary[] = []
    for (const entry of parsed.Metadata ?? []) {
      if (entry.Type !== 'WordBoundary') continue
      const offset = entry.Data?.Offset
      const text = entry.Data?.text?.Text
      if (typeof offset !== 'number' || typeof text !== 'string' || !text) continue
      boundaries.push({ offset, duration: entry.Data?.Duration ?? 0, text })
    }
    return boundaries
  } catch {
    return []
  }
}

// Edge 文本帧形如 "Key: Value\r\n...\r\n\r\nbody"：拆出头与体。
function parseTextFrame(message: string): { headers: Record<string, string>; body: string } {
  const lines = message.split('\n')
  const headers: Record<string, string> = {}
  let i = 0
  for (; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) break
    const sep = line.indexOf(':')
    if (sep === -1) continue
    headers[line.slice(0, sep).trim()] = line.slice(sep + 1).trim()
  }
  let body = ''
  for (i = i + 1; i < lines.length; i++) body += lines[i] + '\n'
  return { headers, body }
}

// 拼一条 Edge 帧：头逐行 CRLF，空行后接体。
function genSendContent(headerObj: Record<string, string>, content: string): string {
  let header = ''
  for (const key of Object.keys(headerObj)) header += `${key}: ${headerObj[key]}\r\n`
  return `${header}\r\n${content}`
}

/** 走一次 wss 往返，拿回整段 MP3 与逐词边界。 */
export function synthesize(req: TtsSynthesizeRequest): Promise<TtsSynthesizeResult> {
  const { lang, text, voice, rate } = req
  const connectId = randomBytes(16).toString('hex')
  const params = new URLSearchParams({
    ConnectionId: connectId,
    TrustedClientToken: EDGE_API_TOKEN,
    'Sec-MS-GEC': generateSecMsGec(),
    'Sec-MS-GEC-Version': `1-${CHROMIUM_FULL_VERSION}`,
  })
  const url = `${EDGE_SPEECH_URL}?${params.toString()}`
  const date = new Date().toString()
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' +
      ` (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36` +
      ` Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9',
    Pragma: 'no-cache',
    'Cache-Control': 'no-cache',
    Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    Cookie: `muid=${randomBytes(16).toString('hex').toUpperCase()};`,
  }
  const config = genSendContent(
    {
      'Content-Type': 'application/json; charset=utf-8',
      Path: 'speech.config',
      'X-Timestamp': date,
    },
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: true },
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
          },
        },
      },
    }),
  )
  const content = genSendContent(
    {
      'Content-Type': 'application/ssml+xml',
      Path: 'ssml',
      'X-RequestId': connectId,
      'X-Timestamp': date,
    },
    genSSML(lang, text, voice, rate),
  )

  return new Promise<TtsSynthesizeResult>((resolve, reject) => {
    const ws = new WebSocket(url, { headers })
    ws.binaryType = 'arraybuffer'
    const chunks: Uint8Array[] = []
    const boundaries: TtsWordBoundary[] = []
    let settled = false

    const cleanup = (): void => {
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        /* 已关或未开，忽略 */
      }
    }
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }
    const succeed = (): void => {
      if (settled) return
      const total = chunks.reduce((n, c) => n + c.byteLength, 0)
      if (!total) {
        fail(new Error('Edge TTS 未返回音频数据'))
        return
      }
      settled = true
      cleanup()
      const merged = new Uint8Array(total)
      let at = 0
      for (const c of chunks) {
        merged.set(c, at)
        at += c.byteLength
      }
      resolve({ audio: merged.buffer, boundaries })
    }
    const timer = setTimeout(() => fail(new Error('Edge TTS 合成超时')), TIMEOUT_MS)

    ws.addEventListener('open', () => {
      ws.send(config)
      ws.send(content)
    })
    ws.addEventListener('message', (event) => {
      const data = event.data
      if (typeof data === 'string') {
        const { headers: h, body } = parseTextFrame(data)
        if (h['Path'] === 'audio.metadata') boundaries.push(...parseAudioMetadataBody(body.trim()))
        else if (h['Path'] === 'turn.end') succeed()
      } else if (data instanceof ArrayBuffer) {
        // 二进制帧：前 2 字节（大端）是头长度，音频体在 2+headerLength 之后。
        const view = new DataView(data)
        const headerLength = view.getInt16(0)
        if (data.byteLength > headerLength + 2) chunks.push(new Uint8Array(data, 2 + headerLength))
      }
    })
    ws.addEventListener('error', () => fail(new Error('Edge TTS 连接失败')))
    ws.addEventListener('close', () => {
      // 正常路径已在 turn.end succeed；异常关闭且未 settle 视为失败。
      if (!settled) fail(new Error('Edge TTS 连接意外关闭'))
    })
  })
}
