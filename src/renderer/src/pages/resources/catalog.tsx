import { useState } from 'react'
import {
  AlignLeft,
  AudioLines,
  ChevronRight,
  Clock,
  FileText,
  Search,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { Badge, Card, Input } from '@/components/ui'
import { PhoneticsContent } from './phonetic'

/**
 * 资源模块的共享目录与内容子视图（对应 iOS ResourcesView / PhoneticsView / PastPaperListView）。
 * 两个外壳 demo（逐级下钻 / 桌面双栏）都复用这里的 mock 数据与 CategoryContent，只是承载布局不同。
 * 全为 UI 阶段占位数据，接真实数据源时整体替换。
 */

// MARK: - L1 大类

/** 大类图标底色：按 iOS 的橙 / 蓝 / 绿三色区分，映射到 CDS 成对语义色。 */
type Tone = 'warning' | 'accent' | 'success'

const TONE_TILE: Record<Tone, string> = {
  warning: 'bg-bg-warning-chip text-text-warning',
  accent: 'bg-bg-accent-chip text-text-accent',
  success: 'bg-bg-success-chip text-text-success',
}

export interface ResourceCategory {
  id: 'phonetic' | 'exam' | 'grammar'
  title: string
  subtitle: string
  icon: LucideIcon
  tone: Tone
  /** 未开放的大类：L1 卡片置灰不可点、标「即将上线」，也不可经 URL 参数进入 L2。 */
  comingSoon?: boolean
}

export const RESOURCE_CATEGORIES: ResourceCategory[] = [
  { id: 'phonetic', title: '音标', subtitle: '元音 · 辅音', icon: AudioLines, tone: 'warning' },
  { id: 'exam', title: '真题', subtitle: '高考 · 考研 · 四六级', icon: FileText, tone: 'accent', comingSoon: true },
  { id: 'grammar', title: '语法', subtitle: '时态 · 从句 · 虚拟语气', icon: AlignLeft, tone: 'success', comingSoon: true },
]

/** 大类图标盒：色调随大类（对齐单词本功能卡的 size-11 圆角盒，但染成三色以复刻 iOS 分类色）。 */
export function CategoryIcon({ category }: { category: ResourceCategory }): React.JSX.Element {
  const Icon = category.icon
  return (
    <span className={cn('grid size-11 shrink-0 place-items-center rounded-lg', TONE_TILE[category.tone])}>
      <Icon className="size-5" strokeWidth={2} />
    </span>
  )
}

/** 按大类 id 渲染对应内容体（不含页头，页头由外壳负责）。 */
export function CategoryContent({ categoryId }: { categoryId: ResourceCategory['id'] }): React.JSX.Element {
  switch (categoryId) {
    case 'phonetic':
      return <PhoneticsContent />
    case 'exam':
      return <PastPaperContent />
    case 'grammar':
      return <GrammarContent />
  }
}

// MARK: - 真题

interface Exam {
  id: string
  title: string
}

interface Paper {
  id: string
  examId: string
  year: number
  /** 封面上的卷次副文，如「6月·卷1」「Test 1」「TPO 74」。 */
  caption: string
  title: string
  subtitle: string
  durationMinutes: number
}

const EXAMS: Exam[] = [
  { id: 'gaokao', title: '高考' },
  { id: 'cet4', title: '四级' },
  { id: 'cet6', title: '六级' },
  { id: 'postgrad', title: '考研' },
  { id: 'ielts', title: '雅思' },
  { id: 'toefl', title: '托福' },
  { id: 'gre', title: 'GRE' },
]

const PAPERS: Paper[] = [
  { id: 'gk-2024-i', examId: 'gaokao', year: 2024, caption: '卷Ⅰ', title: '2024 年 全国新高考 Ⅰ 卷', subtitle: '听力 · 阅读 · 完形 · 写作', durationMinutes: 120 },
  { id: 'gk-2024-ii', examId: 'gaokao', year: 2024, caption: '卷Ⅱ', title: '2024 年 全国新高考 Ⅱ 卷', subtitle: '听力 · 阅读 · 完形 · 写作', durationMinutes: 120 },
  { id: 'gk-2023-i', examId: 'gaokao', year: 2023, caption: '卷Ⅰ', title: '2023 年 全国新高考 Ⅰ 卷', subtitle: '听力 · 阅读 · 完形 · 写作', durationMinutes: 120 },
  { id: 'cet4-2024-06-1', examId: 'cet4', year: 2024, caption: '6月·卷1', title: '2024 年 6 月 大学英语四级真题（卷一）', subtitle: '听力 · 阅读 · 写作翻译', durationMinutes: 125 },
  { id: 'cet4-2023-12-1', examId: 'cet4', year: 2023, caption: '12月·卷1', title: '2023 年 12 月 大学英语四级真题（卷一）', subtitle: '听力 · 阅读 · 写作翻译', durationMinutes: 125 },
  { id: 'cet6-2025-06-1', examId: 'cet6', year: 2025, caption: '6月·套1', title: '2025 年 6 月 大学英语六级真题（第一套）', subtitle: '写作 · 听力 · 阅读 · 翻译', durationMinutes: 130 },
  { id: 'cet6-2024-06-1', examId: 'cet6', year: 2024, caption: '6月·卷1', title: '2024 年 6 月 大学英语六级真题（卷一）', subtitle: '听力 · 阅读 · 写作翻译', durationMinutes: 130 },
  { id: 'kao-2024-en1', examId: 'postgrad', year: 2024, caption: '英语一', title: '2024 年 考研英语（一）真题', subtitle: '完形 · 阅读 · 翻译 · 写作', durationMinutes: 180 },
  { id: 'kao-2024-en2', examId: 'postgrad', year: 2024, caption: '英语二', title: '2024 年 考研英语（二）真题', subtitle: '完形 · 阅读 · 翻译 · 写作', durationMinutes: 180 },
  { id: 'ielts-c19-t1', examId: 'ielts', year: 2024, caption: 'Test 1', title: 'Cambridge IELTS 19 · Test 1', subtitle: 'Listening · Reading · Writing', durationMinutes: 165 },
  { id: 'ielts-c18-t1', examId: 'ielts', year: 2023, caption: 'Test 1', title: 'Cambridge IELTS 18 · Test 1', subtitle: 'Listening · Reading · Writing', durationMinutes: 165 },
  { id: 'toefl-tpo74', examId: 'toefl', year: 2024, caption: 'TPO 74', title: 'TOEFL TPO 74', subtitle: 'Reading · Listening · Speaking · Writing', durationMinutes: 180 },
  { id: 'gre-2024', examId: 'gre', year: 2024, caption: 'Mock', title: 'GRE General 2024 Mock', subtitle: 'Verbal · Quant · AW', durationMinutes: 220 },
]

/** 真题内容：搜索框 + 横向下划线考试 tab + 渐变封面卡列表。有关键词时过滤，无匹配走空态。 */
function PastPaperContent(): React.JSX.Element {
  const [examId, setExamId] = useState<string>(EXAMS[0].id)
  const [query, setQuery] = useState('')

  const keyword = query.trim().toLowerCase()
  const searching = keyword.length > 0
  const papers = PAPERS.filter((p) => {
    if (searching) {
      return p.title.toLowerCase().includes(keyword) || p.subtitle.toLowerCase().includes(keyword)
    }
    return p.examId === examId
  }).sort((a, b) => b.year - a.year)

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索试卷名称、年份"
          className="pl-9"
        />
      </div>

      {/* 搜索态隐藏考试 tab：此时结果跨考试，tab 不再是当前列表的一级导航。 */}
      {!searching && (
        <div className="flex gap-6 overflow-x-auto">
          {EXAMS.map((exam) => (
            <button
              key={exam.id}
              type="button"
              onClick={() => setExamId(exam.id)}
              className="group flex shrink-0 flex-col items-center gap-1.5 pt-0.5"
            >
              <span
                className={cn(
                  'text-sm font-semibold transition-colors',
                  examId === exam.id ? 'text-text-primary' : 'text-text-muted group-hover:text-text-secondary'
                )}
              >
                {exam.title}
              </span>
              <span
                className={cn(
                  'h-[3px] w-5 rounded-full transition-colors',
                  examId === exam.id ? 'bg-fill-brand' : 'bg-transparent'
                )}
              />
            </button>
          ))}
        </div>
      )}

      {papers.length === 0 ? (
        <EmptyPapers />
      ) : (
        <div className="flex flex-col gap-3">
          {papers.map((paper) => (
            <PaperCard key={paper.id} paper={paper} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 单份试卷卡：near-black 封面（年份 + 卷次）+ 标题 / 副标题 / 用时 + 右侧 chevron，整卡可点。 */
function PaperCard({ paper }: { paper: Paper }): React.JSX.Element {
  return (
    <Card
      role="button"
      tabIndex={0}
      className="btn-squish group flex cursor-pointer items-center gap-3.5 p-3.5 transition-shadow hover:shadow-sm can-focus"
    >
      <PaperCover paper={paper} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="truncate text-sm font-semibold text-text-primary">{paper.title}</h3>
        <p className="truncate text-xs text-text-secondary">{paper.subtitle}</p>
        <span className="inline-flex items-center gap-1 text-xs text-text-muted">
          <Clock className="size-3.5" />
          用时 {paper.durationMinutes} 分钟
        </span>
      </div>
      <ChevronRight className="size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" />
    </Card>
  )
}

/** 试卷小封面：near-black 竖块 + 左侧书脊线，居中年份与卷次，明暗自适应（对齐桌面端书封的处理）。 */
function PaperCover({ paper }: { paper: Paper }): React.JSX.Element {
  return (
    <div className="relative grid h-20 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-fill-primary shadow-sm">
      <span aria-hidden className="absolute inset-y-0 left-1 w-px bg-on-primary/15" />
      <div className="flex flex-col items-center gap-0.5 px-1 text-on-primary">
        <span className="text-sm font-bold">{paper.year}</span>
        <span className="text-center text-[11px] font-medium leading-tight text-on-primary/85">{paper.caption}</span>
      </div>
    </div>
  )
}

/** 真题空态：搜索无匹配 / 当前考试暂无试卷。 */
function EmptyPapers(): React.JSX.Element {
  return (
    <Card className="flex flex-col items-center gap-2 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-card bg-bg-neutral text-text-muted">
        <FileText className="size-5" />
      </span>
      <p className="text-sm text-text-secondary">没有匹配的真题</p>
    </Card>
  )
}

// MARK: - 语法

interface GrammarItem {
  title: string
  subtitle: string
}

const GRAMMAR_ITEMS: GrammarItem[] = [
  { title: '时态', subtitle: '一般 / 进行 / 完成 · 12 种时态体系' },
  { title: '语态', subtitle: '主动与被动 · 被动语态的构成与使用' },
  { title: '三大从句', subtitle: '名词性 · 定语 · 状语从句' },
  { title: '非谓语动词', subtitle: '不定式 · 动名词 · 分词' },
  { title: '虚拟语气', subtitle: '条件句 · 愿望与建议的虚拟表达' },
  { title: '倒装与强调', subtitle: '完全 / 部分倒装 · 强调句型' },
]

/** 语法内容：白底卡片内分隔的条目列表，每条标题 + 说明 + chevron，整行可点。 */
function GrammarContent(): React.JSX.Element {
  return (
    <Card className="divide-y divide-border-200 overflow-hidden p-0">
      {GRAMMAR_ITEMS.map((item) => (
        <button
          key={item.title}
          type="button"
          className="group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-fill-ghost-hover can-focus"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium text-text-primary">{item.title}</span>
            <span className="truncate text-xs text-text-muted">{item.subtitle}</span>
          </div>
          <Badge variant="neutral" className="shrink-0">建设中</Badge>
          <ChevronRight className="size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" />
        </button>
      ))}
    </Card>
  )
}
