import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookPlus, ChevronLeft, ChevronsUpDown, Minus, Plus, SquarePen, Volume2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  buttonVariants,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Label,
  Textarea,
} from '@/components/ui'

/**
 * 开始学习：对齐 iOS 端「背词练习」页的 UI 与交互（非样式照搬，功能一致）。
 * 揭晓式 active recall + 顶栏分组进度/笔记/加词书/熟 + 底部三档评分 + 完成页 Custom Study。
 * 引擎仅用「数组队列 + 指针 + 简单重排」的占位实现，不复刻 FSRS 调度与三池混排。
 */

// ─────────────────────────── 数据模型（简化自 iOS WordCard/PracticeCard）───────────────────────────

type Group = 'new' | 'review'
type Accent = 'uk' | 'us'
type MeaningSource = 'simple' | 'collins'
type RatingKey = 'again' | 'hard' | 'good'
type DetailTab = 'example' | 'derived' | 'synonym' | 'phrase' | 'exam'

interface CollinsEntry {
  pos: string
  tran: string
  examples: { en: string; zh: string }[]
}
interface Example {
  english: string
  chinese: string
}
interface Inflection {
  label: string
  value: string
}
interface SynonymGroup {
  pos: string
  meaning: string
  words: string[]
}
interface Individual {
  mnemonic?: string
  level?: string
  exam?: { star: number; years: number; frequency: number; types: { name: string; count: number }[] }
  pastExam?: { en: string; zh: string; source: string }[]
}

interface Card {
  /** 队列内唯一实例 id（同词 again 重排复用同一实例）。 */
  uid: number
  group: Group
  word: string
  phoneticUK: string
  phoneticUS: string
  simpleSenses: string[]
  collinsEntries: CollinsEntry[]
  inflections: Inflection[]
  examples: Example[]
  derived: string[]
  phraseGroup: string[]
  synonymGroups: SynonymGroup[]
  individual: Individual
  userNote?: string
}

let uidSeq = 1
function card(data: Omit<Card, 'uid'>): Card {
  return { uid: uidSeq++, ...data }
}

const DETAIL_TABS: { key: DetailTab; label: string }[] = [
  { key: 'example', label: '例句' },
  { key: 'derived', label: '派生' },
  { key: 'synonym', label: '近义' },
  { key: 'phrase', label: '词组' },
  { key: 'exam', label: '真题' },
]

const RATINGS: { key: RatingKey; label: string; interval: string; dot: string }[] = [
  { key: 'again', label: '不认识', interval: '<1 分钟', dot: 'bg-fill-danger' },
  { key: 'hard', label: '模糊', interval: '10 分钟', dot: 'bg-fill-warning' },
  { key: 'good', label: '认识', interval: '1 天', dot: 'bg-fill-success' },
]

// ─────────────────────────── 占位词卡 ───────────────────────────

