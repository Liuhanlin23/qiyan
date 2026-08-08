/**
 * 朗读会话核心 —— 无 DOM 的播放编排：句序推进 / 间隙 / 复读 / 预取合成 / 时长回填 /
 * 换速换声 / 失败策略。所有效应经注入端口（SynthFn / AudioPort / wait）进出，
 * node 环境可全量单测；DOM 侧的高亮 / 跟随 / 跨章由 useTtsSession 消费回调完成。
 *
 * 坐标系：AudioPort 报的时间是 <audio> 媒体时间（不随 playbackRate 变）；timeline 的
 * offset/duration 也在此域。
 *
 * 播放态对齐 tts.md §核心口径：starting/playing/paused/ended 四态 + onBoundary/onError 回调，
 * 不设对外可见的 stopped 过渡态 —— readest 需要它是因为跨句都要走引擎 stop，这里跨句只是
 * 换一段 <audio> 源，对外状态连续。「用户暂停 / 过渡暂停」的区分体现在 resume 的两条路径
 *（已载入直接续播 / 未载入从当前句重合成）。
 */
import { normalizeSynthText } from './align'
import {
  applyMeasuredDuration,
  buildTimeline,
  type CalibrationMap,
  estimateDuration,
  sentenceIndexAtTime,
  type TimelineSentence,
  totalDuration,
  updateCalibration,
} from './timeline'

export type TtsStatus = 'starting' | 'playing' | 'paused' | 'ended'

/** 会话里的一句（hook 从 TtsSentence 映射而来；DOM Range 留在 hook 侧，核心不碰）。 */
export interface SessionSentence {
  text: string
  blockIndex: number
}

export interface TtsSnapshot {
  status: TtsStatus
  /** 当前句下标（会话句表内）。 */
  sentenceIndex: number
  /** 章内已播秒数（timeline 域）。 */
  elapsed: number
  /** 章内总时长（秒，随实测回填修正）。 */
  duration: number
  /** 已合成（连续就绪段）占比 0–1，播放器缓冲段用。 */
  bufferedFraction: number
  repeating: boolean
  rate: number
}

/** 播出端口：一次装一段整句音频；时间回调报媒体时间（秒）。DOM 实现见 audioClipPlayer.ts。 */
export interface AudioPort {
  /**
   * 装载整句音频，resolve 实测时长（秒；解码不出时长时可为 NaN，调用方自兜底）。
   * **装不进去（解码失败）必须 reject** —— 会话据此把这句按「播不出来」跳掉，见 playCurrent。
   */
  load(audio: ArrayBuffer): Promise<number>
  play(): void
  pause(): void
  stop(): void
  seek(seconds: number): void
  setRate(rate: number): void
  onTime(cb: (seconds: number) => void): () => void
  onEnded(cb: () => void): () => void
}

/** 合成端口：text 已 normalizeSynthText，恒按 rate=1.0 合成（变速在播出侧）。
 * 结果只消费音频字节（桥接层还带 Edge 词边界，本会话句级高亮用不到，原样忽略）。 */
export type SynthFn = (text: string, voice: string) => Promise<{ audio: ArrayBuffer }>

export interface TtsSessionCallbacks {
  onSnapshot(snap: TtsSnapshot): void
  /** 当前句变化（含 start 落位）：hook 在此画句高亮 / 自动跟随 / 记续读锚点。 */
  onSentenceChange(index: number): void
  /** 触达章边界（末句读完 / 末句再 next / 首句再 prev）：hook 负责跨章或收尾。 */
  onBoundary(dir: 'next' | 'prev'): void
  /** 不可恢复错误（连续合成失败）：hook 提示并回滚会话。 */
  onError(message: string): void
}

export interface TtsSessionOptions {
  sentences: readonly SessionSentence[]
  startIndex: number
  rate: number
  /** 音色 id，全章通用、与内容语言无关（会话内可经 setVoice 改）。 */
  voice: string
  /** 跨会话共享的音色速率校准（hook 持有，App 运行期存活）。 */
  calibration: CalibrationMap
  synth: SynthFn
  audio: AudioPort
  /** 句间隙等待，默认 setTimeout；测试注入手动放行版。 */
  wait?: (ms: number) => Promise<void>
  callbacks: TtsSessionCallbacks
}

