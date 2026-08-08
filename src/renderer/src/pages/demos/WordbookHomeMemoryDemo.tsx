import { BookCopy, GraduationCap, History, NotebookPen, Play, Layers } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, Card } from '@/components/ui'
import { BookCover } from '@/components/common/BookCover'
import { TodayStat } from '@/pages/word-book/components/TodayStat'
import { FeatureCard } from '@/pages/word-book/components/FeatureCard'

/**
 * 单词本首页 · 去词书隔离改版【版本 1：记忆库 + 今日 双联 Hero】
 *
 * 核心转向：**词书不再是带进度的主角**。旧首页的「在学书 + 学习进度 已学/共」卡是词书隔离的产物
 * （表达"这本书学到哪了"），这里整张删掉——进度的唯一载体变成**全局记忆库**（跨全部词书、每词一份状态）。
 * 词书降为一个「出新词的龙头」：底部一条纤细 source 行，只说"新词来自哪本、还剩多少可学 + 更换"，无进度条。
 *
 * 首屏双联：左=记忆库存量（真正的进度），右=今日计划 + 开始学习。全为占位 mock，onClick 均 no-op。
 */

const MEMORY = { mastered: 742, learning: 434, due: 32 }
const SEGMENTS = [
  { key: 'mastered', label: '已掌握', value: MEMORY.mastered, color: 'bg-fill-success' },
  { key: 'learning', label: '记忆中', value: MEMORY.learning, color: 'bg-fill-accent' },
  { key: 'due', label: '待复习', value: MEMORY.due, color: 'bg-fill-warning' },
] as const

/** 词书 = 新词龙头：只关心"还有多少词可学"，不再有 已学/共 的进度容器语义。 */
const SOURCE = { title: '四级核心词汇', remaining: 414 }
const TODAY = { newDone: 18, due: MEMORY.due }
const noop = (): void => {}

export function WordbookHomeMemoryDemo(): React.JSX.Element {
  const memTotal = MEMORY.mastered + MEMORY.learning + MEMORY.due

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-10 lg:px-10">
      {/* 首屏双联：记忆库存量 + 今日计划 */}
      <div className="mb-4 grid gap-4 lg:grid-cols-5">
        {/* 记忆库 —— 唯一的进度载体 */}
        <Card className="flex flex-col p-6 lg:col-span-3">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold leading-none tabular-nums text-text-primary">
              {memTotal.toLocaleString()}
            </span>
            <span className="text-sm text-text-secondary">词已记住</span>
          </div>
          <p className="mt-2.5 text-sm text-text-secondary">标熟一次全局生效；换词书不重学重叠词，复习不因切书断档。</p>

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
        </Card>

        {/* 今日计划 + CTA */}
        <Card className="flex flex-col gap-4 p-6 lg:col-span-2">
          <h3 className="text-[15px] font-semibold text-text-primary">今日计划</h3>
          <div className="space-y-1">
            <TodayStat icon={History} value={TODAY.due} label="等待复习" onClick={noop} />
            <TodayStat icon={GraduationCap} value={TODAY.newDone} label="今日新学" onClick={noop} />
          </div>
          <Button variant="brand" size="lg" className="mt-auto w-full justify-center gap-2" onClick={noop}>
            <Play />
            开始学习
          </Button>
        </Card>
      </div>

      {/* 新词来源龙头 —— 无进度条，只有来源 + 余量 + 更换 */}
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

      {/* 常用功能 —— "我的单词"是全局词表（跨全部词书），不再是"某本书的词" */}
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
