/**
 * 朗读音色目录 —— Edge「大声朗读」神经语音，全部为英语音色（美音 / 英音），按 locale 分组。
 *
 * 音色与内容语言解耦：不论正文是什么语言，一律用用户当前选中的这一款音色合成。这是本应用
 * 是英语学习 App 的直接结论——正文出现中文本就是极低概率事件，实测 Edge 用英语音色合成中文
 * 也照常出声、词边界完整，不值得为它多养一套「按语言选音色」的机制（tts.md §换声音）。
 * 用户只记一个偏好音色（`ttsVoice`，设备级运行时态，首版不落库、不开放设置页）。
 *
 * 目录照搬 readest 的 Edge 全量表（`third-party/readest/.../libs/edgeTTS.ts` 的 EDGE_TTS_VOICES）
 * 里 en-US / en-GB 两组的全部条目，字母序，不做在线拉取（Edge 免费通道没有音色列表接口，
 * readest 同样是硬编码）。
 */

export interface TtsVoice {
  /** Edge 音色全名（合成 `<voice name>`），如 `en-US-AndrewNeural`。 */
  id: string
  /** 展示名：`名字（口音 · 性别[· 备注]）`。 */
  label: string
  /**
   * 音色所属 locale，兼作分组键与合成信封的 `xml:lang`。
   * 实测 Edge 只认 `<voice name>`、`xml:lang` 取什么值都不改变合成结果，此处照 SSML 规范填合法值。
   */
  locale: string
}

/** Edge 英语音色目录（en-US 17 款 + en-GB 5 款，字母序同 readest）。 */
export const TTS_VOICES: readonly TtsVoice[] = [
  { id: 'en-US-AnaNeural', label: 'Ana（美 · 女 · 童声）', locale: 'en-US' },
  { id: 'en-US-AndrewMultilingualNeural', label: 'Andrew（美 · 男 · 多语）', locale: 'en-US' },
  { id: 'en-US-AndrewNeural', label: 'Andrew（美 · 男）', locale: 'en-US' },
  { id: 'en-US-AriaNeural', label: 'Aria（美 · 女）', locale: 'en-US' },
  { id: 'en-US-AvaMultilingualNeural', label: 'Ava（美 · 女 · 多语）', locale: 'en-US' },
  { id: 'en-US-AvaNeural', label: 'Ava（美 · 女）', locale: 'en-US' },
  { id: 'en-US-BrianMultilingualNeural', label: 'Brian（美 · 男 · 多语）', locale: 'en-US' },
  { id: 'en-US-BrianNeural', label: 'Brian（美 · 男）', locale: 'en-US' },
  { id: 'en-US-ChristopherNeural', label: 'Christopher（美 · 男）', locale: 'en-US' },
  { id: 'en-US-EmmaMultilingualNeural', label: 'Emma（美 · 女 · 多语）', locale: 'en-US' },
  { id: 'en-US-EmmaNeural', label: 'Emma（美 · 女）', locale: 'en-US' },
  { id: 'en-US-EricNeural', label: 'Eric（美 · 男）', locale: 'en-US' },
  { id: 'en-US-GuyNeural', label: 'Guy（美 · 男）', locale: 'en-US' },
  { id: 'en-US-JennyNeural', label: 'Jenny（美 · 女）', locale: 'en-US' },
  { id: 'en-US-MichelleNeural', label: 'Michelle（美 · 女）', locale: 'en-US' },
  { id: 'en-US-RogerNeural', label: 'Roger（美 · 男）', locale: 'en-US' },
  { id: 'en-US-SteffanNeural', label: 'Steffan（美 · 男）', locale: 'en-US' },
  { id: 'en-GB-LibbyNeural', label: 'Libby（英 · 女）', locale: 'en-GB' },
  { id: 'en-GB-MaisieNeural', label: 'Maisie（英 · 女 · 童声）', locale: 'en-GB' },
  { id: 'en-GB-RyanNeural', label: 'Ryan（英 · 男）', locale: 'en-GB' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia（英 · 女）', locale: 'en-GB' },
  { id: 'en-GB-ThomasNeural', label: 'Thomas（英 · 男）', locale: 'en-GB' },
]

/** 默认音色（未设偏好时用）。避开 Ana / Maisie 两款童声——长篇朗读不合适。 */
export const DEFAULT_VOICE = 'en-US-AndrewNeural'

/** 按 id 取音色元数据（找不到返回 undefined）。 */
export function findVoice(id: string): TtsVoice | undefined {
  return TTS_VOICES.find((v) => v.id === id)
}

/** 完整播放器音色列表的分组形态 —— 按口音分组，不按引擎（只有 Edge 一个引擎，tts.md）。 */
export interface TtsVoiceGroup {
  locale: string
  label: string
  voices: readonly TtsVoice[]
}

const LOCALE_LABELS: Record<string, string> = {
  'en-US': '英语 · 美音',
  'en-GB': '英语 · 英音',
}

/** 按 locale 分组的音色目录（Set 与 filter 都保序，组序与组内序都跟着 TTS_VOICES 走）。 */
export const VOICE_GROUPS: readonly TtsVoiceGroup[] = [
  ...new Set(TTS_VOICES.map((v) => v.locale)),
].map((locale) => ({
  locale,
  label: LOCALE_LABELS[locale] ?? locale,
  voices: TTS_VOICES.filter((v) => v.locale === locale),
}))

/** 音色 id → 显示名；不在目录（脏记忆 / 换过目录）返回 undefined，由调用方兜底。 */
export function voiceName(id: string): string | undefined {
  return findVoice(id)?.label
}
