/**
 * 朗读会话 hook —— session.ts 纯核心与阅读引擎之间的全部 DOM 胶水（形态对齐 useInlineTranslation）：
 * 句枚举与起点决策、句高亮、自动翻页跟随与手动脱离、跨章推进、选区保护、设备记忆、换声节流。
 * 刻意不含可单测逻辑（node 测试环境无 DOM）：判断都在 session/timeline/playback（已单测），这里只接线。
 */
import { useEffect, useRef, useState } from 'react'
import { ttsBridge } from '@/platform'
import type { FoliateEngine, TtsSentence } from '@/reading'
import { occupySpeaker } from '@/lib/audio'
import { toast } from '@/lib/toast'
import { TTS_HIGHLIGHT_INK } from '../constants'
import { type AudioClipPlayer, createAudioClipPlayer } from './audioClipPlayer'
import { sameDisplayedPlayback } from './playback'
import { createTtsSession, type SessionSentence, type TtsSession, type TtsSnapshot } from './session'
import { type CalibrationMap, isSpeakable } from './timeline'
import {
  readTtsLocation,
  readTtsRate,
  readTtsVoice,
  storeTtsLocation,
  storeTtsRate,
  storeTtsVoice,
} from './ttsMemory'
import { findVoice } from './voices'

/**
 * 显式跳转（跨章 / 从标注起播 / 回到朗读位置）后的 relocate 宽限期：换章加载与翻页动画期间的
 * 位置汇报不算脱离。逐句跟随**不打点**——跟随落定后当前句本就可见，relocate 回调第一分支即可
 * 兜住；若跟随也打点，句长短于宽限期时（尤其倍速下）打点被逐句刷新，手动翻页的 relocate 永远
 * 落在宽限窗口内，脱离检测就永远不触发（真书走查抓到的缺陷）。
 */
const SELF_NAV_GRACE_MS = 2000
/** 换声节流：连点音色列表只按最后一次重合成（tts.md §播放控制）。 */
const VOICE_DEBOUNCE_MS = 300

export interface TtsSessionHandle {
  active: boolean
  /** starting/playing 都算「在播」（乐观启动：合成期间播放键即显暂停形态）。 */
  playing: boolean
  elapsed: number
  duration: number
  bufferedFraction: number
  repeating: boolean
  rate: number
  /** 当前音色 id（完整播放器展示与选中态用）。 */
  voiceId: string
  /** 用户手动翻页离开朗读位置（显示「回到朗读位置」入口）。 */
  detached: boolean
  toggleTts(): void
  startFromSelection(): void
  startFromCfi(cfi: string): void
  togglePlay(): void
  prevSentence(): void
  nextSentence(): void
  seek(seconds: number): void
  setRate(rate: number): void
  setVoice(voiceId: string): void
  toggleRepeat(): void
  returnToTtsLocation(): void
  stop(): void
}

