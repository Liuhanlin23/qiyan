// TTS 合成契约（main 实现 / preload 传参 / renderer 消费的单一事实源）。
//
// 微软 Edge「大声朗读」的免费 wss 接口需要自定义 HTTP 头（User-Agent / Origin / Cookie /
// Sec-MS-GEC 签名），而 renderer 的 WHATWG WebSocket 无法设请求头——故 Edge 合成只能在 main
// （Node，用 ws 包带头直连）完成，经 `tts:synthesize` 转发。renderer 侧只拿回音频字节与逐词边界，
// 解码 / 变速 / 调度 / 高亮全在 renderer（见 docs/feature/reading/tts.md）。

/** 一次合成请求：`text` 已是纯文本（foliate 标记在 renderer 侧已剥离）。 */
export interface TtsSynthesizeRequest {
  /**
   * SSML 信封的 `xml:lang`（BCP-47），取音色所属 locale。
   * 实测 Edge 只认 `<voice name>`：同一音色下 xml:lang 换成别的值，音频字节与词边界完全一致 ——
   * 这里填它只为满足 SSML 规范要求，不承担「按内容语言选发音」的语义（音色目录见 tts/voices.ts）。
   */
  lang: string
  /** 待合成纯文本。 */
  text: string
  /** Edge 音色 id（如 `en-US-AndrewNeural`）。 */
  voice: string
  /**
   * 语速倍率写进 SSML prosody。Edge 音频通常按 `rate=1.0` 烘制、变速在 renderer 侧做（WSOLA 保真），
   * 故此处一般恒传 1.0；保留字段以备直接按倍速合成的退化路径。
   */
  rate: number
}

/**
 * Edge 报告的逐词边界：`offset` / `duration` 以 100ns tick 为单位、相对音频起点；
 * `text` 为原文逐词片段。用于逐词高亮与句内定位。
 */
export interface TtsWordBoundary {
  offset: number
  duration: number
  text: string
}

/** 合成结果：整段 MP3 音频字节（audio-24khz-48kbitrate-mono-mp3）+ 逐词边界。 */
export interface TtsSynthesizeResult {
  audio: ArrayBuffer
  boundaries: TtsWordBoundary[]
}