const INITIAL_CARDS: Card[] = [
  card({
    group: 'new',
    word: 'abandon',
    phoneticUK: '/əˈbændən/',
    phoneticUS: '/əˈbændən/',
    simpleSenses: ['v. 抛弃；放弃；离弃', 'n. 放纵；狂热'],
    collinsEntries: [
      {
        pos: 'V-T',
        tran: '如果你 <b>abandon</b> 某地、某物或某人，你永远地离开或抛弃了它。',
        examples: [{ en: 'He abandoned his car and walked home.', zh: '他弃车步行回家。' }],
      },
    ],
    inflections: [
      { label: '过去式', value: 'abandoned' },
      { label: '现在分词', value: 'abandoning' },
      { label: '第三人称单数', value: 'abandons' },
    ],
    examples: [
      { english: 'The crew had to <b>abandon</b> the sinking ship.', chinese: '船员们不得不弃船逃生。' },
      { english: 'She <b>abandoned</b> the idea of studying abroad.', chinese: '她放弃了出国留学的想法。' },
    ],
    derived: ['abandonment — n. 放弃；抛弃', 'abandoned — adj. 被抛弃的'],
    phraseGroup: ['abandon oneself to — 沉溺于', 'with abandon — 放纵地，尽情地'],
    synonymGroups: [{ pos: 'v.', meaning: '放弃', words: ['desert', 'forsake', 'quit', 'give up'] }],
    individual: {
      mnemonic: 'a（一个）+ band（乐队）+ on → 一个乐队解散了 → 抛弃、放弃。',
      level: '四级',
      exam: {
        star: 4,
        years: 10,
        frequency: 23,
        types: [
          { name: '阅读理解', count: 12 },
          { name: '完形填空', count: 7 },
          { name: '翻译', count: 4 },
        ],
      },
      pastExam: [
        {
          en: 'They were forced to <b>abandon</b> the project due to lack of funds.',
          zh: '由于资金短缺，他们被迫放弃了这个项目。',
          source: '2019 · 四级真题',
        },
      ],
    },
  }),
  card({
    group: 'new',
    word: 'genuine',
    phoneticUK: '/ˈdʒenjuɪn/',
    phoneticUS: '/ˈdʒenjuɪn/',
    simpleSenses: ['adj. 真正的；真诚的；名副其实的'],
    collinsEntries: [],
    inflections: [{ label: '副词', value: 'genuinely' }],
    examples: [{ english: 'She showed a <b>genuine</b> interest in the project.', chinese: '她对这个项目表现出真正的兴趣。' }],
    derived: ['genuinely — adv. 真诚地', 'genuineness — n. 真实性'],
    phraseGroup: [],
    synonymGroups: [{ pos: 'adj.', meaning: '真实的', words: ['authentic', 'real', 'sincere'] }],
    individual: { mnemonic: 'gen（产生）+ uine → 天生产生的 → 真正的、真诚的。', level: '四级' },
  }),
  card({
    group: 'new',
    word: 'fragile',
    phoneticUK: '/ˈfrædʒaɪl/',
    phoneticUS: '/ˈfrædʒl/',
    simpleSenses: ['adj. 易碎的；脆弱的；易损坏的'],
    collinsEntries: [],
    inflections: [],
    examples: [{ english: 'The vase is extremely <b>fragile</b>, so handle it with care.', chinese: '这只花瓶极易破碎，请小心轻放。' }],
    derived: ['fragility — n. 脆弱'],
    phraseGroup: [],
    synonymGroups: [{ pos: 'adj.', meaning: '脆弱的', words: ['delicate', 'brittle', 'frail'] }],
    individual: {},
  }),
  card({
    group: 'new',
    word: 'crucial',
    phoneticUK: '/ˈkruːʃl/',
    phoneticUS: '/ˈkruːʃl/',
    simpleSenses: ['adj. 至关重要的；决定性的'],
    collinsEntries: [],
    inflections: [{ label: '副词', value: 'crucially' }],
    examples: [{ english: 'Clean water is <b>crucial</b> to all forms of life.', chinese: '洁净的水对一切生命形式都至关重要。' }],
    derived: [],
    phraseGroup: ['crucial to — 对……至关重要'],
    synonymGroups: [{ pos: 'adj.', meaning: '关键的', words: ['critical', 'vital', 'essential'] }],
    individual: { level: '四级', exam: { star: 5, years: 10, frequency: 31, types: [{ name: '阅读理解', count: 18 }, { name: '写作', count: 13 }] } },
  }),
  card({
    group: 'new',
    word: 'vivid',
    phoneticUK: '/ˈvɪvɪd/',
    phoneticUS: '/ˈvɪvɪd/',
    simpleSenses: ['adj. 生动的；鲜明的；鲜艳的'],
    collinsEntries: [],
    inflections: [],
    examples: [{ english: 'She gave a <b>vivid</b> description of the festival.', chinese: '她生动地描述了那个节日的情景。' }],
    derived: ['vividly — adv. 生动地'],
    phraseGroup: [],
    synonymGroups: [],
    individual: {},
  }),
  card({
    group: 'review',
    word: 'hesitate',
    phoneticUK: '/ˈhezɪteɪt/',
    phoneticUS: '/ˈhezɪteɪt/',
    simpleSenses: ['v. 犹豫；踌躇；不愿意'],
    collinsEntries: [],
    inflections: [{ label: '过去式', value: 'hesitated' }],
    examples: [{ english: "Don't <b>hesitate</b> to ask if you need any help.", chinese: '如果需要帮助，别犹豫，尽管问。' }],
    derived: ['hesitation — n. 犹豫'],
    phraseGroup: [],
    synonymGroups: [{ pos: 'v.', meaning: '犹豫', words: ['pause', 'waver'] }],
    individual: {},
    userNote: '常与 to do 搭配：hesitate to do sth.',
  }),
  card({
    group: 'review',
    word: 'diligent',
    phoneticUK: '/ˈdɪlɪdʒənt/',
    phoneticUS: '/ˈdɪlɪdʒənt/',
    simpleSenses: ['adj. 勤勉的；用功的；尽职的'],
    collinsEntries: [],
    inflections: [{ label: '副词', value: 'diligently' }],
    examples: [{ english: 'A <b>diligent</b> student reviews her notes every day.', chinese: '勤奋的学生每天都会复习笔记。' }],
    derived: ['diligence — n. 勤奋'],
    phraseGroup: [],
    synonymGroups: [{ pos: 'adj.', meaning: '勤奋的', words: ['industrious', 'hardworking'] }],
    individual: {},
  }),
  card({
    group: 'review',
    word: 'reluctant',
    phoneticUK: '/rɪˈlʌktənt/',
    phoneticUS: '/rɪˈlʌktənt/',
    simpleSenses: ['adj. 不情愿的；勉强的'],
    collinsEntries: [],
    inflections: [{ label: '副词', value: 'reluctantly' }],
    examples: [{ english: 'He was <b>reluctant</b> to admit his mistake.', chinese: '他不愿承认自己的错误。' }],
    derived: [],
    phraseGroup: ['reluctant to — 不愿……'],
    synonymGroups: [{ pos: 'adj.', meaning: '不情愿的', words: ['unwilling', 'hesitant'] }],
    individual: {},
  }),
]

