// 发音播放：业务规则见 docs/feature/cache/dict.md §7。词卡/学习页单词发音与朗读例句共用本模块。
import type { LocalDictRow } from '@/dict/types'

/** 词发音所需的音频 URL 三列（LocalDictRow 子集；NoteCardData 等展示模型冗余同名列即可复用）。 */
export type WordAudioColumns = Pick<LocalDictRow, 'ukAudioUrl' | 'usAudioUrl' | 'audioUrl'>

// 全局互斥：记住当前在播的 Audio，新播放前先掐掉它，保证同一时刻只有一个声音
//（例句朗读几秒长，叠上单词发音会双声；连点同一按钮会出回声）。
let current: HTMLAudioElement | null = null

/**
 * 播放态（喇叭动画的唯一数据源）。互斥本就要求本模块独知「此刻在播哪一条」——把这份私有
 * 记账发布出去，UI 订阅即可，无须各按钮自管 state：被顶掉的那条自动熄灭，不会留下
 * 「显示在播、实际无声」的僵尸按钮。
 *
 * loading 与 playing 分开，是因为音频走 CDN：点下到出声隔着一次网络往返，只认 playing
 * 的话慢网下按钮会静止一整秒，用户以为没点上。
 */
export type AudioPhase = 'idle' | 'loading' | 'playing'

/** 在播片段的身份 = 它的 URL（同一条音频的所有入口一起亮，语义正确）。 */
interface PlayingClip {
  url: string
  phase: Exclude<AudioPhase, 'idle'>
}

let playing: PlayingClip | null = null
const listeners = new Set<() => void>()

/** 置位并通知；同态去重，免得连点同一按钮空转渲染。 */
function setPlaying(next: PlayingClip | null): void {
  if (playing?.url === next?.url && playing?.phase === next?.phase) return
  playing = next
  for (const listener of listeners) listener()
}

/** 供 useSyncExternalStore 订阅的极简发布订阅 store（snapshot = 在播片段，无则 null）。 */
export const audioStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot(): PlayingClip | null {
    return playing
  },
}

/** 某条音频此刻处于哪一态；url 为空（该词没有音频）恒为 idle。 */
export function getAudioPhase(url: string | null | undefined): AudioPhase {
  if (!url || playing?.url !== url) return 'idle'
  return playing.phase
}

/**
 * 长时音源占用者（当前即阅读页朗读会话）—— 片段互斥管不了它：长时音源的 <audio> 生命周期
 * 由它自己的状态机维护，从背后 pause 会造成「UI 显示在播、实际无声」的僵尸态。改为协议让位：
 * 片段将播时 interrupt()（占用者正规暂停并自记「被打断」），片段结束 resume()（仍处被打断态
 * 才恢复——是否恢复的记忆归占用者，本模块不揣测）。tts.md §播放控制「与单词发音单声互斥」。
 */
export interface SpeakerOccupant {
  interrupt(): void
  resume(): void
}

let occupant: SpeakerOccupant | null = null

/** 注册长时音源占用者（同一时刻至多一个，后注册顶替前者）；返回注销函数。 */
export function occupySpeaker(o: SpeakerOccupant): () => void {
  occupant = o
  return () => {
    if (occupant === o) occupant = null
  }
}

/** 互斥的反方向：长时音源要出声，掐掉在播的片段（朗读的播出路径调用）。 */
export function interruptClip(): void {
  current?.pause()
  current = null
  setPlaying(null)
}

/**
 * 播放一条音频 URL（new Audio）：先停掉上一条并让占用者让位（全局互斥），再尽力而为地播；
 * 失败静默不抛错——发音是辅助，失败不打扰用户。
 */
export async function playAudioUrl(url: string): Promise<void> {
  current?.pause()
  occupant?.interrupt()
  const audio = new Audio(url)
  current = audio
  // 点下即置 loading：这一步不等网络，用户才不会以为按钮没响应。
  setPlaying({ url, phase: 'loading' })
  /** 片段让出扬声器（播完 / 失败 / 播放被拒）：仍是在播片段时才把恢复权交还占用者。 */
  const done = (): void => {
    if (current !== audio) return // 已被更新的片段或朗读顶掉：恢复权与熄灯权都不归这条
    current = null
    setPlaying(null)
    occupant?.resume()
  }
  audio.addEventListener('playing', () => {
    if (current === audio) setPlaying({ url, phase: 'playing' })
  })
  audio.addEventListener('ended', done)
  audio.addEventListener('error', done)
  try {
    await audio.play()
    // play() 兑现即「浏览器已开播」，作 playing 事件缺席时的兜底（setPlaying 同态去重，不会重复通知）。
    if (current === audio) setPlaying({ url, phase: 'playing' })
  } catch {
    // 离线 / URL 失效 / 播放被拒 → 静默；error 事件不一定伴随，故这里也走 done（其自身幂等）
    done()
  }
}

/**
 * 该词有没有可播的发音（三列任一有 URL）。无则不该摆发音键——全端无 TTS（§7），
 * 摆一个按不响的键更糟。
 */
export function hasWordAudio(row: WordAudioColumns): boolean {
  return !!(row.ukAudioUrl || row.usAudioUrl || row.audioUrl)
}

/**
 * 单词卡该按哪一侧口音出示（音标显示、发音播出与播放订阅身份共用这一条裁决）。
 *
 * 有道对部分词只落一侧音标（cache/dict.md §7）：双侧俱全才随用户偏好，**单侧钉死在有的那侧**——
 * 跨词保持的口音偏好不该把这词显示成空音标；两侧全无时无所谓英美（词只有兜底 audio_url），
 * 返回偏好侧仅供解析播放订阅身份。
 */
export function resolveShownAccent(
  phonetics: { hasUS: boolean; hasUK: boolean },
  preferred: 'us' | 'uk',
): 'us' | 'uk' {
  if (phonetics.hasUS && phonetics.hasUK) return preferred
  if (phonetics.hasUK) return 'uk'
  if (phonetics.hasUS) return 'us'
  return preferred
}

/**
 * 口音 → dict 音频列优先级：所选口音列 → 兜底列（uk/us 都缺时用）。空 URL 跳过。
 * 同时是 UI 订阅播放态的身份来源——与 playWordAudio 实际播出的必须是同一条，故共用本函数。
 */
export function resolveWordAudioUrl(row: WordAudioColumns, accent: 'us' | 'uk'): string | null {
  const primary = accent === 'uk' ? row.ukAudioUrl : row.usAudioUrl
  return primary || row.audioUrl || null
}

/** 播放该词发音：播所选口音的 CDN URL；无 URL（离线/缺列）静默。 */
export async function playWordAudio(row: WordAudioColumns, accent: 'us' | 'uk'): Promise<void> {
  const url = resolveWordAudioUrl(row, accent)
  if (url) await playAudioUrl(url)
}
