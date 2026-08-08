/**
 * 朗读播放器 · 完整播放器 —— 从迷你条封面点开的那张面板，版式复刻 readest 的 `TTSPlayerSheet`。
 *
 * 照搬的版式要点：大封面 + 居中的书名 / 章节、章内进度条、一排传输键，
 * 最下面一行「入口卡片」——点进去是**同一张面板内的二级视图**（返回键换头），
 * 而不是再弹一层浮层：上游这么做是因为下拉菜单会被面板的滚动容器裁掉，桌面同样受用。
 *
 * 相对 readest 的删改（依据 docs/feature/reading/tts.md 的功能表）：
 *   - **去掉睡眠定时与离线音频**：tts.md 两项都标 ❌（关书即停、联网即用）。
 *   - **去掉段级导航**：tts.md「句级已够」，传输组不放上一段 / 下一段。
 *   - **去掉句 / 段间隙刻度尺**：tts.md「用固定默认值」，倍速子视图只剩倍速一把尺。
 *   - **补一个句复读键**：与迷你条对齐（英语学习刚需，readest 没有）——从迷你条展开后，能力不该反而变少。
 *   - 音色**按口音**分组而非按引擎：只有 Edge 一个引擎（tts.md），要挑的是美音还是英音。
 *   - readest 是移动端从底部升起的 sheet（桌面退化成 420px 居中框）；本项目只有桌面，直接用 CDS 的居中 Dialog。
 *
 * 纯展示组件：播放状态与全部动作由外部传入，自身只持有「当前二级视图」与进度条的拖动预览值。
 */
import { useEffect, useState } from 'react'
import { Slider as SliderPrimitive } from 'radix-ui'
import { Check, ChevronLeft, Pause, Play, Repeat1, SkipBack, SkipForward, Speech } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ScrollArea,
} from '@/components/ui'
import { Cover } from './Cover'
import {
  bufferedPercent,
  formatClock,
  formatRate,
  percentToSeconds,
  playbackLabels,
} from './playback'
import { SpeedRuler } from './SpeedRuler'
import { VOICE_GROUPS, voiceName } from './voices'

/** 面板内的二级视图。主视图之外每个都换成「返回 + 标题」的头。 */
type PlayerView = 'main' | 'speed' | 'voice'

const VIEW_TITLES: Record<PlayerView, string> = {
  main: '朗读',
  speed: '倍速',
  voice: '选择音色',
}

export interface TtsFullPlayerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  book: string
  chapter: string
  playing: boolean
  /** 章内已播秒数。 */
  elapsed: number
  /** 章内总时长（秒）。 */
  duration: number
  /** 已合成比例 0–1，缓冲段画到这里；真引擎上报，demo 里伪造。 */
  measuredFraction: number
  /** 无时间轴时进度条整条收起，退化成一行「本章剩余」。 */
  hasTimeline: boolean
  /** 当前句循环复读中。 */
  repeating: boolean
  rate: number
  voiceId: string
  onTogglePlay: () => void
  onPrevSentence: () => void
  onNextSentence: () => void
  onToggleRepeat: () => void
  /** 拖动松手时才调：按句吸附跳转。 */
  onSeek: (seconds: number) => void
  onRateChange: (rate: number) => void
  onVoiceChange: (voiceId: string) => void
}

