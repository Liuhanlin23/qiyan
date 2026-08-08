import { describe, expect, it } from 'vitest'
import { PARAGRAPH_GAP, SENTENCE_GAP } from './timeline'
import {
  type AudioPort,
  createTtsSession,
  type SessionSentence,
  type TtsSessionCallbacks,
  type TtsSessionOptions,
  type TtsSnapshot,
} from './session'

// ── 假端口（任务 7/8 的测试复用这三个帮手与 makeSession）──

/** 手动驱动的假播出端口：load 立即成功并回固定时长，时间/结束事件由测试触发。 */
function fakeAudio(durationSec = 2) {
  const timeCbs = new Set<(s: number) => void>()
  const endCbs = new Set<() => void>()
  const calls = { load: 0, play: 0, pause: 0, stop: 0, seeks: [] as number[], rates: [] as number[] }
  let failLoads = 0
  const port: AudioPort = {
    load: () => {
      calls.load++
      if (failLoads > 0) {
        failLoads--
        return Promise.reject(new Error('decode failed'))
      }
      return Promise.resolve(durationSec)
    },
    play: () => calls.play++,
    pause: () => calls.pause++,
    stop: () => calls.stop++,
    seek: (s) => calls.seeks.push(s),
    setRate: (r) => calls.rates.push(r),
    onTime: (cb) => {
      timeCbs.add(cb)
      return () => timeCbs.delete(cb)
    },
    onEnded: (cb) => {
      endCbs.add(cb)
      return () => endCbs.delete(cb)
    },
  }
  return {
    port,
    calls,
    emitTime: (s: number) => timeCbs.forEach((cb) => cb(s)),
    emitEnded: () => endCbs.forEach((cb) => cb()),
    /** 令接下来 n 次 load 失败（音频解码失败：audioClipPlayer 会 reject）。 */
    failLoadNext: (n: number) => (failLoads = n),
  }
}

/** 记录调用的假合成：默认即时成功。failNext(n) 令接下来 n 次请求失败；defer 则永不落定。 */
function fakeSynth(defer = false) {
  const requests: { text: string; voice: string }[] = []
  let failTimes = 0
  const fn = (text: string, voice: string): ReturnType<TtsSessionOptions['synth']> => {
    requests.push({ text, voice })
    if (defer) return new Promise(() => {}) // 永不落定：只用来验「在途」去重
    if (failTimes > 0) {
      failTimes--
      return Promise.reject(new Error('synth down'))
    }
    return Promise.resolve({ audio: new ArrayBuffer(8) })
  }
  return { fn, requests, failNext: (n: number) => (failTimes = n) }
}

/** 手动放行的假间隙等待。 */
function fakeWait() {
  const pending: { ms: number; resolve: () => void }[] = []
  return {
    fn: (ms: number) => new Promise<void>((resolve) => pending.push({ ms, resolve })),
    pending,
    flush: () => pending.shift()?.resolve(),
  }
}

const S = (text: string, blockIndex = 0): SessionSentence => ({ text, blockIndex })
/** 排干微任务与 0ms 定时器（load/合成的 then 链）。 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

interface MakeOver {
  sentences?: SessionSentence[]
  startIndex?: number
  rate?: number
  calibration?: TtsSessionOptions['calibration']
  deferSynth?: boolean
}

function makeSession(over: MakeOver = {}) {
  const audio = fakeAudio()
  const synth = fakeSynth(over.deferSynth)
  const wait = fakeWait()
  const events: string[] = []
  const snaps: TtsSnapshot[] = []
  const callbacks: TtsSessionCallbacks = {
    onSnapshot: (s) => snaps.push(s),
    onSentenceChange: (i) => events.push(`sentence:${i}`),
    onBoundary: (d) => events.push(`boundary:${d}`),
    onError: (m) => events.push(`error:${m}`),
  }
  const session = createTtsSession({
    sentences: over.sentences ?? [S('One.'), S('Two.'), S('Three.', 1)],
    startIndex: over.startIndex ?? 0,
    rate: over.rate ?? 1,
    voice: 'en-US-AndrewNeural',
    calibration: over.calibration ?? new Map(),
    synth: synth.fn,
    audio: audio.port,
    wait: wait.fn,
    callbacks,
  })
  return { session, audio, synth, wait, events, last: () => snaps[snaps.length - 1]! }
}

/** 起播并排干起播链，拿到「句 0 已在播」的会话 —— 绝大多数用例的共同前置。 */
const started = async (over: MakeOver = {}): Promise<ReturnType<typeof makeSession>> => {
  const h = makeSession(over)
  h.session.start()
  await flush()
  return h
}

// ── 任务 6：生命周期与播放主循环 ──

