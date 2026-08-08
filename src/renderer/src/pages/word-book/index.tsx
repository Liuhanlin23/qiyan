import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart3,
  BookPlus,
  ClipboardCheck,
  FileDown,
  GraduationCap,
  History,
  Layers,
  ListChecks,
  type LucideIcon,
  NotebookPen,
  Play,
} from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { TopBar } from '@/components/layout/TopBar'
import { TodayStat } from './components/TodayStat'
import { FeatureCard } from './components/FeatureCard'
import { useAsyncData } from '@/hooks/useAsyncData'
import * as wordbook from '@/wordbook'

/**
 * 单词本首页（对应 iOS WordBookHomeView，但**不复刻**其布局）：桌面「仪表盘」式横向布局
 * ——左右双卡 Hero（全局词库 + 进度 / 今日队列 + CTA）顶一行常用功能网格。
 *
 * 接 @/wordbook 门面：词库卡走 segmentCounts（总数 + 已学=总−未学）；今日卡走 todayCounts
 * （今日已学 = 今日新学 + 今日复习；等待复习 = 全局到期总数，不受每日上限约束）。
 * 进入单词本一级入口即触发词库增量（每天首次，meta dict_refresh_day 判定）。
 */

/** 常用功能格：我的单词 / 选词 / 我的笔记三个常驻入口 + 词汇测试 / 数据统计 / 导出 PDF 三个占位（v1 无功能）。 */
const FEATURES: { title: string; icon: LucideIcon; path?: string; disabled?: boolean }[] = [
  { title: '我的单词', icon: ListChecks, path: '/wordbook/words' },
  { title: '我的笔记', icon: NotebookPen, path: '/wordbook/notes' },
  { title: '词汇测试', icon: ClipboardCheck, disabled: true },
]

export default function WordBook(): React.JSX.Element {
  const navigate = useNavigate()

  // 进入单词本一级入口：触发词库增量（每天首次，meta dict_refresh_day 判定；后台单飞，失败静默）。
  useEffect(() => {
    void wordbook.refreshDictUpdatesForToday()
  }, [])

  const home = useAsyncData(() => Promise.all([wordbook.todayCounts(), wordbook.segmentCounts()]), [])
  const [today, seg] = home.data ?? [null, null]

  const total = seg ? seg.new + seg.due + seg.memorizing + seg.mastered : 0
  const learned = seg ? total - seg.new : 0 // 已学 = 离开未学态的词（待复习 + 记忆中 + 已标熟）
  const percent = total > 0 ? Math.round((learned / total) * 100) : 0
  const hasLibrary = !!seg && total > 0
  const newToday = today ? today.newDone + today.reviewDone : 0
  const dueReview = today ? today.dueTotal : 0

  return (
    <>
      <TopBar segments={['单词本']} />
      <div className="mx-auto w-full max-w-5xl px-8 pb-12 pt-[12vh] lg:px-10">
        {/* 正在学习 */}
        <section className="mb-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary">正在学习</h2>
            <Button variant="secondary" size="default" className="gap-1.5" onClick={() => navigate('/wordbook/books')}>
              <BookPlus />
              选词
            </Button>
          </div>

          {!home.data ? (
            <Card className="flex items-center justify-center py-16 text-sm text-text-muted">加载中…</Card>
          ) : hasLibrary ? (
            <div className="grid gap-4 lg:grid-cols-3">
              {/* 左：全局词库 + 进度 */}
              <Card className="flex flex-col gap-6 p-6 lg:col-span-2">
                <div className="flex items-center gap-5">
                  <span className="grid size-16 shrink-0 place-items-center rounded-card bg-bg-neutral text-text-primary">
                    <Layers className="size-8" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-2xl font-medium leading-tight text-text-primary">我的词库</h3>
                    <p className="mt-1.5 truncate text-sm text-text-secondary">学过的词全局共享，标熟一次处处生效</p>
                  </div>
                </div>

                {/* 进度条钉卡底、横贯整卡；进度用黑填充(fill-primary)，clay 留给 CTA。 */}
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
                      已学 <span className="text-base font-medium">{learned}</span>
                    </span>
                    <span className="text-text-secondary">共 {total.toLocaleString()} 词</span>
                  </div>
                </div>
              </Card>

              {/* 右：今日队列 + 唯一 clay CTA。 */}
              <Card className="flex flex-col gap-4 p-6">
                <h3 className="text-[15px] font-semibold text-text-primary">今日</h3>
                <div className="space-y-1">
                  <TodayStat
                    icon={GraduationCap}
                    value={newToday}
                    label="今日已学"
                    onClick={() => navigate('/wordbook/today')}
                  />
                  <TodayStat
                    icon={History}
                    value={dueReview}
                    label="等待复习"
                    onClick={() => navigate('/wordbook/words?seg=due')}
                  />
                </div>
                <Button
                  variant="brand"
                  size="lg"
                  className="mt-auto w-full justify-center gap-2"
                  onClick={() => navigate('/wordbook/study')}
                >
                  <Play />
                  开始学习
                </Button>
              </Card>
            </div>
          ) : (
            /* 空态：词库为空，引导去选词建立词库。 */
            <Card className="flex flex-col items-center gap-3 py-14 text-center">
              <div className="space-y-1">
                <h3 className="text-xl font-medium text-text-primary">词库还是空的</h3>
              </div>
            </Card>
          )}
        </section>

        {/* 常用功能 */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-text-primary">常用功能</h2>
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,300px),300px))]">
            {FEATURES.map((f) => (
              <FeatureCard
                key={f.title}
                icon={f.icon}
                title={f.title}
                disabled={f.disabled}
                onClick={f.path ? () => navigate(f.path!) : undefined}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
