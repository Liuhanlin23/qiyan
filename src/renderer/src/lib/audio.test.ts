// 发音播放态 store 单测：UI 的喇叭动画完全靠它驱动，所以「该亮的时候亮、该灭的时候灭」是硬要求。
// 最要命的是**熄灭**：任何一条通往「没声了」的路（播完 / 出错 / 播不出 / 被别的声音顶掉 / 被朗读打断）
// 都必须把状态归零，否则按钮会停在动画态变成「显示在播、实际无声」的僵尸。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  audioStore,
  getAudioPhase,
  interruptClip,
  occupySpeaker,
  playAudioUrl,
  resolveShownAccent,
  resolveWordAudioUrl,
} from './audio'

/** 最小 HTMLAudioElement 替身：事件与 play() 的时序全部交给测试摆布。 */
class FakeAudio {
  static instances: FakeAudio[] = []
  paused = false
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly playPromise: Promise<void>
  private settle!: { resolve: () => void; reject: (e: unknown) => void }

  constructor(readonly src: string) {
    FakeAudio.instances.push(this)
    this.playPromise = new Promise<void>((resolve, reject) => {
      this.settle = { resolve, reject }
    })
  }

  addEventListener(type: string, fn: () => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(fn)
    this.listeners.set(type, set)
  }

  play(): Promise<void> {
    return this.playPromise
  }

  pause(): void {
    this.paused = true
  }

  /** 触发媒体事件（playing / ended / error）。 */
  emit(type: string): void {
    this.listeners.get(type)?.forEach((fn) => fn())
  }

  /** play() 兑现 —— 浏览器接受了播放请求。 */
  accept(): Promise<void> {
    this.settle.resolve()
    return Promise.resolve()
  }

  /** play() 被拒 —— 离线 / URL 失效 / 自动播放策略拦截。 */
  reject(): Promise<void> {
    this.settle.reject(new Error('play rejected'))
    return Promise.resolve()
  }
}

const last = (): FakeAudio => FakeAudio.instances[FakeAudio.instances.length - 1]

beforeEach(() => {
  FakeAudio.instances = []
  vi.stubGlobal('Audio', FakeAudio)
})

afterEach(() => {
  interruptClip() // 每例自清，免得上一例的在播态漏给下一例
  vi.unstubAllGlobals()
})