describe('启动', () => {
  it('start：合成→载入→setRate→play，状态 starting→playing', async () => {
    const h = makeSession()
    h.session.start()
    expect(h.last().status).toBe('starting')
    await flush()
    expect(h.synth.requests[0]).toEqual({ text: 'One.', voice: 'en-US-AndrewNeural' })
    expect(h.audio.calls.load).toBe(1)
    expect(h.audio.calls.rates).toContain(1)
    expect(h.audio.calls.play).toBe(1)
    expect(h.last().status).toBe('playing')
  })

  it('start 先派 onSentenceChange(startIndex)', () => {
    const h = makeSession({ startIndex: 1 })
    h.session.start()
    expect(h.events).toContain('sentence:1')
  })

  it('start(paused=true) 只落位：不合成不发声', async () => {
    const h = makeSession()
    h.session.start(true)
    await flush()
    expect(h.synth.requests).toHaveLength(0)
    expect(h.audio.calls.play).toBe(0)
    expect(h.last().status).toBe('paused')
  })
})

describe('暂停与恢复', () => {
  it('pause：audio.pause 且状态 paused', async () => {
    const h = await started()
    h.session.pause()
    expect(h.audio.calls.pause).toBe(1)
    expect(h.last().status).toBe('paused')
  })

  it('resume：已载入当前句直接 play，不重合成', async () => {
    const h = await started()
    h.session.pause()
    const synthCount = h.synth.requests.length
    h.session.resume()
    expect(h.synth.requests.length).toBe(synthCount)
    expect(h.audio.calls.play).toBe(2)
    expect(h.last().status).toBe('playing')
  })

  it('载入途中被暂停：载入完成后备好但不发声', async () => {
    const h = makeSession()
    h.session.start()
    h.session.pause() // 合成/载入尚在途
    await flush()
    expect(h.audio.calls.play).toBe(0)
    expect(h.last().status).toBe('paused')
  })
})

describe('推进与复读', () => {
  it('句读完→按 gap/rate 等待→推进下一句', async () => {
    const h = await started({ rate: 2 })
    h.audio.emitEnded()
    expect(h.wait.pending[0]!.ms).toBeCloseTo((SENTENCE_GAP / 2) * 1000, 5)
    h.wait.flush()
    await flush()
    expect(h.events).toContain('sentence:1')
    expect(h.audio.calls.play).toBe(2)
  })

  it('跨段落用 PARAGRAPH_GAP', async () => {
    const h = await started()
    h.audio.emitEnded()
    h.wait.flush()
    await flush() // 0→1（句间隙）
    h.audio.emitEnded() // 1→2 跨块
    expect(h.wait.pending[0]!.ms).toBeCloseTo(PARAGRAPH_GAP * 1000, 5)
  })

  it('复读开启：句读完 seek(0) 重播，不推进不等间隙', async () => {
    const h = await started()
    h.session.setRepeating(true)
    h.audio.emitEnded()
    expect(h.wait.pending).toHaveLength(0)
    expect(h.audio.calls.seeks).toEqual([0, 0]) // 起播一次 + 复读回卷一次
    expect(h.audio.calls.play).toBe(2)
    expect(h.last().sentenceIndex).toBe(0)
  })

  it('末句读完 → onBoundary(next)', async () => {
    const h = await started({ startIndex: 2 })
    h.audio.emitEnded()
    await flush()
    expect(h.events).toContain('boundary:next')
  })
})

describe('销毁', () => {
  it('dispose 后在途续体不再发声', async () => {
    const h = makeSession()
    h.session.start()
    h.session.dispose()
    await flush()
    expect(h.audio.calls.play).toBe(0)
    expect(h.audio.calls.stop).toBeGreaterThan(0)
  })
})

// ── 任务 7：句间导航与时长回填 ──