export interface TtsSession {
  /** 启动。paused=true 时只落位不合成不发声（跨章保暂停态用）。 */
  start(paused?: boolean): void
  toggle(): void
  pause(): void
  resume(): void
  next(): void
  prev(): void
  /** 外部短音频（查词发音）将出声：在播则暂停并记「被打断」；暂停 / 结束态无操作。 */
  interrupt(): void
  /** 外部短音频结束：仍处「被打断」的暂停态才恢复出声（短暂打断语义，tts.md §播放控制）。 */
  resumeInterrupted(): void
  seekTo(seconds: number): void
  goToSentence(index: number): void
  setRate(rate: number): void
  setVoice(voiceId: string): void
  setRepeating(on: boolean): void
  snapshot(): TtsSnapshot
  dispose(): void
}

/** 预取深度：当前句之外再往前合成这么多句（一句一次 wss 往返，够无缝衔接即可）。 */
const PREFETCH_AHEAD = 2
/** 每句合成失败后的重试次数。 */
const SYNTH_RETRIES = 1
/** 连续跳句封顶：连着这么多句合成失败即判不可恢复（断网 / 接口被封，tts.md §已知约束）。 */
const MAX_CONSECUTIVE_SKIPS = 3

export function createTtsSession(opts: TtsSessionOptions): TtsSession {
  const { sentences, synth, audio, calibration, callbacks } = opts
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let voice = opts.voice

  let status: TtsStatus = 'starting'
  let index = Math.min(Math.max(opts.startIndex, 0), Math.max(sentences.length - 1, 0))
  let rate = opts.rate
  let repeating = false
  let disposed = false
  /** 导航代币：跳句 / 换声 / dispose 时 +1，作废在途的合成与载入续体。 */
  let epoch = 0
  /** 当前句的音频是否已装进 AudioPort（resume 据此分「真恢复 / 重合成」两路）。 */
  let loaded = false
  let inSentenceSec = 0
  /** 连续合成失败的句数，成功一句即清零。 */
  let consecutiveSkips = 0
  let timeline: readonly TimelineSentence[] = buildTimeline(sentences, (it) =>
    estimateDuration(it.text, voice, calibration),
  )
  const clips = new Map<string, ArrayBuffer>()
  const inflight = new Map<string, Promise<ArrayBuffer | null>>()

  /** 缓存 key 含音色：换声后旧句缓存自动失效。 */
  const keyOf = (i: number): string => `${voice}::${i}`

  const elapsed = (): number => {
    const s = timeline[index]
    return s ? s.offset + Math.min(inSentenceSec, s.duration) : 0
  }

  const snapshot = (): TtsSnapshot => ({
    status,
    sentenceIndex: index,
    elapsed: elapsed(),
    duration: totalDuration(timeline),
    bufferedFraction: bufferedFraction(),
    repeating,
    rate,
  })
  const emit = (): void => callbacks.onSnapshot(snapshot())

  /** 「意图在播」的两态：导航 / 换声 / 恢复对它们一视同仁（起播中被跳句，跳完照样要发声）。 */
  const isActive = (): boolean => status === 'playing' || status === 'starting'

  /** 作废在途续体并掐掉当前发声（跳句 / 换声共用；dispose 另有顺序要求，不走这里）。 */
  const abort = (): void => {
    epoch++
    audio.stop()
  }

  /** 清当前句的播出状态（换句 / 换声共用）。 */
  const clearSentenceState = (): void => {
    inSentenceSec = 0
    loaded = false
  }

  /** 换当前句：清句内进度，通知 hook（高亮 / 锚点 / 跟随都挂在这个回调上）。 */
  const setIndex = (i: number): void => {
    index = i
    clearSentenceState()
    callbacks.onSentenceChange(i)
  }

  /**
   * 取某句合成结果：缓存命中即回；in-flight 去重（预取与点播并发只发一条请求）；
   * 失败重试 SYNTH_RETRIES 次后回 null，由 playCurrent 按「跳句 + 连续封顶」处理。
   */
  const ensureClip = (i: number): Promise<ArrayBuffer | null> => {
    const s = sentences[i]
    if (!s) return Promise.resolve(null)
    const key = keyOf(i)
    const hit = clips.get(key)
    if (hit) return Promise.resolve(hit)
    const pending = inflight.get(key)
    if (pending) return pending
    const p = (async (): Promise<ArrayBuffer | null> => {
      for (let attempt = 0; attempt <= SYNTH_RETRIES; attempt++) {
        try {
          const { audio: bytes } = await synth(normalizeSynthText(s.text), voice)
          clips.set(key, bytes)
          return bytes
        } catch {
          // 重试；仍失败回 null
        }
      }
      return null
    })()
    inflight.set(key, p)
    void p.finally(() => inflight.delete(key))
    return p
  }

  /** 起播后往前铺几句，句间衔接才不卡在 wss 往返上。 */
  const prefetch = (): void => {
    const myEpoch = epoch
    for (let k = 1; k <= PREFETCH_AHEAD; k++) {
      const i = index + k
      if (i >= sentences.length) break
      void ensureClip(i).then(() => {
        if (!disposed && epoch === myEpoch) emit() // 缓冲段前移，刷新读数
      })
    }
  }

  /** 已合成的连续就绪段末尾占全章比例（断在第一个没备好的句上）。 */
  const bufferedFraction = (): number => {
    const total = totalDuration(timeline)
    if (total <= 0 || !clips.has(keyOf(index))) return 0
    let j = index
    while (j + 1 < sentences.length && clips.has(keyOf(j + 1))) j++
    const s = timeline[j]!
    return Math.min(1, (s.offset + s.duration) / total)
  }

  /** 在途续体是否已作废（导航换了 epoch / 会话已销毁）：每个 await 之后都要问一次。 */
  const stale = (myEpoch: number): boolean => disposed || epoch !== myEpoch

  /** 合成→载入→发声当前句。所有 await 之后校验 epoch/disposed（导航与销毁作废在途续体）。 */
  const playCurrent = async (): Promise<void> => {
    const myEpoch = epoch
    const s = sentences[index]
    if (!s) return
    const clip = await ensureClip(index)
    if (stale(myEpoch)) return
    if (!clip) {
      skipFailed()
      return
    }
    // 音频装不进播出端口（解码失败）与合成失败同路：这句一样播不出来。null 是失败哨兵 ——
    // load 本身可能 resolve NaN（解码不出时长），那属正常，由下面的回填守卫兜。
    const measured = await audio.load(clip).catch(() => null)
    if (stale(myEpoch)) return
    if (measured === null) {
      skipFailed()
      return
    }
    // 清零放在这里而不是合成成功处：否则「合成成功但恒载入失败」每次都从 1 重来，永远撞不到封顶。
    consecutiveSkips = 0
    loaded = true
    // 实测回填（tts.md：实测值随播放逐句回填修正）；applyMeasuredDuration/updateCalibration
    // 内部自带合法性守卫（NaN/≤0 原样跳过）。
    timeline = applyMeasuredDuration(timeline, index, measured)
    updateCalibration(calibration, voice, s.text, measured)
    if (status === 'paused') {
      emit() // 载入途中被暂停：备好待 resume，不发声
      return
    }
    audio.setRate(rate)
    audio.seek(0)
    audio.play()
    status = 'playing'
    emit()
    prefetch()
  }

  /** 单句合成失败：连续封顶即判不可恢复，末句触边界，否则跳下一句续播（不终止会话）。 */
  const skipFailed = (): void => {
    consecutiveSkips++
    if (consecutiveSkips >= MAX_CONSECUTIVE_SKIPS) {
      status = 'ended'
      emit()
      callbacks.onError('连续多句合成失败，朗读已停止')
      return
    }
    if (index >= sentences.length - 1) {
      callbacks.onBoundary('next')
      return
    }
    setIndex(index + 1)
    void playCurrent()
  }

  /** 句读完：等间隙（按倍速缩放）再推进；末句触边界。 */
  const advanceAfterGap = async (): Promise<void> => {
    const myEpoch = epoch
    const gapMs = ((timeline[index]?.gap ?? 0) / rate) * 1000
    if (gapMs > 0) await wait(gapMs)
    if (stale(myEpoch) || status !== 'playing') return
    if (index >= sentences.length - 1) {
      audio.stop()
      callbacks.onBoundary('next')
      return
    }
    setIndex(index + 1)
    void playCurrent()
  }

  const offEnded = audio.onEnded(() => {
    if (disposed || status !== 'playing' || !loaded) return
    if (repeating) {
      // 复读句尾回卷（不含句尾间隙——复读没必要重放静音，tts.md「当前句复读」）
      audio.seek(0)
      audio.play()
      return
    }
    void advanceAfterGap()
  })

  const offTime = audio.onTime((sec) => {
    if (disposed || !loaded) return
    inSentenceSec = sec
    emit()
  })

  /** 被发音片段打断而暂停（区别于用户暂停：片段结束要自动恢复）。手动 pause/resume 即作废。 */
  let interrupted = false

  const pause = (): void => {
    if (!isActive()) return
    interrupted = false // 手动暂停作废打断记忆：片段结束不该替用户做恢复决定
    audio.pause()
    status = 'paused'
    emit()
  }

  const resume = (): void => {
    if (status !== 'paused') return
    interrupted = false // 恢复到位（含用户在片段播放中接管），打断记忆即无意义
    status = 'playing'
    if (loaded) {
      // 用户暂停：真恢复
      audio.setRate(rate)
      audio.play()
    } else {
      // 过渡暂停（暂停中跳过句 / 换过声）：从当前句重新合成
      epoch++
      void playCurrent() // 同步段不发快照，故 emit 留到分支外统一发
    }
    emit()
  }

  /** 跳转 / 换声后的收尾：在播就从当前句续上，暂停态只移动高亮与锚点（tts.md §播放控制）。 */
  const restartOrEmit = (): void => {
    if (isActive()) void playCurrent()
    else emit()
  }

  const goToSentence = (i: number): void => {
    if (!sentences.length) return
    const clamped = Math.min(Math.max(i, 0), sentences.length - 1)
    abort()
    setIndex(clamped)
    restartOrEmit()
  }

  /** 走句：越出章两端不 clamp，交给 hook 去跨章（tts.md §跨章续播）。 */
  const step = (delta: 1 | -1): void => {
    const target = index + delta
    if (target < 0 || target >= sentences.length) {
      abort()
      callbacks.onBoundary(delta > 0 ? 'next' : 'prev')
    } else goToSentence(target)
  }

  return {
    start(paused = false) {
      epoch++
      setIndex(index)
      if (paused) {
        status = 'paused'
        emit()
      } else {
        status = 'starting'
        emit() // 乐观：先出「启动中」快照（UI 先亮播放器），合成完成才转 playing
        void playCurrent()
      }
    },
    toggle() {
      if (status === 'paused') resume()
      else pause() // ended 态下 pause 自守卫，什么也不做
    },
    pause,
    resume,
    next() {
      step(1)
    },
    prev() {
      step(-1)
    },
    interrupt() {
      if (!isActive()) return
      pause()
      interrupted = true // 必须置于 pause 之后：pause 本身会清打断记忆
    },
    resumeInterrupted() {
      if (interrupted) resume() // resume 自带 paused 守卫并清记忆
    },
    seekTo(seconds) {
      const t = Math.min(Math.max(seconds, 0), totalDuration(timeline))
      goToSentence(sentenceIndexAtTime(timeline, t)) // 按句吸附（tts.md §进度与时长）
    },
    goToSentence,
    setRate(r) {
      rate = r
      audio.setRate(r) // 变速即时生效、无需重合成（媒体时间与词边界同域，见文件头）
      emit()
    },
    setVoice(voiceId) {
      if (voice === voiceId) return
      voice = voiceId // 缓存 key 含音色，旧句缓存自动失效
      // 音色全章通用：换声必然涉及当前句 —— 过渡停止，按新声重合成（tts.md：换声即时生效；节流在 hook 侧）
      abort()
      clearSentenceState()
      restartOrEmit()
    },
    setRepeating(on) {
      repeating = on
      emit()
    },
    snapshot,
    dispose() {
      disposed = true
      epoch++
      offTime()
      offEnded()
      audio.stop()
      // 整章的合成音频（每分钟约 360KB）挂在这两张表上，跨章换会话时不清就是白攒着。
      clips.clear()
      inflight.clear()
    },
  }
}
