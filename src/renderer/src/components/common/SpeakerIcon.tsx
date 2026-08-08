import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { audioStore, getAudioPhase, type AudioPhase } from '@/lib/audio'

/**
 * 发音喇叭图标：自己订阅 @/lib/audio 的播放态，按「静止 / 起播中 / 正在响」三态自动变样，
 * 全端发音入口（单词音标、例句、划词弹窗、笔记）统一用它替掉裸 lucide 的 Volume2。
 *
 * - 起播中：整枚换成转圈 spinner（与 CDS Button 的 loading 同款），音频走 CDN，这段等待要有交代；
 * - 正在响：回到喇叭，两道声波弧循环明灭 + 整枚转成 accent 蓝；
 * - 静止 / 播不出：静止的原色喇叭，不作声张。
 *
 * 形状与 lucide `volume-2` 逐字同源，只是把两道弧拆成独立 path 才好分别延时明灭。
 * 颜色只在「正在响」时接管（`text-fill-accent`），其余交给外部 className，故摆在任何底色上都合身。
 */

/** 该 url 当前的播放态；url 为空（这词没音频）恒为 idle。 */
export function useAudioPhase(url: string | null | undefined): AudioPhase {
  const getPhase = React.useCallback(() => getAudioPhase(url), [url])
  return React.useSyncExternalStore(audioStore.subscribe, getPhase)
}

export function SpeakerIcon({
  url,
  className,
}: {
  /** 这枚喇叭点下去会播的那条音频 URL（@/lib/audio 的 resolveWordAudioUrl / 例句自带的 audioUrl）。 */
  url: string | null | undefined
  className?: string
}): React.JSX.Element {
  const phase = useAudioPhase(url)

  // 起播中：让位给 spinner（它自带 150ms 延迟出现，秒开时不显形）。尺寸/颜色照旧由外部
  // className 决定，故不会撑动所在行。key 保证与喇叭互换时是全新节点——两者同为 <svg>，
  // 若被 React 复用则 CSS 动画不会重头开始，延迟出现就失效了。
  if (phase === 'loading') {
    return <Loader2 key="spinner" className={cn('speaker-spinner', className)} strokeWidth={2} aria-hidden />
  }

  const sounding = phase === 'playing'

  return (
    <svg
      key="speaker"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('transition-colors duration-150', className, sounding && 'text-fill-accent')}
    >
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
      <path d="M16 9a5 5 0 0 1 0 6" className={sounding ? 'speaker-wave-inner' : undefined} />
      <path
        d="M19.364 18.364a9 9 0 0 0 0-12.728"
        className={sounding ? 'speaker-wave-outer' : undefined}
      />
    </svg>
  )
}