describe('句间导航', () => {
  it('播放中 next 立即播新句，不经间隙', async () => {
    const h = await started()
    h.session.next()
    await flush()
    expect(h.wait.pending).toHaveLength(0)
    expect(h.events).toContain('sentence:1')
    expect(h.audio.calls.play).toBe(2)
  })

  it('暂停中 next 只改句与快照，不发声', async () => {
    const h = await started()
    h.session.pause()
    h.session.next()
    await flush()
    expect(h.last().sentenceIndex).toBe(1)
    expect(h.last().status).toBe('paused')
    // 只断言「不发声」（play 仍是启动那一次），不断言「不合成」——任务 8 的预取会合法地
    // 提前合成后续句，拿请求数判「暂停跳转没发声」在那之后就是假信号。
    expect(h.audio.calls.play).toBe(1)
  })

  it('暂停跳转后 resume 从当前句重合成再发声', async () => {
    const h = await started()
    h.session.pause()
    h.session.next()
    await flush()
    h.session.resume()
    await flush()
    expect(h.synth.requests.map((r) => r.text)).toContain('Two.')
    expect(h.audio.calls.play).toBe(2)
    expect(h.last().status).toBe('playing')
  })

  it('首句 prev → onBoundary(prev)；末句 next → onBoundary(next)', async () => {
    const h = await started()
    h.session.prev()
    expect(h.events).toContain('boundary:prev')

    const h2 = await started({ startIndex: 2 })
    h2.session.next()
    expect(h2.events).toContain('boundary:next')
  })

  it('seekTo 按句吸附到落点所在句句首', async () => {
    const h = await started() // 句 0 实测回填为 2s
    h.session.seekTo(2 + SENTENCE_GAP + 0.1)
    await flush()
    expect(h.last().sentenceIndex).toBe(1)
    expect(h.events).toContain('sentence:1')
  })

  it('暂停跳转后 elapsed = 目标句 offset（句内进度清零）', async () => {
    const h = await started()
    h.audio.emitTime(1.5)
    h.session.pause()
    h.session.next()
    expect(h.last().elapsed).toBeCloseTo(2 + SENTENCE_GAP, 5)
  })
})

describe('实测时长回填', () => {
  it('load 后当前句时长与总时长按实测更新（快照可见）', async () => {
    const h = await started() // fakeAudio 恒回 2s；'One.'/'Two.'/'Three.' 估算各 0.4s
    expect(h.last().duration).toBeCloseTo(2 + SENTENCE_GAP + 0.4 + PARAGRAPH_GAP + 0.4, 5)
  })

  it('回填同时写进校准表', async () => {
    const calibration = new Map()
    await started({ calibration })
    expect(calibration.get('en-US-AndrewNeural')).toEqual({ chars: 4, seconds: 2 })
  })
})

// ── 任务 8：合成管线 ──