export function TtsFullPlayer({
  open,
  onOpenChange,
  book,
  chapter,
  playing,
  elapsed,
  duration,
  measuredFraction,
  hasTimeline,
  repeating,
  rate,
  voiceId,
  onTogglePlay,
  onPrevSentence,
  onNextSentence,
  onToggleRepeat,
  onSeek,
  onRateChange,
  onVoiceChange,
}: TtsFullPlayerProps): React.JSX.Element {
  const [view, setView] = useState<PlayerView>('main')

  // 每次重新打开都回到主视图：上次退出前停在哪个二级视图是上一场的事。
  useEffect(() => {
    if (open) setView('main')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 给个下限高度：主视图约 400px，二级视图不撑到相近高度的话，切过去面板会明显缩一截。
          readest 移动端的 sheet 干脆定死 65% 高度，同一个道理。
          顺带把 DialogContent 默认的 grid 换成 flex 列：grid 会把多出来的高度平摊给每一行，
          子视图想垂直居中就得跟标题行分这份高度，居不准。 */}
      <DialogContent className="flex max-w-sm min-h-96 flex-col gap-0 p-4">
        <DialogDescription className="sr-only">朗读播放控制</DialogDescription>

        {view === 'main' ? (
          // 主视图不占标题行：内容自己说得清，且这一行会把封面往下推。标题只留给读屏。
          <DialogTitle className="sr-only">{VIEW_TITLES.main}</DialogTitle>
        ) : (
          <div className="relative flex h-8 shrink-0 items-center">
            <Button
              variant="ghost"
              size="iconSm"
              round
              onClick={() => setView('main')}
              aria-label="返回"
              className="text-text-300"
            >
              <ChevronLeft className="size-5" />
            </Button>
            {/* 绝对居中而非 flex 居中：左边的返回键和右上角的关闭键宽度不等，跟着流排会偏。 */}
            <DialogTitle className="pointer-events-none absolute inset-x-0 text-center">
              {VIEW_TITLES[view]}
            </DialogTitle>
          </div>
        )}

        {view === 'main' && (
          <div className="flex flex-col items-center gap-4 pt-2">
            <Cover book={book} className="size-32 rounded-card text-4xl" />
            <div className="flex w-full flex-col items-center gap-0.5 text-center">
              <span className="line-clamp-1 font-semibold text-text-000">{book}</span>
              {chapter && <span className="line-clamp-1 text-sm text-text-muted">{chapter}</span>}
            </div>

            {hasTimeline ? (
              <ChapterScrubber
                elapsed={elapsed}
                duration={duration}
                measuredFraction={measuredFraction}
                onSeek={onSeek}
              />
            ) : (
              // 原生音色给不出时间轴，进度与拖动都无从谈起，只剩一句按估算的剩余时长。
              <span className="py-1 text-xs tabular-nums text-text-muted">
                本章剩余 {formatClock(duration - elapsed)}
              </span>
            )}

            {/* 音频时间轴的惯例：传输键顺序不随书写方向翻转（本项目暂无 RTL，跟着 readest 一起先立着）。 */}
            <div dir="ltr" className="flex items-center justify-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                round
                onClick={onToggleRepeat}
                aria-label="复读当前句"
                aria-pressed={repeating}
                title={repeating ? '复读中，点击取消' : '复读当前句'}
                // 生效中用 chip 成对色标出来：这是个会一直挂着的模式，不是一次性动作。
                className={
                  repeating
                    ? 'bg-bg-accent-chip text-text-accent hover:bg-bg-accent-chip'
                    : 'text-text-300'
                }
              >
                <Repeat1 className="size-5" />
              </Button>
              <Button
                variant="ghost"
                size="iconLg"
                round
                onClick={onPrevSentence}
                aria-label="上一句"
                title="上一句"
                className="text-text-100"
              >
                <SkipBack className="size-6 fill-current" />
              </Button>
              <Button
                variant="primary"
                round
                onClick={onTogglePlay}
                aria-label={playing ? '暂停' : '播放'}
                className="size-14 min-w-0 p-0"
              >
                {playing ? (
                  <Pause className="size-6 fill-current" />
                ) : (
                  // 三角形视觉重心偏左，右移半格才在圆里居中。
                  <Play className="size-6 translate-x-px fill-current" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="iconLg"
                round
                onClick={onNextSentence}
                aria-label="下一句"
                title="下一句"
                className="text-text-100"
              >
                <SkipForward className="size-6 fill-current" />
              </Button>
              {/* 右端配平复读键的宽度：让走句 / 播放三键这一簇的正中落在面板正中，
                  同时复读键紧挨着它们，而不是被推到面板最左边孤零零地站着。 */}
              <span aria-hidden className="size-9 shrink-0" />
            </div>

            <div className="flex w-full gap-2">
              <EntryCard label="倍速" onClick={() => setView('speed')}>
                <span className="text-sm font-semibold tabular-nums text-text-000">
                  {formatRate(rate)}
                </span>
              </EntryCard>
              <EntryCard label={voiceName(voiceId) ?? '音色'} onClick={() => setView('voice')}>
                <Speech className="size-4 text-text-100" />
              </EntryCard>
            </div>
          </div>
        )}

        {/* 尺子只有一把，撑不满面板；垂直居中而不是吊在顶上。 */}
        {view === 'speed' && (
          <div className="flex flex-1 items-center">
            <SpeedRuler rate={rate} onSelect={onRateChange} />
          </div>
        )}

        {view === 'voice' && (
          <VoiceList
            selected={voiceId}
            onSelect={(id) => {
              onVoiceChange(id)
              // 选完就回主视图：换音色是一次性动作，不像倍速要来回试。
              setView('main')
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * 章内进度条：已播 / 三层轨道 / 剩余。
 * 三层是「播到哪 + 合成到哪」两个读数叠出来的；缓冲段用同色更淡的一档而不是另换色相——
 * 它是「已播」的前哨，不是另一种状态。与迷你条同款，区别是这里滑块常驻可见：
 * 完整播放器就是专门来拖的，没有「不碍事」的诉求。
 */
function ChapterScrubber({
  elapsed,
  duration,
  measuredFraction,
  onSeek,
}: {
  elapsed: number
  duration: number
  measuredFraction: number
  onSeek: (seconds: number) => void
}): React.JSX.Element {
  // 拖动中的预览百分比。拖动期间读数跟着手走，但不真的跳转——松手才 seek（tts.md：预览不改写朗读锚点）。
  const [preview, setPreview] = useState<number | null>(null)

  const live = playbackLabels(elapsed, duration)
  const percent = preview ?? live.percent
  const shown =
    preview === null ? live : playbackLabels(percentToSeconds(preview, duration), duration)
  const buffered = bufferedPercent(live.percent, measuredFraction)

  return (
    <div dir="ltr" className="flex w-full items-center gap-2">
      <span className="w-10 shrink-0 text-xs tabular-nums text-text-muted">{shown.elapsed}</span>
      <SliderPrimitive.Root
        className="relative flex h-4 w-full grow touch-none select-none items-center"
        value={[percent]}
        max={100}
        step={0.1}
        disabled={duration === 0}
        onValueChange={(v) => setPreview(v[0]!)}
        onValueCommit={(v) => {
          setPreview(null)
          onSeek(percentToSeconds(v[0]!, duration))
        }}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-alpha-2">
          <div className="absolute inset-y-0 left-0 bg-alpha-4" style={{ width: `${buffered}%` }} />
          <SliderPrimitive.Range className="absolute inset-y-0 bg-fill-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label="章内进度"
          aria-valuetext={`${shown.elapsed} / ${formatClock(duration)}`}
          className="block size-3.5 rounded-full border border-border-300 bg-surface-0 shadow-sm outline-none focus-visible:shadow-focus"
        />
      </SliderPrimitive.Root>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-text-muted">
        {shown.remaining}
      </span>
    </div>
  )
}

/** 进二级视图的入口块：上行是当前值（倍速数字 / 音色图标），下行是名字。 */
function EntryCard({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="btn-squish can-focus flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg bg-fill-control transition-colors hover:bg-fill-control-hover"
    >
      {children}
      <span className="max-w-full truncate px-2 text-xs text-text-muted">{label}</span>
    </button>
  )
}

/** 音色列表：按口音分组，选中项打勾。 */
function VoiceList({
  selected,
  onSelect,
}: {
  selected: string
  onSelect: (voiceId: string) => void
}): React.JSX.Element {
  return (
    <ScrollArea className="max-h-80 w-full pt-1">
      {VOICE_GROUPS.map((group) => (
        <div key={group.locale} className="pb-1">
          <div className="px-2 py-1 text-xs text-text-muted">
            {group.label} · {group.voices.length} 个
          </div>
          {group.voices.map((voice) => (
            <button
              key={voice.id}
              type="button"
              onClick={() => onSelect(voice.id)}
              className="can-focus flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-alpha-1"
            >
              <span className="flex size-5 shrink-0 items-center justify-center">
                {selected === voice.id && <Check className="size-4 text-text-000" />}
              </span>
              <span className="truncate text-sm text-text-100">{voice.label}</span>
            </button>
          ))}
        </div>
      ))}
    </ScrollArea>
  )
}