/** 自定义学习额外取卡的词池，Custom Study 从中循环生成占位卡。 */
const EXTRA_WORDS = ['eloquent', 'profound', 'tedious', 'sturdy', 'candid', 'lavish', 'prudent', 'nimble', 'sober', 'quaint']
function makeExtraCard(group: Group, i: number): Card {
  const w = EXTRA_WORDS[i % EXTRA_WORDS.length]
  return card({
    group,
    word: w,
    phoneticUK: `/ˈ${w}/`,
    phoneticUS: `/ˈ${w}/`,
    simpleSenses: ['adj. （占位释义）示例词义'],
    collinsEntries: [],
    inflections: [],
    examples: [{ english: `This is a sample sentence with <b>${w}</b>.`, chinese: '这是一个占位例句。' }],
    derived: [],
    phraseGroup: [],
    synonymGroups: [],
    individual: {},
  })
}

// ─────────────────────────── 富文本：<b> → 加粗 ───────────────────────────

/** 把服务端保留的 <b>…</b> 渲染为加粗，其余标签丢弃（对齐 iOS dictHighlighted）。 */
function Highlighted({ text, className }: { text: string; className?: string }): React.JSX.Element {
  const parts = text.split(/(<b>|<\/b>)/i)
  let bold = false
  return (
    <span className={className}>
      {parts.map((p, i) => {
        if (/^<b>$/i.test(p)) {
          bold = true
          return null
        }
        if (/^<\/b>$/i.test(p)) {
          bold = false
          return null
        }
        return bold ? (
          <strong key={i} className="font-semibold text-text-primary">
            {p}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        )
      })}
    </span>
  )
}

// ─────────────────────────── 根组件 ───────────────────────────

