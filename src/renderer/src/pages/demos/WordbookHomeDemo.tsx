import {
  BookCopy,
  Brain,
  CalendarCheck,
  GraduationCap,
  History,
  Library,
  NotebookPen,
  Play,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, Card } from '@/components/ui'
import { BookCover } from '@/components/common/BookCover'
import { TodayStat } from '@/pages/word-book/components/TodayStat'
import { FeatureCard } from '@/pages/word-book/components/FeatureCard'

/**
 * 单词本首页 —— 全局词状态（墨墨式）改版候选。
 *
 * 与现有 /wordbook 首页的差异（体现「学习状态按词全局一份、与词书解耦」这一核心模型转向）：
 * 1. 新增「我的记忆库」作为首页主角：跨全部词书的全局存量，按全局状态分三段（已掌握 / 记忆中 / 待复习）。
 *    旧首页以「在学书学了多少」为中心，新版把重心挪到「我总共记住多少」，词书降级为新词来源。
 * 2. 在学书卡补一条诚实细节：书内已学词中含 N 个「在别处已学过」的重叠词——换书不重学的直观体现。
 * 3. 今日卡「等待复习」= 全局到期数（不限书），与记忆库总览的「待复习」同源。
 *
 * 全为占位 mock。交互 onClick 均为 no-op（展厅只看 UI 效果，不导航跳出 demo）。
 */

/** 全局记忆库三段（跨全部词书，每个词只有一份状态）。总量 = 三段之和。 */
const MEMORY = { mastered: 742, learning: 434, due: 32 }

/** 分布条 / 图例的段定义：稳定的排前（绿 → 蓝 → 黄）。色走语义 fill，未占满部分留 bg-neutral 灰底。 */
const SEGMENTS = [
  { key: 'mastered', label: '已掌握', value: MEMORY.mastered, color: 'bg-fill-success' },
  { key: 'learning', label: '记忆中', value: MEMORY.learning, color: 'bg-fill-accent' },
  { key: 'due', label: '待复习', value: MEMORY.due, color: 'bg-fill-warning' },
] as const

/** 在学书（占位）：只提供新词来源。learned = 书内已有全局状态的词；overlap = 其中在别处已学过的重叠词。 */
const ACTIVE_BOOK = {
  title: '四级核心词汇',
  description: '大学英语四级 · 高频核心词',
  learned: 124,
  total: 538,
  overlap: 46,
}

const noop = (): void => {}

export function WordbookHomeDemo(): React.JSX.Element {
  const memTotal = MEMORY.mastered + MEMORY.learning + MEMORY.due
  const percent = Math.round((ACTIVE_BOOK.learned / ACTIVE_BOOK.total) * 100)

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-10 lg:px-10">
      {/* 我的记忆库 —— 全局存量总览，首页主角 */}
      <section className="mb-8">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold text-text-primary">我的记忆库</h2>
          <span className="hidden text-xs text-text-muted sm:inline">跨全部词书 · 一个词只有一份记忆状态</span>
        </div>

        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-semibold leading-none tabular-nums text-text-primary">
                  {memTotal.toLocaleString()}
                </span>
                <span className="text-sm text-text-secondary">个词在记忆库中</span>
              </div>
              <p className="mt-2.5 text-sm text-text-secondary">标熟一次全局生效；换在学书不重学重叠词，复习不因切书断档。</p>
            </div>
            <span className="hidden size-12 shrink-0 place-items-center rounded-card bg-bg-neutral text-text-secondary sm:grid">
              <Brain className="size-6" />
            </span>
          </div>

          {/* 全局状态分布条 */}
          <div className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-bg-neutral">
            {SEGMENTS.map((s) => (
              <div key={s.key} className={cn('h-full', s.color)} style={{ width: `${(s.value / memTotal) * 100}%` }} />
            ))}
          </div>

          {/* 图例 */}
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
      </section>

      {/* 继续学习 —— 在学书（新词来源） + 今日队列 */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">继续学习</h2>
          <Button variant="secondary" className="gap-1.5" onClick={noop}>
            <BookCopy />
            更换词书
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* 在学书 + 进度 */}
          <Card className="flex flex-col gap-6 p-6 lg:col-span-2">
            <div className="flex items-center gap-5">
              <BookCover title={ACTIVE_BOOK.title} />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-2xl font-medium leading-tight text-text-primary">{ACTIVE_BOOK.title}</h3>
                <p className="mt-1.5 truncate text-sm text-text-secondary">{ACTIVE_BOOK.description}</p>
                <span className="mt-2.5 inline-flex items-center rounded-full bg-bg-neutral px-2.5 py-1 text-xs font-medium text-text-secondary">
                  新词来源
                </span>
              </div>
            </div>

            {/* 进度：黑填充；下方补全局模型的诚实细节 */}
            <div className="mt-auto space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-text-secondary">学习进度</span>
                <span className="text-sm font-medium text-text-primary">{percent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-bg-neutral">
                <div className="h-full rounded-full bg-fill-primary transition-all" style={{ width: `${percent}%` }} />
              </div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-text-primary">
                  已学 <span className="text-base font-medium">{ACTIVE_BOOK.learned}</span>
                </span>
                <span className="text-text-secondary">共 {ACTIVE_BOOK.total.toLocaleString()} 词</span>
              </div>
              <p className="pt-0.5 text-xs text-text-muted">
                其中 {ACTIVE_BOOK.overlap} 词已在别处学过，直接记作已学 —— 换书不重学。
              </p>
            </div>
          </Card>

          {/* 今日队列 + 唯一 clay CTA */}
          <Card className="flex flex-col gap-4 p-6">
            <h3 className="text-[15px] font-semibold text-text-primary">今日</h3>
            <div className="space-y-1">
              <TodayStat icon={GraduationCap} value={18} label="今日已学" onClick={noop} />
              <TodayStat icon={History} value={MEMORY.due} label="等待复习" onClick={noop} />
            </div>
            <Button variant="brand" size="lg" className="mt-auto w-full justify-center gap-2" onClick={noop}>
              <Play />
              开始学习
            </Button>
          </Card>
        </div>
      </section>

      {/* 常用功能 */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-text-primary">常用功能</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),300px))] gap-3">
          <FeatureCard icon={Library} title="在学词书" onClick={noop} />
          <FeatureCard icon={CalendarCheck} title="今日学习" onClick={noop} />
          <FeatureCard icon={NotebookPen} title="我的笔记" onClick={noop} />
        </div>
      </section>
    </div>
  )
}
