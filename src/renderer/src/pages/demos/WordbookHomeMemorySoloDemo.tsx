import { BookCopy, NotebookPen, Play, Layers } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, Card } from '@/components/ui'
import { BookCover } from '@/components/common/BookCover'
import { FeatureCard } from '@/pages/word-book/components/FeatureCard'

/**
 * 单词本首页 · 去词书隔离改版【版本 2：记忆库单卡（行动内嵌）】
 *
 * 与版本 1 同一转向（词书不再是带进度的主角，全局记忆库是唯一进度），但更聚拢：把「存量总览 + 今日行动」
 * 合成**一张满宽记忆库大卡**——顶部大数字 + 分布条 + 图例，底部一条分隔线下内嵌行动条（待复习 / 今日新学 / 开始学习）。
 * 词书同样降为底部一条 source 龙头行（无进度条）。整页只有"记忆库 + 龙头 + 功能"三块，最干净。
 *
 * 全为占位 mock，onClick 均 no-op。
 */

const MEMORY = { mastered: 742, learning: 434, due: 32 }
const SEGMENTS = [
  { key: 'mastered', label: '已掌握', value: MEMORY.mastered, color: 'bg-fill-success' },
  { key: 'learning', label: '记忆中', value: MEMORY.learning, color: 'bg-fill-accent' },
  { key: 'due', label: '待复习', value: MEMORY.due, color: 'bg-fill-warning' },
] as const

const SOURCE = { title: '四级核心词汇', remaining: 414 }
const TODAY = { newDone: 18, due: MEMORY.due }
const noop = (): void => {}

export function WordbookHomeMemorySoloDemo(): React.JSX.Element {
  const memTotal = MEMORY.mastered + MEMORY.learning + MEMORY.due

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-10 lg:px-10">
      {/* 记忆库大卡：存量 + 内嵌今日行动 */}
      <Card className="mb-4 p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-[42px] font-semibold leading-none tabular-nums text-text-primary">
                {memTotal.toLocaleString()}
              </span>
              <span className="text-sm text-text-secondary">词已记住</span>
            </div>
            <p className="mt-2.5 text-sm text-text-secondary">标熟一次全局生效；换词书不重学重叠词，复习不因切书断档。</p>
          </div>
        </div>

        <div className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-bg-neutral">
          {SEGMENTS.map((s) => (
            <div key={s.key} className={cn('h-full', s.color)} style={{ width: `${(s.value / memTotal) * 100}%` }} />
          ))}
        </div>
        <div className="mt-3.5 flex flex-wrap gap-x-7 gap-y-2">
          {SEGMENTS.map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className={cn('size-2 rounded-full', s.color)} />
              <span className="text-sm text-text-secondary">{s.label}</span>
              <span className="text-sm font-medium tabular-nums text-text-primary">{s.value}</span>
            </div>
          ))}
        </div>

        {/* 内嵌行动条 */}
        <div className="mt-6 flex flex-col gap-4 border-t border-border-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-8">
            <button type="button" onClick={noop} className="btn-squish text-left">
              <div className="text-2xl font-medium leading-none tabular-nums text-text-primary">{TODAY.due}</div>
              <div className="mt-1.5 text-xs text-text-secondary">等待复习</div>
            </button>
            <button type="button" onClick={noop} className="btn-squish text-left">
              <div className="text-2xl font-medium leading-none tabular-nums text-text-primary">{TODAY.newDone}</div>
              <div className="mt-1.5 text-xs text-text-secondary">今日新学</div>
            </button>
          </div>
          <Button variant="brand" size="lg" className="justify-center gap-2 sm:w-44" onClick={noop}>
            <Play />
            开始学习
          </Button>
        </div>
      </Card>

      {/* 新词来源龙头 —— 无进度条 */}
      <Card className="mb-8 flex items-center gap-4 px-5 py-4">
        <BookCover title={SOURCE.title} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-text-muted">新词来源</div>
          <div className="mt-0.5 truncate text-sm text-text-primary">
            <span className="font-medium">{SOURCE.title}</span>
            <span className="text-text-secondary"> · 还有 {SOURCE.remaining} 词可学</span>
          </div>
        </div>
        <Button variant="secondary" className="gap-1.5" onClick={noop}>
          <BookCopy />
          更换词书
        </Button>
      </Card>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-text-primary">常用功能</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),300px))] gap-3">
          <FeatureCard icon={Layers} title="我的单词" onClick={noop} />
          <FeatureCard icon={NotebookPen} title="我的笔记" onClick={noop} />
        </div>
      </section>
    </div>
  )
}
