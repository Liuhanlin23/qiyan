import { cn } from '@/lib/cn'
import { resolveShownAccent, resolveWordAudioUrl, type WordAudioColumns } from '@/lib/audio'
import { SpeakerIcon } from '@/components/common/SpeakerIcon'

/**
 * 音标行 —— 英美切换按钮 + 单行音标（三页词卡统一的线性布局）；
 * 释义来源下拉不属于本行，由词卡主体承载。
 *
 * 有几档口音由**音标**决定（有道对部分词只落一侧，短语则两侧全无，cache/dict.md §7）：
 * 双侧才给英美切换；单侧只显示有的那侧（不给切换，也不受外部 accent 影响）；两侧全无就没有英美之
 * 分，退化成一个不带口音标签的喇叭。发音键则由**音频**决定（hasAudio + onSpeak），无声就不摆键；
 * 音标与音频都没有时整行不渲染。
 *
 * 喇叭用 SpeakerIcon（自订阅播放态出波纹动画），传 audioRow 即生效。
 *
 * accent 受控（双侧音标时用），朗读通过 onSpeak(locale) 上抛给页面，由页面接 @/lib/audio 的 playWordAudio。
 * 页面若需拦截点击冒泡（如 study 揭晓），在其 onSpeak / onToggleAccent 内自行 stopPropagation，本组件不感知。
 */

/** 口音药丸：与词卡释义来源下拉同款外观（可点的另加 btn-squish）。 */
const PILL = 'inline-flex items-center gap-1 rounded-full border border-border-300 bg-surface-1 px-2.5 py-1 text-xs font-semibold text-text-secondary'

interface PhoneticRowProps {
  phoneticUK: string
  phoneticUS: string
  /** 当前音标口音（仅英美音标俱全时生效） */
  accent?: 'uk' | 'us'
  /** 音标切换回调（仅英美音标俱全时生效） */
  onToggleAccent?: () => void
  onSpeak?: (locale?: 'en-GB' | 'en-US') => void
  /**
   * 该词是否有可播音频（additive，默认 true 即既有行为）。false 时不摆发音键。
   * 由页面按 dict 行三个 URL 列判定（@/lib/audio 的 hasWordAudio）。
   */
  hasAudio?: boolean
  /**
   * 该词的音频 URL 三列（additive，默认不传即喇叭不出播放态动画）。喇叭据此订阅
   * 「这条正在播吗」——身份要跟真正播出的那条对上，故由本组件按**实际显示的口音**（shown，
   * 单侧音标时不等于外部 accent）自行解析，页面只管把 dict 行原样递进来。
   */
  audioRow?: WordAudioColumns
  /**
   * 是否在按钮点击时 stopPropagation（additive，默认 false 即既有行为）。
   * 学习页把音标行包在「点击揭晓」容器里，音标/切换点击需拦截冒泡以免误揭晓。
   */
  stopClickPropagation?: boolean
}

export function PhoneticRow({
  phoneticUK,
  phoneticUS,
  accent = 'us',
  onToggleAccent,
  onSpeak,
  hasAudio = true,
  audioRow,
  stopClickPropagation = false,
}: PhoneticRowProps): React.JSX.Element | null {
  // 能发声 = 有音频 URL 且页面给了朗读回调（dict 缺行占位时页面不传）。
  const canSpeak = hasAudio && !!onSpeak
  const hasUK = !!phoneticUK
  const hasUS = !!phoneticUS
  const bothAccents = hasUK && hasUS

  /** 朗读（可选口音）：先按需拦截冒泡，再上抛。 */
  const speak = (e: React.MouseEvent, locale?: 'en-GB' | 'en-US'): void => {
    if (stopClickPropagation) e.stopPropagation()
    onSpeak?.(locale)
  }

  // 两侧音标全无：没有英美之分，只留一个喇叭（播兜底 audio_url）；连声音都没有则整行不出。
  if (!hasUK && !hasUS) {
    if (!canSpeak) return null
    // 这个分支上抛 onSpeak() 不带 locale，词卡回落外部 accent —— 订阅身份照此对齐。
    return (
      <button type="button" aria-label="朗读" onClick={(e) => speak(e)} className={cn('btn-squish', PILL)}>
        <SpeakerIcon url={audioRow && resolveWordAudioUrl(audioRow, accent)} className="size-3.5" />
      </button>
    )
  }

  // 单侧音标时钉死在有的那一侧（规则与自动发音同源，见 resolveShownAccent）。
  const shown = resolveShownAccent({ hasUS, hasUK }, accent)
  const locale = shown === 'uk' ? 'en-GB' : 'en-US'
  const phonetic = shown === 'uk' ? phoneticUK : phoneticUS
  const label = shown === 'uk' ? '英' : '美'
  // 药丸可点 = 能切换（双侧）或能发声；两者皆无时它只是个口音标签。
  const pillActive = bothAccents || canSpeak
  // 喇叭订阅的那条：按 shown 而非外部 accent —— 单侧音标时钉死在有的那侧，播出的也是它。
  const audioUrl = audioRow ? resolveWordAudioUrl(audioRow, shown) : null

  return (
    <div className="flex items-center gap-2.5">
      {pillActive ? (
        <button
          type="button"
          onClick={(e) => {
            // 单侧音标：药丸不切换，只当发音键。
            if (!bothAccents) {
              speak(e, locale)
              return
            }
            if (stopClickPropagation) e.stopPropagation()
            onToggleAccent?.()
            // 切换即播「切换后的目标口音」：accent 状态本次点击尚未翻新，故传其反面对应的 locale。
            onSpeak?.(shown === 'uk' ? 'en-US' : 'en-GB')
          }}
          className={cn('btn-squish', PILL)}
        >
          {label}
          {canSpeak && <SpeakerIcon url={audioUrl} className="size-3.5" />}
        </button>
      ) : (
        <span className={PILL}>{label}</span>
      )}
      {canSpeak ? (
        <button
          type="button"
          onClick={(e) => speak(e, locale)}
          className="btn-squish text-sm font-semibold text-text-secondary"
        >
          {phonetic}
        </button>
      ) : (
        <span className="text-sm font-semibold text-text-secondary">{phonetic}</span>
      )}
    </div>
  )
}
