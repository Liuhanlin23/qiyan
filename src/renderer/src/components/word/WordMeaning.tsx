import { cn } from '@/lib/cn'
import type { CollinsEntry, MeaningSource, Word } from '@/types/word'
import { Highlighted } from '@/components/word/Highlighted'

/**
 * 词卡释义块 —— 按释义来源渲染「中文（简明）」或「中英（柯林斯，含例句）」。
 * 完整词卡主体（`WordDetailBody`）与阅读精简卡（`DictPopup`）共用同一份实现，两处释义形态一致。
 *
 * 两档字号：`base` 整页词卡（默认），`compact` 给贴选区的阅读精简卡——380px 浮层放整页字号过大。
 *
 * 来源受控、由使用方托管；该词无柯林斯时**就地回落简明**——切换控件那侧虽已置灰，但设置里的
 * 默认来源可能是柯林斯（docs/feature/wordcard.md），回落免得这类词开卡即空。
 */

/** 释义字号档：正文（释义条 / 柯林斯释义）、词性标签、例句，三处成套调。 */
const SIZES = {
  base: { sense: 'text-base', pos: 'text-sm', example: 'text-sm' },
  compact: { sense: 'text-sm', pos: 'text-xs', example: 'text-xs' },
} as const

type SizeSet = (typeof SIZES)[keyof typeof SIZES]

export function WordMeaning({
  entry,
  source,
  simpleLimit,
  size = 'base',
}: {
  entry: Word
  source: MeaningSource
  /**
   * 中文释义的条数上限（additive，默认不限即既有行为）。精简卡取「扫一眼就懂」的前几条，
   * 看全走完整词条（docs/feature/reading/lookup.md §浮层一）。
   */
  simpleLimit?: number
  /** 字号档（additive，默认 'base' 即既有行为）：整页词卡 / 浮层精简卡。 */
  size?: keyof typeof SIZES
}): React.JSX.Element {
  const sizes = SIZES[size]
  const effectiveSource: MeaningSource =
    source === 'collins' && entry.collinsEntries.length > 0 ? 'collins' : 'simple'
  if (effectiveSource === 'collins') return <CollinsMeaning entries={entry.collinsEntries} sizes={sizes} />
  const senses = simpleLimit == null ? entry.simpleSenses : entry.simpleSenses.slice(0, simpleLimit)
  return <SimpleMeaning senses={senses} sizes={sizes} />
}

function SimpleMeaning({ senses, sizes }: { senses: string[]; sizes: SizeSet }): React.JSX.Element {
  if (senses.length === 0) return <p className={cn(sizes.sense, 'text-text-muted')}>暂无中文释义</p>
  return (
    <div className="flex flex-col gap-2">
      {senses.map((s, i) => (
        <p key={i} className={cn(sizes.sense, 'text-text-primary')}>
          {s}
        </p>
      ))}
    </div>
  )
}

function CollinsMeaning({ entries, sizes }: { entries: CollinsEntry[]; sizes: SizeSet }): React.JSX.Element {
  if (entries.length === 0) return <p className={cn(sizes.sense, 'text-text-muted')}>暂无中英释义</p>
  return (
    <div className="flex flex-col gap-3.5">
      {entries.map((e, i) => (
        <div key={i} className="flex flex-col gap-2">
          <p className={cn(sizes.sense, 'text-text-primary')}>
            {e.pos && <span className={cn('mr-1.5 font-serif italic text-text-muted', sizes.pos)}>{e.pos}</span>}
            <Highlighted text={e.tran} />
          </p>
          {e.examples.map((ex, j) => (
            <div key={j} className={cn('flex gap-2 pl-1 text-text-secondary', sizes.example)}>
              <span className="text-text-muted">•</span>
              <div className="flex flex-col gap-0.5">
                <Highlighted text={ex.en} />
                {ex.zh && <span>{ex.zh}</span>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
