/**
 * 朗读播放器 · 迷你条 —— 朗读会话进行中常驻正文底部的一条，版式复刻 readest 的 `TTSMiniPlayer`（full 样式）。
 *
 * 照搬 readest 的版式要点：
 *   - 定高一行（h-14），封面 / 书名 / 章节 / 传输键全塞进这一行，不给进度条留行。
 *   - 进度贴外壳底边，**三层**：轨道 + 已合成未播的缓冲段 + 已播段。
 *   - 封面 + 文字整块是「展开完整播放器」的按钮，传输键单独成簇。
 *   - 图标尺寸按**墨迹**对齐而非画布：Material 的 `play_circle_filled` 40px 画布里圆只有 ⌀33、三角约 13，
 *     `skip_previous` 28px 画布里墨迹只有 14 —— 照画布数字给 lucide 会整体大一圈。
 *
 * 相对 readest 的改动：
 *   - **外壳收成胶囊**（`rounded-full`）**、封面收成圆**：readest 是圆角矩形卡片配方封面。
 *     换形之后有两处连带改动，见下面两条——胶囊没有直边，也没有可长高的余地。
 *   - **进度改成沿下缘的描边弧**（详见 `ProgressArc`）：贴底直线会被两端的大圆角斜切掉一截。
 *   - **进度条改主动**（Apple Books 的做法）：可直接拖动定位，readest 那条是被动读数、seek 只在展开面板里。
 *     指到或拖动时**副行的章节名让位给已播 / 剩余读数**——上一版是让整条长高、在上方展开读数，
 *     胶囊长高会连圆角半径一起变、整颗「胀」一下，故改为原地换字。
 *   - **多一个句复读键**：当前句循环重听，英语学习场景的刚需，readest 没有。
 *   - 颜色全换 CDS token：外壳走 CDS 浮层规格（`bg-surface-popover` + 发丝描边 + `shadow-popover`），
 *     而非 readest 的 `bg-base-300` 灰实底；进度三层用同色不同透明度（`alpha-2` 轨道 / `alpha-4` 缓冲 /
 *     `fill-primary` 已播），已播色由 readest 的主题蓝换成近黑——CDS 里 accent 蓝是链接 / 选中语义。
 *   - 传输键补上桌面该有的 hover 底与按下回弹。
 *
 * 纯展示组件：播放状态与全部动作由外部传入，自身只持有进度的「拖动中预览值」与「指到没有」。
 */
import { useState } from 'react'
import { Slider as SliderPrimitive } from 'radix-ui'
import { Pause, Play, Repeat1, SkipBack, SkipForward, X } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { Cover } from './Cover'
import { bufferedPercent, percentToSeconds, playbackLabels } from './playback'

export interface TtsBarPlayerProps {
  book: string
  chapter: string
  playing: boolean
  /** 章内已播秒数。 */
  elapsed: number
  /** 章内总时长（秒）。 */
  duration: number
  /** 已合成比例 0–1，缓冲段画到这里；真引擎上报，demo 里伪造。 */
  measuredFraction: number
  /** 原生音色给不出时间轴：进度条整条收起，只剩章节名。 */
  hasTimeline: boolean
  /** 当前句循环复读中。 */
  repeating: boolean
  onTogglePlay: () => void
  onPrevSentence: () => void
  onNextSentence: () => void
  onToggleRepeat: () => void
  /** 拖动松手时才调：按句吸附跳转。 */
  onSeek: (seconds: number) => void
  onStop: () => void
  /** 点封面 / 标题区：展开完整播放器（倍速、音色都在那里）。 */
  onExpand: () => void
}