export function WordStudyDemo(): React.JSX.Element {
  const [queue, setQueue] = useState<Card[]>(INITIAL_CARDS)
  const [revealed, setRevealed] = useState(false)
  const [tab, setTab] = useState<DetailTab>('example')
  const [accent, setAccent] = useState<Accent>('us')
  const [source, setSource] = useState<MeaningSource>('simple')

  // 顶栏分组进度：学 completedNew/newLimit · 复 completedReview/reviewLimit。
  const [completedNew, setCompletedNew] = useState(0)
  const [completedReview, setCompletedReview] = useState(0)
  const [newLimit, setNewLimit] = useState(() => INITIAL_CARDS.filter((c) => c.group === 'new').length)
  const [reviewLimit, setReviewLimit] = useState(() => INITIAL_CARDS.filter((c) => c.group === 'review').length)

  const [noteOpen, setNoteOpen] = useState(false)
  const [addBookOpen, setAddBookOpen] = useState(false)
  const [masterOpen, setMasterOpen] = useState(false)

  const current = queue[0]
  const finished = current == null

  /** 切到下一张：复位单卡临时态（对齐 iOS onChange 复位揭晓 + Tab）。 */
  const resetForNextCard = useCallback(() => {
    setRevealed(false)
    setTab('example')
  }, [])

  const reveal = useCallback(() => setRevealed(true), [])

  /** 评分：again 塞回队列稍后重现（不计完成）；hard/good 出队并按分组 +1 完成。 */
  function rate(key: RatingKey): void {
    if (!current) return
    if (key === 'again') {
      setQueue((q) => {
        const [head, ...rest] = q
        const at = Math.min(2, rest.length)
        return [...rest.slice(0, at), head, ...rest.slice(at)]
      })
    } else {
      bumpCompleted(current.group)
      setQueue((q) => q.slice(1))
    }
    resetForNextCard()
  }

  /** 标熟：永久移出队列并计入完成（对齐 iOS markMastered ≈ Anki Suspend）。 */
  function markMastered(): void {
    if (!current) return
    bumpCompleted(current.group)
    setQueue((q) => q.slice(1))
    setMasterOpen(false)
    resetForNextCard()
  }

  function bumpCompleted(group: Group): void {
    if (group === 'new') setCompletedNew((n) => n + 1)
    else setCompletedReview((n) => n + 1)
  }

  /** 保存笔记：就地翻当前卡 userNote（空串视为删除）。 */
  function saveNote(note: string): void {
    const trimmed = note.trim()
    setQueue((q) => q.map((c, i) => (i === 0 ? { ...c, userNote: trimmed || undefined } : c)))
    setNoteOpen(false)
  }

  /** Custom Study：追加占位卡到队列尾，累加对应分组上限，回到练习态。 */
  function appendExtra(group: Group, batch: number): void {
    const extras = Array.from({ length: batch }, (_, i) => makeExtraCard(group, i))
    setQueue((q) => [...q, ...extras])
    if (group === 'new') setNewLimit((n) => n + batch)
    else setReviewLimit((n) => n + batch)
    resetForNextCard()
  }

  // 空格揭晓（桌面便捷键；iOS 为点击屏幕）。
  useEffect(() => {
    if (finished || revealed) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        reveal()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [finished, revealed, reveal])

  if (finished) {
    return <FinishedView onStart={appendExtra} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      {/* 一体化闪卡：顶栏 + 词卡内容 + 评分条同处一张 Card，贴合手机端「整屏即一张卡」的观感。
          顶栏 pin 卡顶、评分 pin 卡底，中间内容随卡填高并滚动。 */}
      <Card className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col overflow-hidden">
        <PracticeTopBar
          completedNew={completedNew}
          newLimit={newLimit}
          completedReview={completedReview}
          reviewLimit={reviewLimit}
          onNote={() => setNoteOpen(true)}
          onAddBook={() => setAddBookOpen(true)}
          onMaster={() => setMasterOpen(true)}
        />

        {/* 内容滚动区：点击空白揭晓（active recall）。 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8" onClick={() => !revealed && reveal()}>
          <WordDetail
            card={current}
            revealed={revealed}
            accent={accent}
            source={source}
            tab={tab}
            onToggleAccent={() => setAccent((a) => (a === 'uk' ? 'us' : 'uk'))}
            onChangeSource={setSource}
            onChangeTab={setTab}
            onReveal={reveal}
          />
        </div>

        {/* 评分条（卡内底部）：仅揭晓后出现。 */}
        {revealed && <RatingBar onRate={rate} />}
      </Card>

      <NoteDialog open={noteOpen} onOpenChange={setNoteOpen} word={current.word} initial={current.userNote ?? ''} onSave={saveNote} />
      <AddToBookDialog open={addBookOpen} onOpenChange={setAddBookOpen} word={current.word} />
      <MasterConfirm open={masterOpen} onOpenChange={setMasterOpen} word={current.word} onConfirm={markMastered} />
    </div>
  )
}

// ─────────────────────────── 顶栏 ───────────────────────────

function PracticeTopBar({
  completedNew,
  newLimit,
  completedReview,
  reviewLimit,
  onNote,
  onAddBook,
  onMaster,
}: {
  completedNew: number
  newLimit: number
  completedReview: number
  reviewLimit: number
  onNote: () => void
  onAddBook: () => void
  onMaster: () => void
}): React.JSX.Element {
  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-border-200 px-6 py-2.5">
      <GroupProgress label="学" value={completedNew} total={newLimit} tone="primary" />
      <GroupProgress label="复" value={completedReview} total={reviewLimit} tone="accent" />
      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="iconSm" aria-label="笔记" className="text-text-secondary" onClick={onNote}>
          <SquarePen className="size-[18px]" />
        </Button>
        <Button variant="ghost" size="iconSm" aria-label="加入单词本" className="text-text-secondary" onClick={onAddBook}>
          <BookPlus className="size-[18px]" />
        </Button>
        <Button variant="ghost" size="sm" className="!min-w-0 text-text-secondary" onClick={onMaster}>
          熟
        </Button>
      </div>
    </header>
  )
}

