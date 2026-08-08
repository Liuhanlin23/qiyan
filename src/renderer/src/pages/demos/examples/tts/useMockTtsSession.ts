/**
 * 朗读 demo 的假会话 —— 用 rAF 沿假时间轴推进，替代「Edge 合成 + `<audio>` 播放」那一层。
 *
 * 对外暴露的状态形状刻意贴着 tts.md：`playing` / `paused` + 独立的**会话结束**信号（读到章尾），
 * 而不是用 `stopped` 判结束。真引擎接上来时换掉推进源即可，播放器组件不用动。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type MockSentence, repeatClamp, sentenceIndexAtTime, totalDuration } from './ttsMock'

export interface MockTtsSession {
  /** 当前句下标（时间轴内），无内容时 -1。 */
  sentenceIndex: number
  current: MockSentence | undefined
  playing: boolean
  /** 会话结束（读到章尾）：与 paused 区分，tts.md 明确不能用停止态判结束。 */
  ended: boolean
  /** 章内已播秒数。 */
  elapsed: number
  duration: number
  rate: number
  voiceId: string
  /** 当前句循环复读中。 */
  repeating: boolean
  toggle: () => void
  prevSentence: () => void
  nextSentence: () => void
  /** 跳到章内某秒并按句吸附（拖动松手时调）。 */
  seek: (seconds: number) => void
  /** 直接跳到某句（点正文某句时调）。 */
  goToSentence: (index: number) => void
  setRate: (rate: number) => void
  setVoiceId: (id: string) => void
  setRepeating: (repeating: boolean) => void
  restart: () => void
}

export function useMockTtsSession(timeline: readonly MockSentence[]): MockTtsSession {
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ended, setEnded] = useState(false)
  const [rate, setRate] = useState(1)
  const [voiceId, setVoiceId] = useState('en-US-AndrewNeural')
  const [repeating, setRepeating] = useState(false)

  const duration = useMemo(() => totalDuration(timeline), [timeline])

  // rAF 推进：dt × 倍速。倍速与复读用 ref 读，避免改这两项就重启动画循环。
  const rateRef = useRef(rate)
  rateRef.current = rate
  const repeatingRef = useRef(repeating)
  repeatingRef.current = repeating
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = (now - last) / 1000
      last = now
      setElapsed((prev) => {
        const next = prev + dt * rateRef.current
        // 复读：句尾弹回句首。当前句按**推进前**的时刻定位——next 可能已经跨进下一句了。
        if (repeatingRef.current) {
          const current = timeline[sentenceIndexAtTime(timeline, prev)]
          if (current) return repeatClamp(next, current)
        }
        if (next >= duration) {
          setPlaying(false)
          setEnded(true)
          return duration
        }
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, duration, timeline])

  const sentenceIndex = sentenceIndexAtTime(timeline, elapsed)
  const current = sentenceIndex >= 0 ? timeline[sentenceIndex] : undefined

  const jumpTo = useCallback((seconds: number) => {
    setElapsed(Math.max(0, seconds))
    setEnded(false)
  }, [])

  const goToSentence = useCallback(
    (index: number) => {
      const target = timeline[Math.min(Math.max(index, 0), timeline.length - 1)]
      if (target) jumpTo(target.offset)
    },
    [timeline, jumpTo],
  )

  return {
    sentenceIndex,
    current,
    playing,
    ended,
    elapsed,
    duration,
    rate,
    voiceId,
    repeating,
    toggle: useCallback(() => {
      // 结束后再按播放 = 从头重来（demo 无下一章可续）。
      setPlaying((p) => {
        if (!p && ended) {
          setElapsed(0)
          setEnded(false)
        }
        return !p
      })
    }, [ended]),
    prevSentence: useCallback(() => goToSentence(sentenceIndex - 1), [goToSentence, sentenceIndex]),
    nextSentence: useCallback(() => goToSentence(sentenceIndex + 1), [goToSentence, sentenceIndex]),
    // 拖动松手按句吸附：落点所在句的开头，不留半句。
    seek: useCallback(
      (seconds: number) => {
        const idx = sentenceIndexAtTime(timeline, Math.max(0, Math.min(seconds, duration)))
        goToSentence(idx)
      },
      [timeline, duration, goToSentence],
    ),
    goToSentence,
    setRate,
    setVoiceId,
    setRepeating,
    restart: useCallback(() => {
      jumpTo(0)
      setPlaying(true)
    }, [jumpTo]),
  }
}