describe('播放态 store', () => {
  it('初始无播放：快照为 null，任意 url 都是 idle', () => {
    expect(audioStore.getSnapshot()).toBeNull()
    expect(getAudioPhase('a.mp3')).toBe('idle')
  })

  it('点下即进 loading 并通知订阅者——不等网络回来才给反馈', () => {
    const listener = vi.fn()
    const unsubscribe = audioStore.subscribe(listener)

    void playAudioUrl('a.mp3')

    expect(getAudioPhase('a.mp3')).toBe('loading')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('playing 事件到达才转 playing（真出声了才变色）', () => {
    void playAudioUrl('a.mp3')
    expect(getAudioPhase('a.mp3')).toBe('loading')

    last().emit('playing')

    expect(getAudioPhase('a.mp3')).toBe('playing')
  })

  it('play() 兑现也转 playing——playing 事件缺席时的兜底', async () => {
    void playAudioUrl('a.mp3')
    await last().accept()

    expect(getAudioPhase('a.mp3')).toBe('playing')
  })

  it('只有点中的那条 url 会亮，别的 url 仍是 idle', () => {
    void playAudioUrl('a.mp3')
    last().emit('playing')

    expect(getAudioPhase('b.mp3')).toBe('idle')
    expect(getAudioPhase(null)).toBe('idle')
    expect(getAudioPhase(undefined)).toBe('idle')
  })

  it('播完归零', () => {
    void playAudioUrl('a.mp3')
    last().emit('playing')

    last().emit('ended')

    expect(getAudioPhase('a.mp3')).toBe('idle')
    expect(audioStore.getSnapshot()).toBeNull()
  })

  it('出错归零', () => {
    void playAudioUrl('a.mp3')

    last().emit('error')

    expect(getAudioPhase('a.mp3')).toBe('idle')
  })

  it('play() 被拒归零——离线时不能把 loading 挂死', async () => {
    const p = playAudioUrl('a.mp3')
    await last().reject()
    await p

    expect(getAudioPhase('a.mp3')).toBe('idle')
  })

  it('互斥：新的一条掐掉旧的，旧按钮同帧熄灭', () => {
    void playAudioUrl('a.mp3')
    last().emit('playing')
    const first = last()

    void playAudioUrl('b.mp3')

    expect(first.paused).toBe(true)
    expect(getAudioPhase('a.mp3')).toBe('idle')
    expect(getAudioPhase('b.mp3')).toBe('loading')
  })

  it('被顶掉那条的迟到事件不得污染新状态', () => {
    void playAudioUrl('a.mp3')
    const first = last()
    void playAudioUrl('b.mp3')
    last().emit('playing')

    first.emit('ended') // 被 pause 的旧片段迟到的收尾

    expect(getAudioPhase('b.mp3')).toBe('playing')
  })

  it('被朗读打断（interruptClip）归零', () => {
    void playAudioUrl('a.mp3')
    last().emit('playing')

    interruptClip()

    expect(getAudioPhase('a.mp3')).toBe('idle')
  })

  it('同一条重播：从 playing 退回 loading（重新起播，动画跟着重来）', () => {
    void playAudioUrl('a.mp3')
    last().emit('playing')

    void playAudioUrl('a.mp3')

    expect(getAudioPhase('a.mp3')).toBe('loading')
  })
})

describe('与长时音源占用者的让位协议（回归）', () => {
  it('片段将播时占用者让位，片段收尾时交还', () => {
    const occupant = { interrupt: vi.fn(), resume: vi.fn() }
    const release = occupySpeaker(occupant)

    void playAudioUrl('a.mp3')
    expect(occupant.interrupt).toHaveBeenCalledTimes(1)
    expect(occupant.resume).not.toHaveBeenCalled()

    last().emit('ended')
    expect(occupant.resume).toHaveBeenCalledTimes(1)

    release()
  })
})

describe('resolveWordAudioUrl', () => {
  const row = { ukAudioUrl: 'uk.mp3', usAudioUrl: 'us.mp3', audioUrl: 'fallback.mp3' }

  it('取所选口音那一列', () => {
    expect(resolveWordAudioUrl(row, 'uk')).toBe('uk.mp3')
    expect(resolveWordAudioUrl(row, 'us')).toBe('us.mp3')
  })

  it('所选口音缺列时退兜底列', () => {
    expect(resolveWordAudioUrl({ ...row, ukAudioUrl: '' }, 'uk')).toBe('fallback.mp3')
  })

  it('三列全空返回 null（这词根本发不出声）', () => {
    expect(resolveWordAudioUrl({ ukAudioUrl: '', usAudioUrl: '', audioUrl: '' }, 'us')).toBeNull()
  })

  it('与实际播出的 URL 同源——订阅身份不会和播出的对不上', () => {
    void playAudioUrl(resolveWordAudioUrl(row, 'uk')!)
    expect(getAudioPhase(resolveWordAudioUrl(row, 'uk'))).toBe('loading')
  })
})

describe('resolveShownAccent（卡面显示与自动发音共用的口音裁决）', () => {
  it('双侧音标俱全：随用户偏好', () => {
    expect(resolveShownAccent({ hasUS: true, hasUK: true }, 'uk')).toBe('uk')
    expect(resolveShownAccent({ hasUS: true, hasUK: true }, 'us')).toBe('us')
  })

  it('单侧音标：钉死在有的那侧，偏好不生效——否则这词会显示成空音标', () => {
    expect(resolveShownAccent({ hasUS: false, hasUK: true }, 'us')).toBe('uk')
    expect(resolveShownAccent({ hasUS: true, hasUK: false }, 'uk')).toBe('us')
  })

  it('两侧全无：随偏好（此时词只有兜底音频，返回值仅作播放订阅身份）', () => {
    expect(resolveShownAccent({ hasUS: false, hasUK: false }, 'uk')).toBe('uk')
    expect(resolveShownAccent({ hasUS: false, hasUK: false }, 'us')).toBe('us')
  })
})
