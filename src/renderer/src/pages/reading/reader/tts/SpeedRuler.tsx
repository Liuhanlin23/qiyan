/**
 * 倍速刻度尺 —— 完整播放器「倍速」子视图里那把梳齿尺，取自 readest 的 `TickRuler` + `SpeedRuler`。
 *
 * 相对上游的改动：
 *   - 上游 `TickRuler` 是通用件（倍速 / 句间隙 / 段间隙三处共用）；本项目按 tts.md 不做间隙调节，
 *     只剩倍速一个用户，故合并成这一个组件，不留通用参数。
 *   - 驱动从「透明覆盖的原生 range」换成 radix Slider（与项目内另两条进度条同源）：拖 / 点 / 键盘一样白拿，
 *     且 `onValueCommit` 是原生语义，省掉上游为合并连按而设的 500ms 定时器。
 *   - 当前值那根高亮刻度**就是 Slider 的 thumb 本身** —— 它天然跟着值走，还自带焦点环；
 *     ticks 只画淡刻度，不再单独算「哪根是 active」。
 *   - 颜色换 CDS token（上游的 `base-content` 系在本项目不存在）。
 *
 * 拖动中只改本地预览值，松手才回调：换速这件事在会话核心里是一次真动作（写设备记忆 + 改播出速率），
 * 不该跟着手指连发。
 */
import { useMemo, useState } from 'react'
import { Slider as SliderPrimitive } from 'radix-ui'
import { cn } from '@/lib/cn'
import { formatRate, RATE_MAX, RATE_MIN, RATE_STEP } from './playback'

/** 带淡标签与长刻度的档位（两端跟着倍速区间走，中间几档是取整挑的）。 */
const RATE_MARKS = [RATE_MIN, 1, 1.5, 2, 2.5, RATE_MAX]

export function SpeedRuler({
  rate,
  onSelect,
}: {
  rate: number
  onSelect: (rate: number) => void
}): React.JSX.Element {
  // 拖动中的预览值：标签跟着手走，但松手才真的换速。
  const [preview, setPreview] = useState<number | null>(null)
  const current = preview ?? rate

  const ticks = useMemo(
    () =>
      Array.from(
        { length: Math.round((RATE_MAX - RATE_MIN) / RATE_STEP) + 1 },
        // 逐格累加会攒浮点误差（0.5 + 0.05 × 17 ≠ 1.35），量化到两位小数后 key 才稳定。
        (_, i) => Math.round((RATE_MIN + i * RATE_STEP) * 100) / 100,
      ),
    [],
  )

  const toPercent = (value: number): number => ((value - RATE_MIN) / (RATE_MAX - RATE_MIN)) * 100
  // 档位标签会被当前值标签压住：离得太近就把档位藏掉。比的是**步数**而不是数值差，
  // 否则浮点误差（2.0 - 1.8 = 0.1999…）会让档位早一步消失。
  const hideSteps = Math.round(((RATE_MAX - RATE_MIN) * 0.08) / RATE_STEP)
  const isMark = (tick: number): boolean =>
    RATE_MARKS.some((mark) => Math.round(mark * 100) === Math.round(tick * 100))

  return (
    <div dir="ltr" className="w-full px-3 pt-1 pb-2">
      <div className="relative h-5">
        {RATE_MARKS.map((mark) => (
          <span
            key={mark}
            className={cn(
              'absolute top-0 -translate-x-1/2 text-xs tabular-nums text-text-muted',
              Math.round(Math.abs(mark - current) / RATE_STEP) < hideSteps && 'invisible',
            )}
            style={{ left: `${toPercent(mark)}%` }}
          >
            {mark.toFixed(1)}
          </span>
        ))}
        <span
          className="absolute top-0 -translate-x-1/2 text-xs font-semibold tabular-nums text-text-000"
          style={{ left: `${toPercent(current)}%` }}
        >
          {formatRate(current)}
        </span>
      </div>

      <SliderPrimitive.Root
        className="relative flex h-7 w-full touch-none select-none items-center"
        value={[current]}
        min={RATE_MIN}
        max={RATE_MAX}
        step={RATE_STEP}
        onValueChange={(v) => setPreview(v[0]!)}
        onValueCommit={(v) => {
          setPreview(null)
          onSelect(v[0]!)
        }}
      >
        {/* 轨道不画线：这把尺子的「轨道」就是这排刻度，Track 只负责给刻度定位并接住点击。 */}
        <SliderPrimitive.Track className="relative h-7 w-full grow">
          {ticks.map((tick) => (
            <span
              key={tick}
              aria-hidden
              className={cn(
                'pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                isMark(tick) ? 'h-5 w-0.5 bg-alpha-4' : 'h-3.5 w-px bg-alpha-2',
              )}
              style={{ left: `${toPercent(tick)}%` }}
            />
          ))}
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label="倍速"
          aria-valuetext={formatRate(current)}
          className="block h-7 w-0.5 rounded-full bg-fill-primary outline-none focus-visible:shadow-focus"
        />
      </SliderPrimitive.Root>
    </div>
  )
}
