/**
 * 朗读播放器 demo · 迷你条版式（复刻 readest 的 TTSMiniPlayer）+ 点开的完整播放器（复刻 TTSPlayerSheet）。
 *
 * 播放器压在一篇静态正文上，看的是定高一行 + 贴底三层进度线挡不挡正文。
 * 正文这一版不高亮，逐句 / 逐词跟随留到下一步。
 *
 * 点迷你条的封面 / 标题区展开完整播放器：倍速与音色归它管，迷你条上没有这两项。
 * 两者共用同一套假会话，所以在面板里调的倍速会立刻反映到迷你条的进度推进速度上。
 *
 * 两处 demo 自备的假数据：合成缓冲（恒领先播放头 20 秒）与「原生音色」开关（关掉时间轴看降级形态）。
 * 句复读走假会话里的真逻辑：开着时每帧把越过句尾的时刻弹回句首，所以当前句会一直循环。
 */
import { useMemo, useState } from 'react'
import { AudioLines } from 'lucide-react'
import { Button, Label, Switch } from '@/components/ui'
import { ReaderFrame } from './ReaderFrame'
import { SAMPLE_BOOK, SAMPLE_CHAPTER, SAMPLE_PARAGRAPHS } from './sampleChapter'
import { TtsBarPlayer } from '@/pages/reading/reader/tts/TtsBarPlayer'
import { TtsFullPlayer } from '@/pages/reading/reader/tts/TtsFullPlayer'
import { buildTimeline, syntheticBufferFraction } from './ttsMock'
import { useMockTtsSession } from './useMockTtsSession'

/** 假的合成领先量：真引擎按已合成音频时长上报，这里恒定领先播放头这么多秒。 */
const BUFFER_LEAD_SEC = 20

export function TtsBarPlayerDemo(): React.JSX.Element {
  const timeline = useMemo(() => buildTimeline(SAMPLE_PARAGRAPHS), [])
  const session = useMockTtsSession(timeline)
  const [live, setLive] = useState(true)
  const [hasTimeline, setHasTimeline] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const stop = (): void => {
    if (session.playing) session.toggle()
    setLive(false)
  }

  return (
    <ReaderFrame
      note={
        <span className="flex items-center gap-2">
          <Label htmlFor="tts-native-voice" className="text-xs text-text-muted">
            模拟原生音色（无时间轴）
          </Label>
          <Switch
            id="tts-native-voice"
            checked={!hasTimeline}
            onCheckedChange={(v) => setHasTimeline(!v)}
          />
        </span>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto flex max-w-2xl flex-col gap-5 px-10 pt-4 pb-44 text-base leading-loose text-text-200">
          {SAMPLE_PARAGRAPHS.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
        </article>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-6">
        <div className="pointer-events-auto flex w-full max-w-md justify-center">
          {live ? (
            <TtsBarPlayer
              book={SAMPLE_BOOK}
              chapter={SAMPLE_CHAPTER}
              playing={session.playing}
              elapsed={session.elapsed}
              duration={session.duration}
              measuredFraction={syntheticBufferFraction(
                session.elapsed,
                session.duration,
                BUFFER_LEAD_SEC,
              )}
              hasTimeline={hasTimeline}
              repeating={session.repeating}
              onTogglePlay={session.toggle}
              onPrevSentence={session.prevSentence}
              onNextSentence={session.nextSentence}
              onToggleRepeat={() => session.setRepeating(!session.repeating)}
              onSeek={session.seek}
              onStop={stop}
              onExpand={() => setExpanded(true)}
            />
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setLive(true)
                session.restart()
              }}
            >
              <AudioLines className="size-4" />
              开始朗读
            </Button>
          )}
        </div>
      </div>

      <TtsFullPlayer
        open={expanded}
        onOpenChange={setExpanded}
        book={SAMPLE_BOOK}
        chapter={SAMPLE_CHAPTER}
        playing={session.playing}
        elapsed={session.elapsed}
        duration={session.duration}
        measuredFraction={syntheticBufferFraction(
          session.elapsed,
          session.duration,
          BUFFER_LEAD_SEC,
        )}
        hasTimeline={hasTimeline}
        repeating={session.repeating}
        rate={session.rate}
        voiceId={session.voiceId}
        onTogglePlay={session.toggle}
        onPrevSentence={session.prevSentence}
        onNextSentence={session.nextSentence}
        onToggleRepeat={() => session.setRepeating(!session.repeating)}
        onSeek={session.seek}
        onRateChange={session.setRate}
        onVoiceChange={session.setVoiceId}
      />
    </ReaderFrame>
  )
}