/** 顶栏分组进度：标签 + 迷你进度条 + 计数。tone 决定进度色（学=主色，复=强调色）。 */
function GroupProgress({
  label,
  value,
  total,
  tone,
}: {
  label: string
  value: number
  total: number
  tone: 'primary' | 'accent'
}): React.JSX.Element {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-text-secondary">{label}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-border-200">
        <div
          className={cn('h-full rounded-full transition-all', tone === 'primary' ? 'bg-fill-primary' : 'bg-fill-accent')}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-text-muted">
        {value}/{total}
      </span>
    </div>
  )
}

// ─────────────────────────── 词卡主体 ───────────────────────────

function WordDetail({
  card,
  revealed,
  accent,
  source,
  tab,
  onToggleAccent,
  onChangeSource,
  onChangeTab,
  onReveal,
}: {
  card: Card
  revealed: boolean
  accent: Accent
  source: MeaningSource
  tab: DetailTab
  onToggleAccent: () => void
  onChangeSource: (s: MeaningSource) => void
  onChangeTab: (t: DetailTab) => void
  onReveal: () => void
}): React.JSX.Element {
  const phonetic = accent === 'uk' ? card.phoneticUK : card.phoneticUS
  const collinsAvailable = card.collinsEntries.length > 0
  const effectiveSource: MeaningSource = source === 'collins' && collinsAvailable ? 'collins' : 'simple'
  const note = card.userNote?.trim()

  // 子控件消化点击，避免穿透到卡片区触发误揭晓。
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div className="flex flex-col gap-4">
      {/* 单词（真实页点击播真人音频；demo mock 数据无音频，静默） */}
      <button
        type="button"
        onClick={stop}
        className="btn-squish self-start text-left"
        aria-label={`朗读 ${card.word}`}
      >
        <span className="font-serif text-4xl font-semibold text-text-primary sm:text-5xl">{card.word}</span>
      </button>

      {/* 音标行：英美切换 + 音标 + 释义来源 */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={(e) => {
            stop(e)
            onToggleAccent()
          }}
          className="btn-squish inline-flex items-center gap-1 rounded-full border border-border-300 bg-surface-1 px-2.5 py-1 text-xs font-semibold text-text-secondary"
        >
          {accent === 'uk' ? '英' : '美'}
          <Volume2 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={stop}
          className="btn-squish text-sm font-semibold text-text-secondary"
        >
          {phonetic}
        </button>

        <div className="ml-auto" onClick={stop}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="btn-squish inline-flex items-center gap-1 rounded-full border border-border-300 bg-surface-1 px-2.5 py-1 text-xs font-semibold text-text-secondary"
              >
                {effectiveSource === 'collins' ? '中英' : '中文'}
                <ChevronsUpDown className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onChangeSource('simple')}>中文</DropdownMenuItem>
              <DropdownMenuItem disabled={!collinsAvailable} onSelect={() => onChangeSource('collins')}>
                中英
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 释义区：未揭晓模糊遮盖，点击揭晓 */}
      <div
        className={cn('transition-all duration-200', !revealed && 'pointer-events-none select-none blur-sm')}
        onClick={(e) => {
          if (!revealed) {
            stop(e)
            onReveal()
          }
        }}
      >
        {effectiveSource === 'collins' ? <CollinsMeaning entries={card.collinsEntries} /> : <SimpleMeaning senses={card.simpleSenses} />}
        {card.inflections.length > 0 && <Inflections items={card.inflections} />}
      </div>

      {/* 未揭晓：卡内居中的揭晓提示，替代原先飘在空白区的孤立文案 */}
      {!revealed && (
        <button
          type="button"
          onClick={(e) => {
            stop(e)
            onReveal()
          }}
          className="btn-squish mx-auto mt-1 flex items-center gap-2 rounded-full bg-bg-neutral-chip px-3.5 py-1.5 text-xs font-medium text-text-secondary"
        >
          点击显示答案
          <kbd className="rounded bg-surface-1 px-1.5 py-px font-sans text-[10px] text-text-muted shadow-card-ring">空格</kbd>
        </button>
      )}

      {/* 笔记 + 详情 Tab：揭晓后才出现 */}
      {revealed && (
        <>
          {note && (
            <>
              <Divider />
              <section className="flex flex-col gap-2">
                <span className="text-xs font-medium text-text-muted">我的笔记</span>
                <p className="text-sm leading-relaxed text-text-primary">{note}</p>
              </section>
            </>
          )}
          <Divider />
          <DetailTabs card={card} tab={tab} onChangeTab={onChangeTab} />
        </>
      )}
    </div>
  )
}