export function TtsBarPlayer({
  book,
  chapter,
  playing,
  elapsed,
  duration,
  measuredFraction,
  hasTimeline,
  repeating,
  onTogglePlay,
  onPrevSentence,
  onNextSentence,
  onToggleRepeat,
  onSeek,
  onStop,
  onExpand,
}: TtsBarPlayerProps): React.JSX.Element {
  // 拖动中的预览百分比。拖动期间读数跟着手走，但不真的跳转——松手才 seek（tts.md：预览不改写朗读锚点）。
  const [preview, setPreview] = useState<number | null>(null)
  const [railHover, setRailHover] = useState(false)

  const live = playbackLabels(elapsed, duration)
  const percent = preview ?? live.percent
  const shown = preview === null ? live : playbackLabels(percentToSeconds(preview, duration), duration)
  const buffered = bufferedPercent(live.percent, measuredFraction)
  // 指到进度弧上（或正在拖）就把副行让给时间读数：胶囊高度是定的，没有多长出一行的余地。
  const showTime = hasTimeline && (railHover || preview !== null)

  return (
    <div
      role="status"
      aria-label={`正在朗读：${book}`}
      // overflow-hidden 是版式的一部分：底部那条进度线靠它被圆角裁成两端收口。
      className="relative w-full max-w-md overflow-hidden rounded-full border border-border-300 bg-surface-popover shadow-popover"
    >
      <div className="flex h-14 items-center gap-1 px-3">
        <div
          role="button"
          tabIndex={0}
          onClick={onExpand}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onExpand()
          }}
          aria-label="打开完整播放器"
          // hover 块也是胶囊：p-1 让它的左圆弧与圆封面同心（半径 24 对 20），绕出一圈匀称的 4px。
          className="can-focus flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-full p-1 hover:bg-alpha-1"
        >
          <Cover book={book} className="size-10 rounded-full text-sm" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm text-text-000">{book}</span>
            {showTime ? (
              <span dir="ltr" className="truncate text-xs tabular-nums text-text-muted">
                {shown.elapsed} · {shown.remaining}
              </span>
            ) : (
              chapter && <span className="truncate text-xs text-text-muted">{chapter}</span>
            )}
          </div>
        </div>

        {/* 音频时间轴的惯例：传输键顺序不随书写方向翻转（本项目暂无 RTL，跟着 readest 一起先立着）。
            z-10 把这一行垫到进度弧的命中带上层：底部那 12px 命中带与传输键的圆底有一点重叠。 */}
        <div dir="ltr" className="relative z-10 flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            round
            onClick={onToggleRepeat}
            aria-label="复读当前句"
            aria-pressed={repeating}
            title={repeating ? '复读中，点击取消' : '复读当前句'}
            // 生效中用 chip 成对色标出来：这是个会一直挂着的模式，不是一次性动作。
            className={cn(
              repeating ? 'bg-bg-accent-chip text-text-accent hover:bg-bg-accent-chip' : 'text-text-100',
            )}
          >
            <Repeat1 className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            round
            onClick={onPrevSentence}
            aria-label="上一句"
            title="上一句"
            className="text-text-100"
          >
            <SkipBack className="size-6 fill-current" />
          </Button>
          {/* readest 用 Material 的 play_circle_filled（实心圆挖空三角）把播放键挑出来；
              lucide 没有实心版，用近黑圆底 + 反白符号还原，CDS 的 primary 本来就是这个近黑。 */}
          <Button
            variant="primary"
            size="icon"
            round
            onClick={onTogglePlay}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? (
              <Pause className="size-3.5 fill-current" />
            ) : (
              // 三角形视觉重心偏左，右移半格才在圆里居中。
              <Play className="size-3.5 translate-x-px fill-current" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            round
            onClick={onNextSentence}
            aria-label="下一句"
            title="下一句"
            className="text-text-100"
          >
            <SkipForward className="size-6 fill-current" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            round
            onClick={onStop}
            aria-label="结束朗读"
            title="结束朗读"
            className="text-text-100"
          >
            <X className="size-5" />
          </Button>
        </div>
      </div>

      {hasTimeline && (
        <ProgressArc
          percent={percent}
          buffered={buffered}
          disabled={duration === 0}
          onHoverChange={setRailHover}
          onPreview={setPreview}
          onCommit={(p) => {
            setPreview(null)
            onSeek(percentToSeconds(p, duration))
          }}
        />
      )}
    </div>
  )
}

/**
 * 章内进度 —— 沿胶囊下缘的一道描边弧，三层叠出「播到哪 / 合成到哪」。
 *
 * 胶囊没有直边可贴：一条贴底直线会被两端的大圆角斜切掉一大截，两端还留下脏兮兮的锐角。
 * 改画 `border-bottom` 之后，线自己跟着圆角走、在两端收尖，进度成了这颗胶囊的一部分，
 * 而不是贴上去的一条。三层同色不同透明度（轨道 / 缓冲 / 已播）——缓冲是「已播」的前哨，
 * 不是另一种状态，所以不另换色相。裁切用 clip-path 从右往左收，宽度自适应。
 *
 * 拖动靠一条压在下缘的透明 Slider；传输键那一行在它上层，不会被抢走点击。
 */
function ProgressArc({
  percent,
  buffered,
  disabled,
  onHoverChange,
  onPreview,
  onCommit,
}: {
  percent: number
  buffered: number
  disabled: boolean
  onHoverChange: (hovering: boolean) => void
  onPreview: (percent: number) => void
  onCommit: (percent: number) => void
}): React.JSX.Element {
  return (
    <>
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full border-0 border-b-[3px] border-b-alpha-2" />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full border-0 border-b-[3px] border-b-alpha-4"
        style={{ clipPath: `inset(0 ${100 - buffered}% 0 0)` }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full border-0 border-b-[3px] border-b-fill-primary"
        style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
      />
      <SliderPrimitive.Root
        // 只占下缘 12px：再高就吃进传输键的圆底，点播放会变成 seek。
        className="absolute inset-x-0 bottom-0 flex h-3 touch-none select-none items-end"
        value={[percent]}
        max={100}
        step={0.1}
        disabled={disabled}
        onValueChange={(v) => onPreview(v[0]!)}
        onValueCommit={(v) => onCommit(v[0]!)}
        onPointerEnter={() => onHoverChange(true)}
        onPointerLeave={() => onHoverChange(false)}
      >
        {/* 轨道不着色：视觉全交给上面那三道弧，这里只是命中区。 */}
        <SliderPrimitive.Track className="relative h-3 w-full grow" />
        {/* 不给可见滑块：弧本身就是进度（readest / Apple Books 都如此），只在键盘聚焦时现形。 */}
        <SliderPrimitive.Thumb
          aria-label="章内进度"
          className="block size-2 -translate-y-0.5 rounded-full bg-fill-primary opacity-0 outline-none focus-visible:opacity-100"
        />
      </SliderPrimitive.Root>
    </>
  )
}
