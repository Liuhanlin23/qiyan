import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui'
import type { ExtraCounts, ExtraKind } from '@/wordbook'
import type { ExtraGroupSizes } from '@/wordbook'

/**
 * 学习完成页 —— 「今日学习计划已完成」+ 再学一组（继续学习 / 继续复习 / 提前复习 + 组大小步进器）。
 * 三选项对应 extraGroup 的三 kind（learn/review/ahead）；available 来自 extraCounts（真实可用数），
 * 组大小读写 meta extra_group_sizes（步进器改动即持久化）。选中并开始 → 页面 extraGroup 追加进会话。
 */

const OPTIONS: {
  kind: ExtraKind
  title: string
  subtitle: string
  unit: string
  verb: string
}[] = [
  { kind: 'learn', title: '继续学习', subtitle: '今日新词上限外，按加入序继续取', unit: '可学', verb: '学习' },
  { kind: 'review', title: '继续复习', subtitle: '已到期但今日额度外未复习的卡', unit: '到期', verb: '复习' },
  { kind: 'ahead', title: '提前复习', subtitle: '未到期、最先到期的几张提前刷', unit: '可提前', verb: '提前刷' },
]

/** 组大小步进器上界（一个偏好值的合理上限，与今日可用数解耦；实际追加数受 available 截断）。 */
const MAX_GROUP_SIZE = 50

export function FinishedView({
  counts,
  sizes,
  onSizeChange,
  onStart,
}: {
  counts: ExtraCounts
  sizes: ExtraGroupSizes
  onSizeChange: (kind: ExtraKind, size: number) => void
  onStart: (kind: ExtraKind, size: number) => void
}): React.JSX.Element {
  const [selected, setSelected] = useState<ExtraKind | null>(null)

  const option = OPTIONS.find((o) => o.kind === selected) ?? null
  const available = option ? counts[option.kind] : 0
  const size = option ? sizes[option.kind] : 0
  const effective = Math.min(size, available) // 实际追加数（受可用截断）
  const canStart = option != null && effective > 0

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-6 py-10">
      <h1 className="mb-8 text-center text-2xl font-bold text-text-primary">今日学习计划已完成</h1>

      <div className="flex flex-col gap-2.5">
        {OPTIONS.map((o) => {
          const isSelected = o.kind === selected
          const avail = counts[o.kind]
          const disabled = avail <= 0
          return (
            <button
              key={o.kind}
              type="button"
              disabled={disabled}
              onClick={() => setSelected(o.kind)}
              className={cn(
                'btn-squish flex flex-col gap-2 rounded-card border bg-surface-1 px-4 py-3.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-50',
                isSelected ? 'border-border-accent' : 'border-border-300'
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'grid size-[18px] shrink-0 place-items-center rounded-full border-2',
                    isSelected ? 'border-border-accent' : 'border-border-400'
                  )}
                >
                  {isSelected && <span className="size-2 rounded-full bg-fill-accent" />}
                </span>
                <span className="text-base font-semibold text-text-primary">{o.title}</span>
                <div className="ml-auto" onClick={(e) => e.stopPropagation()}>
                  {isSelected ? (
                    <BatchStepper
                      value={sizes[o.kind]}
                      onChange={(v) => onSizeChange(o.kind, v)}
                    />
                  ) : (
                    <span className="text-sm text-text-muted">
                      {avail} {o.unit}
                    </span>
                  )}
                </div>
              </div>
              {isSelected && (
                <div className="flex items-center justify-between pl-[30px] text-sm text-text-muted">
                  <span>{o.subtitle}</span>
                  <span>
                    {o.unit} {avail} 张
                  </span>
                </div>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-auto pt-8">
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!canStart}
          onClick={() => option && onStart(option.kind, size)}
        >
          {option && canStart ? `开始${option.verb} · ${effective} 张` : '请选择上方选项'}
        </Button>
      </div>
    </div>
  )
}

function BatchStepper({ value, onChange }: { value: number; onChange: (v: number) => void }): React.JSX.Element {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border-300 p-0.5">
      <Button variant="ghost" size="iconXs" aria-label="减少" disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))}>
        <Minus className="size-3.5" />
      </Button>
      <span className="w-8 text-center text-sm font-semibold tabular-nums text-text-primary">{value}</span>
      <Button variant="ghost" size="iconXs" aria-label="增加" disabled={value >= MAX_GROUP_SIZE} onClick={() => onChange(Math.min(MAX_GROUP_SIZE, value + 1))}>
        <Plus className="size-3.5" />
      </Button>
    </div>
  )
}