describe('预取与缓冲', () => {
  it('起播后预取后续 2 句', async () => {
    const h = await started()
    expect(h.synth.requests.map((r) => r.text)).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('预取命中缓存：next 不再重复合成', async () => {
    const h = await started()
    h.session.next()
    await flush()
    expect(h.synth.requests).toHaveLength(3)
  })

  it('同句在途去重：往返导航不重复合成', async () => {
    const h = makeSession({ deferSynth: true })
    h.session.start()
    h.session.next()
    h.session.prev()
    expect(h.synth.requests.filter((r) => r.text === 'One.')).toHaveLength(1)
  })

  it('bufferedFraction 反映连续就绪段（部分预取时 0<x<1）', async () => {
    const h = await started({ sentences: [S('a b c.'), S('d e.'), S('f g.'), S('h i.'), S('j k.')] })
    const b = h.last().bufferedFraction
    expect(b).toBeGreaterThan(0)
    expect(b).toBeLessThan(1)
  })
})

describe('合成失败策略', () => {
  it('失败重试一次后成功，照常起播', async () => {
    const h = makeSession()
    h.synth.failNext(1)
    h.session.start()
    await flush()
    expect(h.synth.requests.filter((r) => r.text === 'One.')).toHaveLength(2)
    expect(h.audio.calls.play).toBe(1)
    expect(h.last().status).toBe('playing')
  })

  it('重试仍失败：跳句续播下一句', async () => {
    const h = makeSession()
    h.synth.failNext(2) // 句 0 首次 + 重试全失败
    h.session.start()
    await flush()
    expect(h.events).toContain('sentence:1')
    expect(h.last().status).toBe('playing')
  })

  it('连续 3 句全失败：onError 且状态 ended', async () => {
    const h = makeSession()
    h.synth.failNext(6) // 3 句 ×（首次 + 重试）
    h.session.start()
    await flush()
    expect(h.events.some((e) => e.startsWith('error:'))).toBe(true)
    expect(h.last().status).toBe('ended')
  })

  it('一句成功即清零连续失败计数', async () => {
    const h = makeSession({ sentences: [S('a.'), S('b.'), S('c.'), S('d.'), S('e.')] })
    h.synth.failNext(4) // 句 0、句 1 各两次失败 → 句 2 成功
    h.session.start()
    await flush()
    expect(h.last().status).toBe('playing')
    expect(h.last().sentenceIndex).toBe(2)
  })

  // 合成成功但音频装不进播出端口（解码失败）也是「这句播不出来」，与合成失败同路处理。
  it('载入失败：跳句续播下一句', async () => {
    const h = makeSession()
    h.audio.failLoadNext(1)
    h.session.start()
    await flush()
    expect(h.events).toContain('sentence:1')
    expect(h.last().sentenceIndex).toBe(1)
    expect(h.last().status).toBe('playing')
  })

  it('连续 3 句载入失败：onError 且状态 ended', async () => {
    const h = makeSession()
    h.audio.failLoadNext(3)
    h.session.start()
    await flush()
    expect(h.events.some((e) => e.startsWith('error:'))).toBe(true)
    expect(h.last().status).toBe('ended')
  })
})

describe('换速与换声', () => {
  it('setRate 即时 audio.setRate，不重合成不重播', async () => {
    const h = await started()
    const played = h.audio.calls.play
    const synthCount = h.synth.requests.length
    h.session.setRate(2)
    expect(h.audio.calls.rates).toContain(2)
    expect(h.audio.calls.play).toBe(played)
    expect(h.synth.requests.length).toBe(synthCount)
    expect(h.last().rate).toBe(2)
  })

  it('setVoice：停止并按新声重合成当前句（缓存按新 key 未命中）', async () => {
    const h = await started()
    h.session.setVoice('en-US-AvaNeural')
    await flush()
    const forOne = h.synth.requests.filter((r) => r.text === 'One.')
    expect(forOne.map((r) => r.voice)).toEqual(['en-US-AndrewNeural', 'en-US-AvaNeural'])
    expect(h.last().status).toBe('playing')
  })

  // 音色与内容语言无关：中文句照样用用户选的这一款英语音色合成（tts.md §换声音）。
  it('中文句用的也是会话音色，不按语言另选', async () => {
    const h = await started({ sentences: [S('One.'), S('你好世界。')] })
    h.session.next()
    await flush()
    const forZh = h.synth.requests.filter((r) => r.text === '你好世界。')
    expect(forZh.length).toBeGreaterThan(0)
    expect(forZh.every((r) => r.voice === 'en-US-AndrewNeural')).toBe(true)
  })

  it('setVoice 选中同一款：不打断播放也不重合成', async () => {
    const h = await started()
    const played = h.audio.calls.play
    const synthCount = h.synth.requests.length
    h.session.setVoice('en-US-AndrewNeural')
    await flush()
    expect(h.audio.calls.play).toBe(played)
    expect(h.synth.requests.length).toBe(synthCount)
  })
})

// ── 单声互斥：查词发音的短暂打断（tts.md §播放控制）──

describe('发音片段打断', () => {
  it('播放中 interrupt 即暂停；片段结束 resumeInterrupted 自动恢复', async () => {
    const h = await started()
    h.session.interrupt()
    expect(h.last().status).toBe('paused')
    expect(h.audio.calls.pause).toBe(1)
    h.session.resumeInterrupted()
    expect(h.last().status).toBe('playing')
    expect(h.audio.calls.play).toBe(2) // 起播一次 + 恢复一次
  })

  it('用户暂停态 interrupt 无操作，片段结束也不代替用户恢复', async () => {
    const h = await started()
    h.session.pause()
    h.session.interrupt()
    h.session.resumeInterrupted()
    expect(h.last().status).toBe('paused')
    expect(h.audio.calls.play).toBe(1) // 只有起播那一次
  })

  it('打断期间用户接管（恢复再手动暂停）：迟到的 resumeInterrupted 不再生效', async () => {
    const h = await started()
    h.session.interrupt()
    h.session.toggle() // 用户自己按了播放：接管，打断记忆作废
    expect(h.last().status).toBe('playing')
    h.session.pause() // 用户手动暂停
    h.session.resumeInterrupted() // 早已被掐掉的片段这时才报结束
    expect(h.last().status).toBe('paused')
  })

  it('打断期间跳句（暂停态导航语义不变），片段结束后从新句恢复出声', async () => {
    const h = await started()
    h.session.interrupt()
    h.session.next()
    await flush()
    expect(h.last().status).toBe('paused')
    expect(h.last().sentenceIndex).toBe(1)
    h.session.resumeInterrupted()
    await flush() // 跳句清了 loaded：恢复走重合成路径
    expect(h.last().status).toBe('playing')
    expect(h.synth.requests.some((r) => r.text === 'Two.')).toBe(true)
  })

  it('starting 态（乐观启动合成中）也可被打断：合成完成不发声，恢复后才播', async () => {
    const h = makeSession()
    h.session.start()
    h.session.interrupt()
    expect(h.last().status).toBe('paused')
    await flush() // 载入途中被暂停：备好待恢复，不发声
    expect(h.audio.calls.play).toBe(0)
    h.session.resumeInterrupted()
    expect(h.last().status).toBe('playing')
    expect(h.audio.calls.play).toBe(1)
  })
})
