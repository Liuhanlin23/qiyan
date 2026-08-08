/**
 * AudioPort 的 DOM 实现 —— 单个 <audio> 复用装载每句 MP3（blob URL），playbackRate 变速、
 * preservesPitch 保音高。时间回调用 rAF 驱动（timeupdate 约 250ms 一发，喂逐词高亮太糙）；
 * currentTime 是媒体时间、不随倍速变，与词边界 tick 同域（见 align.ts 文件头）。
 *
 * 刻意无单测：node 测试环境无 DOM（同 foliateEngine.ts 先例）。逻辑保持为零 —— 状态判断
 * 全在 session.ts（已单测），这里只做元素操作的一比一转发。
 */
import { interruptClip } from '@/lib/audio'
import type { AudioPort } from './session'

export interface AudioClipPlayer extends AudioPort {
  /** 会话收尾：停播、撤 rAF、revoke blob URL、清监听。 */
  dispose(): void
}

export function createAudioClipPlayer(): AudioClipPlayer {
  const el = new Audio()
  el.preservesPitch = true
  let url: string | null = null
  const timeCbs = new Set<(sec: number) => void>()
  const endedCbs = new Set<() => void>()
  let raf = 0

  const stopTicking = (): void => cancelAnimationFrame(raf)
  const tick = (): void => {
    timeCbs.forEach((cb) => cb(el.currentTime))
    raf = requestAnimationFrame(tick)
  }
  el.addEventListener('play', () => {
    stopTicking()
    raf = requestAnimationFrame(tick)
  })
  el.addEventListener('pause', stopTicking) // ended 之前浏览器也会先发 pause
  el.addEventListener('ended', () => {
    stopTicking()
    // 末帧补报：rAF 可能停在句尾前一帧，词高亮会差最后一个词
    if (Number.isFinite(el.duration)) timeCbs.forEach((cb) => cb(el.duration))
    endedCbs.forEach((cb) => cb())
  })

  const revoke = (): void => {
    if (url) {
      URL.revokeObjectURL(url)
      url = null
    }
  }

  return {
    load(audio) {
      revoke()
      url = URL.createObjectURL(new Blob([audio], { type: 'audio/mpeg' }))
      el.src = url
      return new Promise<number>((resolve, reject) => {
        const cleanup = (): void => {
          el.removeEventListener('loadedmetadata', onMeta)
          el.removeEventListener('error', onErr)
        }
        const onMeta = (): void => {
          cleanup()
          resolve(el.duration) // 可能 NaN/Infinity，session 侧回填自带守卫
        }
        const onErr = (): void => {
          cleanup()
          reject(new Error('音频解码失败'))
        }
        el.addEventListener('loadedmetadata', onMeta)
        el.addEventListener('error', onErr)
      })
    },
    play() {
      interruptClip() // 单声互斥的反方向：朗读出声前掐掉在播的发音片段（lib/audio 占用者协议）
      // 桌面 Electron 无自动播放门槛；万一被拒也不抛——快照会停在无 onTime 推进的状态
      void el.play().catch(() => {})
    },
    pause() {
      el.pause()
    },
    stop() {
      el.pause()
      try {
        el.currentTime = 0
      } catch {
        // 无源时置 currentTime 会抛，忽略
      }
    },
    seek(seconds) {
      el.currentTime = seconds
    },
    setRate(rate) {
      el.playbackRate = rate
    },
    onTime(cb) {
      timeCbs.add(cb)
      return () => timeCbs.delete(cb)
    },
    onEnded(cb) {
      endedCbs.add(cb)
      return () => endedCbs.delete(cb)
    },
    dispose() {
      stopTicking()
      el.pause()
      el.removeAttribute('src')
      // 撤源后再 load() 一次才真放掉解码器与已缓冲的那段 MP3；只 removeAttribute 会留到元素被 GC
      //（跨章每章换一个 player，攒起来就是每章一份整句音频）。无源的 load 不发 error，只发 emptied。
      el.load()
      revoke()
      timeCbs.clear()
      endedCbs.clear()
    },
  }
}