function SimpleMeaning({ senses }: { senses: string[] }): React.JSX.Element {
  if (senses.length === 0) return <p className="text-base text-text-muted">暂无简明释义</p>
  return (
    <div className="flex flex-col gap-2">
      {senses.map((s, i) => (
        <p key={i} className="text-base text-text-primary">
          {s}
        </p>
      ))}
    </div>
  )
}

function CollinsMeaning({ entries }: { entries: CollinsEntry[] }): React.JSX.Element {
  if (entries.length === 0) return <p className="text-base text-text-muted">暂无柯林斯释义</p>
  return (
    <div className="flex flex-col gap-3.5">
      {entries.map((e, i) => (
        <div key={i} className="flex flex-col gap-2">
          <p className="text-base text-text-primary">
            {e.pos && <span className="mr-1.5 font-serif text-sm italic text-text-muted">{e.pos}</span>}
            <Highlighted text={e.tran} />
          </p>
          {e.examples.map((ex, j) => (
            <div key={j} className="flex gap-2 pl-1 text-sm text-text-secondary">
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

function Inflections({ items }: { items: Inflection[] }): React.JSX.Element {
  return (
    <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
      {items.map((f) => (
        <div key={`${f.label}-${f.value}`} className="flex items-baseline gap-1.5 text-sm text-text-secondary">
          <span className="font-semibold">{f.label}</span>
          <span>{f.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────── 详情 Tab ───────────────────────────

function DetailTabs({ card, tab, onChangeTab }: { card: Card; tab: DetailTab; onChangeTab: (t: DetailTab) => void }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex">
        {DETAIL_TABS.map((t) => {
          const active = t.key === tab
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChangeTab(t.key)}
              className="btn-squish flex flex-1 flex-col items-center gap-2 py-1"
            >
              <span className={cn('text-sm', active ? 'font-semibold text-text-primary' : 'text-text-muted')}>{t.label}</span>
              <span className={cn('h-0.5 w-7 rounded-full', active ? 'bg-fill-brand' : 'bg-transparent')} />
            </button>
          )
        })}
      </div>
      <div className="min-h-[3rem]">
        <TabContent card={card} tab={tab} />
      </div>
    </section>
  )
}

function TabContent({ card, tab }: { card: Card; tab: DetailTab }): React.JSX.Element {
  switch (tab) {
    case 'example':
      return card.examples.length ? (
        <div className="flex flex-col gap-3.5">
          {card.examples.map((ex, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div className="flex flex-1 flex-col gap-1">
                <Highlighted text={ex.english} className="text-base leading-relaxed text-text-primary" />
                {ex.chinese && <Highlighted text={ex.chinese} className="text-sm leading-relaxed text-text-secondary" />}
              </div>
              {/* 真实页仅在例句带真人音频 URL 时出喇叭；demo mock 无音频，按钮仅展示样式 */}
              <Button variant="ghost" size="iconSm" aria-label="朗读例句" className="text-text-muted">
                <Volume2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <Empty />
      )
    case 'derived':
      return <TwoLineList items={card.derived} />
    case 'phrase':
      return <TwoLineList items={card.phraseGroup} />
    case 'synonym':
      return card.synonymGroups.length ? (
        <div className="flex flex-col gap-4">
          {card.synonymGroups.map((g, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <span className="text-sm text-text-secondary">{[g.pos, g.meaning].filter(Boolean).join(' ')}</span>
              <div className="flex flex-wrap gap-1.5">
                {g.words.map((w) => (
                  <span key={w} className="rounded-md bg-bg-neutral-chip px-2 py-0.5 text-sm text-text-primary">
                    {w}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty />
      )
    case 'exam':
      return <ExamContent individual={card.individual} />
  }
}

function TwoLineList({ items }: { items: string[] }): React.JSX.Element {
  if (!items.length) return <Empty />
  return (
    <div className="flex flex-col gap-3">
      {items.map((raw, i) => {
        const [head, ...tail] = raw.split(' — ')
        return (
          <p key={i} className="text-base text-text-primary">
            {head}
            {tail.length > 0 && <span className="ml-2 text-text-secondary">{tail.join(' — ')}</span>}
          </p>
        )
      })}
    </div>
  )
}

function ExamContent({ individual }: { individual: Individual }): React.JSX.Element {
  const hasExam = individual.exam && (individual.exam.frequency > 0 || individual.exam.types.some((t) => t.count > 0))
  if (!individual.mnemonic && !hasExam && !individual.pastExam?.length) return <Empty />
  return (
    <div className="flex flex-col gap-5">
      {individual.mnemonic && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-text-primary">助记</span>
          <p className="text-base leading-relaxed text-text-primary">{individual.mnemonic}</p>
        </div>
      )}
      {hasExam && individual.exam && (
        <div className="flex flex-col gap-2.5">
          <span className="text-sm font-semibold text-text-primary">考频</span>
          <div className="flex items-center gap-1.5 text-sm text-text-secondary">
            单词必背指数
            <span className="text-text-warning">{'★'.repeat(individual.exam.star)}</span>
          </div>
          <div className="rounded-card border border-border-300 p-3.5">
            <p className="mb-2.5 text-sm text-text-secondary">
              近 {individual.exam.years} 年{individual.level ?? ''}真题中出现{' '}
              <span className="font-serif text-lg font-bold text-text-primary">{individual.exam.frequency}</span> 次
            </p>
            <div className="flex flex-col gap-1.5">
              {individual.exam.types.map((t) => (
                <div key={t.name} className="flex items-center gap-2 text-sm">
                  <span className="size-1.5 rounded-full bg-fill-accent" />
                  <span className="text-text-primary">{t.name}</span>
                  <span className="ml-auto tabular-nums text-text-muted">{t.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {individual.pastExam?.length ? (
        <div className="flex flex-col gap-2.5">
          <span className="text-sm font-semibold text-text-primary">真题例句</span>
          {individual.pastExam.map((p, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <Highlighted text={p.en} className="text-base leading-relaxed text-text-primary" />
              {p.zh && <Highlighted text={p.zh} className="text-sm leading-relaxed text-text-secondary" />}
              {p.source && <span className="mt-0.5 text-xs text-text-muted">{p.source}</span>}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Empty(): React.JSX.Element {
  return <p className="text-sm text-text-muted">暂无内容</p>
}

function Divider(): React.JSX.Element {
  return <div className="h-px w-full bg-border-200" />
}

// ─────────────────────────── 底部评分条 ───────────────────────────

function RatingBar({ onRate }: { onRate: (key: RatingKey) => void }): React.JSX.Element {
  return (
    <div className="shrink-0 border-t border-border-200 px-3 py-2">
      <div className="flex gap-1">
        {RATINGS.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => onRate(r.key)}
            className="btn-squish flex flex-1 flex-col items-center gap-1 rounded-lg py-2 transition-colors hover:bg-bg-200"
          >
            <span className="text-xs text-text-muted">{r.interval}</span>
            <span className="text-base font-semibold text-text-primary">{r.label}</span>
            <span className={cn('h-[3px] w-6 rounded-full', r.dot)} />
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────── 弹窗：笔记 / 加词书 / 标熟 ───────────────────────────

function NoteDialog({
  open,
  onOpenChange,
  word,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  word: string
  initial: string
  onSave: (note: string) => void
}): React.JSX.Element {
  const [text, setText] = useState(initial)
  useEffect(() => {
    if (open) setText(initial)
  }, [open, initial])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{word} · 笔记</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="note-input">我的笔记</Label>
          <Textarea id="note-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="记录助记、搭配、易错点…" autoFocus />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">取消</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => onSave(text)}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const CUSTOM_BOOKS = [
  { id: 1, title: '高频错词本' },
  { id: 2, title: '雅思专项突破' },
  { id: 3, title: '口语高频词' },
]

function AddToBookDialog({ open, onOpenChange, word }: { open: boolean; onOpenChange: (o: boolean) => void; word: string }): React.JSX.Element {
  const [joined, setJoined] = useState<Set<number>>(new Set())
  useEffect(() => {
    if (open) setJoined(new Set())
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>把「{word}」加入单词本</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col divide-y divide-border-200">
          {CUSTOM_BOOKS.map((b) => {
            const inBook = joined.has(b.id)
            return (
              <div key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-sm font-medium text-text-primary">{b.title}</span>
                <Button
                  variant={inBook ? 'secondary' : 'primary'}
                  size="sm"
                  className="!min-w-0"
                  onClick={() =>
                    setJoined((prev) => {
                      const next = new Set(prev)
                      if (inBook) next.delete(b.id)
                      else next.add(b.id)
                      return next
                    })
                  }
                >
                  {inBook ? '移出' : '加入'}
                </Button>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MasterConfirm({
  open,
  onOpenChange,
  word,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  word: string
  onConfirm: () => void
}): React.JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>标记「{word}」为已掌握？</AlertDialogTitle>
          <AlertDialogDescription>该词将退出学习计划，不再出现在练习队列中。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction className={buttonVariants({ variant: 'primary' })} onClick={onConfirm}>
            标为已掌握
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ─────────────────────────── 完成页（Custom Study）───────────────────────────

interface StudyOption {
  key: string
  group: Group
  title: string
  subtitle: string
  unit: string
  verb: string
  available: number
  defaultBatch: number
}

const STUDY_OPTIONS: StudyOption[] = [
  { key: 'continueLearn', group: 'new', title: '继续学习', subtitle: '今日新词上限外，按词书顺序继续取', unit: '可学', verb: '学习', available: 30, defaultBatch: 10 },
  { key: 'continueReview', group: 'review', title: '继续复习', subtitle: '已到期但今日还没复习的卡', unit: '到期', verb: '复习', available: 12, defaultBatch: 10 },
  { key: 'reviewAhead', group: 'review', title: '提前复习', subtitle: '未到期、最先到期的几张提前刷', unit: '可提前', verb: '提前刷', available: 8, defaultBatch: 5 },
]

function FinishedView({ onStart }: { onStart: (group: Group, batch: number) => void }): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const [batches, setBatches] = useState<Record<string, number>>(() =>
    Object.fromEntries(STUDY_OPTIONS.map((o) => [o.key, o.defaultBatch]))
  )

  const option = STUDY_OPTIONS.find((o) => o.key === selected) ?? null
  const batch = option ? batches[option.key] : 0
  const canStart = option != null && batch > 0

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col overflow-y-auto px-6 py-10">
      <h1 className="mb-8 text-center text-2xl font-bold text-text-primary">今日学习计划已完成</h1>

      <div className="flex flex-col gap-2.5">
        {STUDY_OPTIONS.map((o) => {
          const isSelected = o.key === selected
          const disabled = o.available <= 0
          return (
            <button
              key={o.key}
              type="button"
              disabled={disabled}
              onClick={() => setSelected(o.key)}
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
                      value={batch}
                      max={o.available}
                      onChange={(v) => setBatches((prev) => ({ ...prev, [o.key]: v }))}
                    />
                  ) : (
                    <span className="text-sm text-text-muted">
                      {o.available} {o.unit}
                    </span>
                  )}
                </div>
              </div>
              {isSelected && (
                <div className="flex items-center justify-between pl-[30px] text-sm text-text-muted">
                  <span>{o.subtitle}</span>
                  <span>
                    {o.unit} {o.available} 张
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
          onClick={() => option && onStart(option.group, batch)}
        >
          {option ? `开始${option.verb} · ${batch} 张` : '请选择上方选项'}
        </Button>
      </div>
    </div>
  )
}

function BatchStepper({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }): React.JSX.Element {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border-300 p-0.5">
      <Button variant="ghost" size="iconXs" aria-label="减少" disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))}>
        <Minus className="size-3.5" />
      </Button>
      <span className="w-8 text-center text-sm font-semibold tabular-nums text-text-primary">{value}</span>
      <Button variant="ghost" size="iconXs" aria-label="增加" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus className="size-3.5" />
      </Button>
    </div>
  )
}