export function useTtsSession(engine: FoliateEngine | null, bookHash: string): TtsSessionHandle {
  const [active, setActive] = useState(false)
  const [snap, setSnap] = useState<TtsSnapshot | null>(null)
  const [detached, setDetached] = useState(false)
  const [voiceId, setVoiceId] = useState(readTtsVoice)
  /** 无会话时对外报的倍速。设备记忆只在这里读一次（懒初始化），别每次渲染都去碰 localStorage。 */
  const [idleRate, setIdleRate] = useState(readTtsRate)

  const coreRef = useRef<TtsSession | null>(null)
  const audioRef = useRef<AudioClipPlayer | null>(null)
  const sentencesRef = useRef<TtsSentence[]>([])
  const indexRef = useRef(0)
  /** 音色速率校准：跨章、跨会话存活（App 运行期内存态，tts.md 三层估算的中间层）。 */
  const calibrationRef = useRef<CalibrationMap>(new Map())
  const selectionActiveRef = useRef(false)
  const lastSelfNavRef = useRef(0)
  const detachedRef = useRef(false)
  detachedRef.current = detached
  const voiceIdRef = useRef(voiceId)
  voiceIdRef.current = voiceId
  const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 上一帧真正进了 React 的快照（节流基准，见 handleSnapshot）。 */
  const shownRef = useRef<TtsSnapshot | null>(null)

  // ── 会话内部动作全部定义为普通函数、经 latest ref 供 core 回调取最新版
  //（core 的回调在会话存续期内不换，直接闭包会拿到陈旧的 state/props）──

  /** 丢掉当前会话的核心与播出端口，连同只对该会话有意义的节流基准（换会话 / 收尾共用）。 */
  const disposeCore = (): void => {
    coreRef.current?.dispose()
    coreRef.current = null
    audioRef.current?.dispose()
    audioRef.current = null
    shownRef.current = null
  }

  const teardown = (): void => {
    if (voiceTimerRef.current) {
      clearTimeout(voiceTimerRef.current)
      voiceTimerRef.current = null
    }
    disposeCore()
    sentencesRef.current = []
    engine?.ttsClearHighlight()
    setActive(false)
    setSnap(null)
    setDetached(false)
  }

  /** 画句高亮。高亮是纯 overlay 不碰选区，查词浮层开着也照常逐句推进（对齐 readest）。 */
  const highlightSentence = (i: number): void => {
    const s = sentencesRef.current[i]
    if (!engine || !s) return
    engine.ttsHighlight(s.range, TTS_HIGHLIGHT_INK)
  }

  /** 自动翻页跟随（脱离 / 选区保护时不跟）。刻意不打宽限点：理由见 SELF_NAV_GRACE_MS。 */
  const follow = (range: Range): void => {
    if (!engine || detachedRef.current || selectionActiveRef.current) return
    engine.ttsFollow(range)
  }

  const handleSentenceChange = (i: number): void => {
    indexRef.current = i
    const s = sentencesRef.current[i]
    if (!engine || !s) return
    // 朗读位置 ≠ 阅读进度：锚点单独记（设备记忆），不写 saveProgress
    const cfi = engine.ttsRangeCfi(s.sectionIndex, s.range)
    if (cfi) storeTtsLocation(bookHash, cfi)
    highlightSentence(i)
    follow(s.range)
  }

  const handleSnapshot = (s: TtsSnapshot): void => {
    // 快照跟着 rAF 走（约 60Hz），但播放器上多数帧一模一样：只有显示得出差别的才进 React。
    // 高亮是句级的、只在 onSentenceChange 重绘，这里不碰。
    if (!sameDisplayedPlayback(shownRef.current, s)) {
      shownRef.current = s
      setSnap(s)
    }
  }

  /** 触达章边界：跨章续播（保持播放/暂停态）；书尾即会话结束（tts.md §章节推进）。 */
  const handleBoundary = (dir: 'next' | 'prev'): void => {
    void (async () => {
      const core = coreRef.current
      if (!engine || !core) return
      const wasPlaying = core.snapshot().status !== 'paused'
      const target = engine.ttsSectionIndex() + (dir === 'next' ? 1 : -1)
      if (target < 0) return // 首章再往前：停在原地
      if (target >= engine.ttsSectionCount()) {
        toast.info('已读完最后一章')
        teardown() // 会话结束信号：不能拿播放态判结束，这里是唯一的结束出口之一
        return
      }
      lastSelfNavRef.current = Date.now()
      const ok = await engine.ttsGoToSection(target)
      const sentences = ok ? enumerate() : []
      if (!ok || !sentences.length) {
        toast.warning('无法进入相邻章节，朗读已停止')
        teardown()
        return
      }
      openSession(sentences, dir === 'next' ? 0 : sentences.length - 1, wasPlaying)
    })()
  }

  const latest = useRef({ teardown, handleSentenceChange, handleSnapshot, handleBoundary })
  latest.current = { teardown, handleSentenceChange, handleSnapshot, handleBoundary }

  /** 枚举当前主可见章的可朗读句（纯符号句不进会话，与高亮/时间轴共用同一份过滤后数组）。 */
  const enumerate = (): TtsSentence[] => {
    if (!engine) return []
    return engine.ttsEnumerate().filter((s) => isSpeakable(s.text))
  }

  /** 建会话（先出播放器再异步合成 = 乐观启动；核心 onError 即回滚提示，tts.md §启动朗读）。 */
  const openSession = (sentences: TtsSentence[], startIndex: number, playing: boolean): void => {
    disposeCore()
    sentencesRef.current = sentences
    const audio = createAudioClipPlayer()
    audioRef.current = audio
    const items: SessionSentence[] = sentences.map((s) => ({
      text: s.text,
      blockIndex: s.blockIndex,
    }))
    coreRef.current = createTtsSession({
      sentences: items,
      startIndex,
      rate: readTtsRate(),
      // 音色与内容语言无关：整章都用用户选的这一款（tts.md §换声音）
      voice: voiceIdRef.current,
      calibration: calibrationRef.current,
      synth: async (text, voice) => {
        const v = findVoice(voice)
        return ttsBridge.synthesize({ lang: v?.locale ?? 'en-US', text, voice, rate: 1 })
      },
      audio,
      callbacks: {
        onSnapshot: (s) => latest.current.handleSnapshot(s),
        onSentenceChange: (i) => latest.current.handleSentenceChange(i),
        onBoundary: (d) => latest.current.handleBoundary(d),
        onError: (msg) => {
          toast.warning(msg)
          latest.current.teardown()
        },
      },
    })
    setActive(true)
    setDetached(false)
    coreRef.current.start(!playing)
  }

  /**
   * 锚点 → 起始句：取「起点 ≤ 锚点起点」的最后一句。方向不能反 —— readest 在 from() 上栽过：
   * 取「第一个 ≥」时，只要选中词不是句首词就会跳到下一句（tts-start-from-selection）。
   */
  const pickIndexAtRange = (sentences: TtsSentence[], anchor: Range): number => {
    let idx = 0
    for (let i = 0; i < sentences.length; i++) {
      if (anchor.compareBoundaryPoints(Range.START_TO_START, sentences[i]!.range) >= 0) idx = i
      else break
    }
    return idx
  }

  /** 底栏开关的启动分支：锚点仍在当前可见页则续读，否则从当前页头（tts.md §启动朗读）。 */
  const startFromToggle = (): void => {
    if (!engine) return
    const sentences = enumerate()
    if (!sentences.length) {
      toast.info(engine.isFixedLayout ? '该版式暂不支持朗读' : '本章没有可朗读的正文')
      return
    }
    const savedCfi = readTtsLocation(bookHash)
    const resolved = savedCfi ? engine.ttsResolveCfiRange(savedCfi) : null
    // 锚点仍落在本章当前可见页 → 从锚点续读；否则从当前页第一句起（页内一句都取不到就从章首）。
    const startIndex =
      resolved &&
      resolved.sectionIndex === engine.ttsSectionIndex() &&
      engine.ttsRangeVisible(resolved.range)
        ? pickIndexAtRange(sentences, resolved.range)
        : Math.max(0, sentences.findIndex((s) => engine.ttsRangeVisible(s.range)))
    openSession(sentences, startIndex, true)
  }

  const startFromSelection = (): void => {
    if (!engine) return
    const sel = engine.ttsSelectionRange()
    if (!sel) return
    const sentences = enumerate()
    if (!sentences.length) return
    const startIndex = pickIndexAtRange(sentences, sel.range)
    engine.clearSelection() // 选区只用来定起点，启动后即清（tts.md §启动朗读）
    openSession(sentences, startIndex, true)
  }

  /** 从某条标注（CFI）处起读（划词浮层的编辑态入口，无活选区）。 */
  const startFromCfi = (cfi: string): void => {
    if (!engine) return
    void (async () => {
      let resolved = engine.ttsResolveCfiRange(cfi)
      if (!resolved) {
        toast.warning('定位不到这条标注的位置')
        return
      }
      if (resolved.sectionIndex !== engine.ttsSectionIndex()) {
        lastSelfNavRef.current = Date.now()
        if (!(await engine.ttsGoToSection(resolved.sectionIndex))) return
        resolved = engine.ttsResolveCfiRange(cfi) // 换章后旧 range 属旧文档，重解析
        if (!resolved) return
      }
      const sentences = enumerate()
      if (!sentences.length) return
      openSession(sentences, pickIndexAtRange(sentences, resolved.range), true)
    })()
  }

  /** 回到朗读位置：优先滚回活 range；该章已卸载（range 死了）则按锚点 CFI 跳章。 */
  const returnToTtsLocation = (): void => {
    if (!engine) return
    lastSelfNavRef.current = Date.now()
    const s = sentencesRef.current[indexRef.current]
    if (s?.range.startContainer.ownerDocument?.defaultView) {
      engine.ttsFollow(s.range)
    } else {
      const cfi = readTtsLocation(bookHash)
      if (cfi) void engine.goTo(cfi)
    }
    setDetached(false)
  }

  const setVoice = (id: string): void => {
    if (!findVoice(id)) return
    setVoiceId(id) // UI 选中态即时反馈
    storeTtsVoice(id)
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current)
    voiceTimerRef.current = setTimeout(() => {
      coreRef.current?.setVoice(id) // 重合成当前句，节流挡连点
    }, VOICE_DEBOUNCE_MS)
  }

  // ── 订阅：脱离检测 / 选区保护 / 换书换引擎收尾 ──

  // 手动翻页脱离：relocate 后当前句仍可见 → 保持/恢复跟随；不可见且不在自身导航宽限期 → 脱离。
  useEffect(() => {
    if (!engine || !active) return
    return engine.onRelocate(() => {
      const s = sentencesRef.current[indexRef.current]
      if (!s) return
      if (engine.ttsRangeVisible(s.range)) {
        setDetached(false)
        return
      }
      if (Date.now() - lastSelfNavRef.current < SELF_NAV_GRACE_MS) return
      setDetached(true)
    })
  }, [engine, active])

  // 选区保护开关：有选区时 follow（自动翻页跟随）静默跳过，别把查词浮层所在页翻走；
  // 高亮不受影响——它是纯 overlay，重绘不碰原生选区（对齐 readest）。
  useEffect(() => {
    if (!engine) return
    return engine.onSelect((sel) => {
      selectionActiveRef.current = sel !== null
    })
  }, [engine])

  // 单声互斥：会话存续期间注册为扬声器占用者——查词发音将播时朗读正规暂停（UI 如实显示暂停），
  // 片段播完自动恢复；被打断的记忆与守卫都在核心（session.interrupt/resumeInterrupted，已单测）。
  useEffect(() => {
    if (!active) return
    return occupySpeaker({
      interrupt: () => coreRef.current?.interrupt(),
      resume: () => coreRef.current?.resumeInterrupted(),
    })
  }, [active])

  // 换书 / 引擎重建 / 卸载：关书即停（tts.md 不做后台续播）。
  useEffect(() => {
    return () => latest.current.teardown()
  }, [engine, bookHash])

  return {
    active,
    playing: snap?.status === 'playing' || snap?.status === 'starting',
    elapsed: snap?.elapsed ?? 0,
    duration: snap?.duration ?? 0,
    bufferedFraction: snap?.bufferedFraction ?? 0,
    repeating: snap?.repeating ?? false,
    rate: snap?.rate ?? idleRate,
    voiceId,
    detached,
    toggleTts: () => {
      // 底栏朗读键是开关语义：未朗读时启动、正在朗读时停止（tts.md §启动朗读）
      if (coreRef.current) latest.current.teardown()
      else startFromToggle()
    },
    startFromSelection,
    startFromCfi,
    togglePlay: () => coreRef.current?.toggle(),
    prevSentence: () => coreRef.current?.prev(),
    nextSentence: () => coreRef.current?.next(),
    seek: (seconds) => coreRef.current?.seekTo(seconds),
    setRate: (rate) => {
      storeTtsRate(rate)
      setIdleRate(rate)
      coreRef.current?.setRate(rate)
    },
    setVoice,
    toggleRepeat: () => {
      const core = coreRef.current
      if (core) core.setRepeating(!core.snapshot().repeating)
    },
    returnToTtsLocation,
    stop: () => latest.current.teardown(),
  }
}
