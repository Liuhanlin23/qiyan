import { useMemo, useRef, useState } from 'react'
import { Check, Minus, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Badge, Button, Input, ToggleGroup, ToggleGroupItem, type BadgeProps } from '@/components/ui'
import { useDemoCrumb } from './DemoCrumb'

/**
 * 选词（词书详情）· 全局词库模型下的加词入口。
 *
 * 墨墨式模型：词书不再是「容器/在学书」，而是「选词目录」——从官方词书里逐词勾选，加入全局唯一的词库。
 * 本页即一本词书的选词界面：三态筛选（全部/未加入/已加入，默认停「未加入」）+ 前缀搜索 + 逐词勾选
 * （支持 shift 区间连选）+ 底部 sticky 行动栏（全选未加入 · 实时计数 · 加入学习）。
 * 已在词库的词按其全局学习状态挂徽标且不可再选——直观体现「重叠词不重学」。全为占位 mock，加入后就地翻态。
 */

/** 词的全局归属态：none=未加入词库；其余=已加入且携带该词的全局学习状态。 */
type Member = 'none' | 'unlearned' | 'learning' | 'due' | 'mastered'
type Filter = 'all' | 'none' | 'joined'

/** 已加入的词按学习状态挂徽标，配色对齐首页分布条 / 词表段。 */
const MEMBER_BADGE: Record<Exclude<Member, 'none'>, { variant: BadgeProps['variant']; label: string }> = {
  unlearned: { variant: 'neutral', label: '未学习' },
  learning: { variant: 'accent', label: '记忆中' },
  due: { variant: 'warning', label: '待复习' },
  mastered: { variant: 'success', label: '已标熟' },
}

interface SeedWord {
  word: string
  ipa: string
  sense: string
  member: Member
}

const BOOK = { title: '四级核心词汇' }

/** 占位词表：混合 none 与各已加入态，演示与已学词的重叠。 */
const SEED: SeedWord[] = [
  { word: 'abandon', ipa: '/əˈbændən/', sense: 'v. 放弃；抛弃', member: 'none' },
  { word: 'ability', ipa: '/əˈbɪləti/', sense: 'n. 能力；才能', member: 'mastered' },
  { word: 'abroad', ipa: '/əˈbrɔːd/', sense: 'ad. 到国外', member: 'none' },
  { word: 'absorb', ipa: '/əbˈzɔːrb/', sense: 'v. 吸收；使专注', member: 'none' },
  { word: 'abstract', ipa: '/ˈæbstrækt/', sense: 'a. 抽象的  n. 摘要', member: 'learning' },
  { word: 'academic', ipa: '/ˌækəˈdemɪk/', sense: 'a. 学术的；学院的', member: 'none' },
  { word: 'accompany', ipa: '/əˈkʌmpəni/', sense: 'v. 陪伴；伴随', member: 'none' },
  { word: 'accomplish', ipa: '/əˈkɑːmplɪʃ/', sense: 'v. 完成；实现', member: 'due' },
  { word: 'accurate', ipa: '/ˈækjərət/', sense: 'a. 准确的；精确的', member: 'none' },
  { word: 'acquire', ipa: '/əˈkwaɪər/', sense: 'v. 获得；习得', member: 'unlearned' },
  { word: 'adapt', ipa: '/əˈdæpt/', sense: 'v. 适应；改编', member: 'mastered' },
  { word: 'adequate', ipa: '/ˈædɪkwət/', sense: 'a. 足够的；胜任的', member: 'none' },
  { word: 'adjust', ipa: '/əˈdʒʌst/', sense: 'v. 调整；适应', member: 'none' },
  { word: 'admire', ipa: '/ədˈmaɪər/', sense: 'v. 钦佩；欣赏', member: 'learning' },
  { word: 'adopt', ipa: '/əˈdɑːpt/', sense: 'v. 采纳；收养', member: 'none' },
  { word: 'advocate', ipa: '/ˈædvəkeɪt/', sense: 'v. 提倡  n. 拥护者', member: 'none' },
  { word: 'affect', ipa: '/əˈfekt/', sense: 'v. 影响；感动', member: 'due' },
  { word: 'agenda', ipa: '/əˈdʒendə/', sense: 'n. 议程；日程', member: 'none' },
  { word: 'alter', ipa: '/ˈɔːltər/', sense: 'v. 改变；更改', member: 'none' },
  { word: 'ambiguous', ipa: '/æmˈbɪɡjuəs/', sense: 'a. 模棱两可的', member: 'none' },
  { word: 'analyze', ipa: '/ˈænəlaɪz/', sense: 'v. 分析；解析', member: 'mastered' },
  { word: 'annual', ipa: '/ˈænjuəl/', sense: 'a. 每年的；年度的', member: 'none' },
  { word: 'anticipate', ipa: '/ænˈtɪsɪpeɪt/', sense: 'v. 预料；期望', member: 'none' },
  { word: 'apparent', ipa: '/əˈpærənt/', sense: 'a. 明显的；表面的', member: 'learning' },
  { word: 'appeal', ipa: '/əˈpiːl/', sense: 'v. 呼吁；上诉', member: 'none' },
  { word: 'approach', ipa: '/əˈproʊtʃ/', sense: 'n. 方法  v. 接近', member: 'none' },
  { word: 'appropriate', ipa: '/əˈproʊpriət/', sense: 'a. 恰当的；合适的', member: 'none' },
  { word: 'approximate', ipa: '/əˈprɑːksɪmət/', sense: 'a. 大约的；近似的', member: 'none' },
]

function matchFilter(member: Member, f: Filter): boolean {
  if (f === 'all') return true
  if (f === 'none') return member === 'none'
  return member !== 'none'
}

export function WordbookPickWordsDemo(): React.JSX.Element {
  // 展厅顶栏（DemoView）即「全局 header」，故本页不自带 TopBar，只上报词书名让它显示到「选词 / 四级核心词汇」。
  // 真实页面接线时改回 <TopBar segments={['单词本', '选词', book.title]} backTo="/wordbook/switch" />。
  useDemoCrumb(BOOK.title)

  const [members, setMembers] = useState<Record<string, Member>>(() =>
    Object.fromEntries(SEED.map((w) => [w.word, w.member]))
  )
  const [filter, setFilter] = useState<Filter>('none')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** 上次点选的可见行下标，用于 shift 区间连选。 */
  const lastIndex = useRef<number | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return SEED.map((w) => ({ ...w, member: members[w.word] })).filter(
      (w) => matchFilter(w.member, filter) && (q === '' || w.word.toLowerCase().startsWith(q))
    )
  }, [members, filter, query])

  const selectable = visible.filter((w) => w.member === 'none')
  const selectedVisible = selectable.filter((w) => selected.has(w.word)).length
  const allState: 'off' | 'on' | 'partial' =
    selectedVisible === 0 ? 'off' : selectedVisible === selectable.length ? 'on' : 'partial'

  /** 勾选一行：仅未加入的词可选；shift + 上次点选处 → 区间统一置选/取消。 */
  function toggleAt(index: number, shift: boolean): void {
    const item = visible[index]
    if (!item || item.member !== 'none') return
    setSelected((prev) => {
      const next = new Set(prev)
      if (shift && lastIndex.current !== null) {
        const [a, b] = [lastIndex.current, index].sort((x, y) => x - y)
        const turnOn = !next.has(item.word)
        for (let i = a; i <= b; i++) {
          const w = visible[i]
          if (w?.member !== 'none') continue
          if (turnOn) next.add(w.word)
          else next.delete(w.word)
        }
      } else if (next.has(item.word)) {
        next.delete(item.word)
      } else {
        next.add(item.word)
      }
      return next
    })
    lastIndex.current = index
  }

  function toggleSelectAll(): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allState === 'on') selectable.forEach((w) => next.delete(w.word))
      else selectable.forEach((w) => next.add(w.word))
      return next
    })
  }

  /** 加入学习：选中的词就地翻成「已加入 · 未学习」，清空选择。若当前停在「未加入」段，加入的词随即从列表消失。 */
  function commit(): void {
    if (selected.size === 0) return
    setMembers((prev) => {
      const next = { ...prev }
      selected.forEach((w) => (next[w] = 'unlearned'))
      return next
    })
    setSelected(new Set())
    lastIndex.current = null
  }

  return (
    <div className="flex h-full flex-col">
      {/* 筛选 + 搜索 */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-200 px-4">
        <ToggleGroup value={filter} onValueChange={(v) => v && setFilter(v as Filter)}>
          <ToggleGroupItem value="all">全部</ToggleGroupItem>
          <ToggleGroupItem value="none">未加入</ToggleGroupItem>
          <ToggleGroupItem value="joined">已加入</ToggleGroupItem>
        </ToggleGroup>
        <div className="relative ml-auto w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索单词"
            className="h-9 rounded-lg pl-9"
          />
        </div>
      </header>

      {/* 词表 */}
      <main className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {/* 词数统计（对齐在学词表 WordList 的橙竖条） */}
        <div className="mb-1 flex items-center gap-2.5 px-3">
          <span className="h-4 w-[3px] rounded-full bg-fill-brand" />
          <span className="text-sm font-semibold tabular-nums text-text-primary">{visible.length} 词</span>
        </div>

        {visible.length === 0 ? (
          <p className="px-3 pt-12 text-center text-sm text-text-muted">
            {filter === 'none' ? '这里的词都加入词库了' : '没有匹配的单词'}
          </p>
        ) : (
          <ul className="flex flex-col">
            {visible.map((w, i) => (
              <PickRow
                key={w.word}
                word={w.word}
                ipa={w.ipa}
                sense={w.sense}
                member={w.member}
                checked={selected.has(w.word)}
                onToggle={(shift) => toggleAt(i, shift)}
              />
            ))}
          </ul>
        )}
      </main>

      {/* sticky 行动栏 */}
      <footer className="sticky bottom-0 z-10 flex shrink-0 items-center gap-4 bg-page-bg px-4 py-3">
        <button
          type="button"
          onClick={toggleSelectAll}
          disabled={selectable.length === 0}
          className="btn-squish group flex items-center gap-2 text-sm text-text-secondary disabled:opacity-40"
        >
          <PickBox state={allState === 'partial' ? 'partial' : allState === 'on' ? 'on' : 'off'} />
          全选未加入
        </button>
        <span className="ml-auto text-sm text-text-secondary">
          已选 <span className="font-semibold tabular-nums text-text-primary">{selected.size}</span> 词
        </span>
        <Button variant="brand" disabled={selected.size === 0} onClick={commit} className="gap-1.5">
          <Plus />
          加入学习
        </Button>
      </footer>
    </div>
  )
}

/** 单个词条行：未加入 = 可点勾选；已加入 = 不可点、挂全局状态徽标并淡化。 */
function PickRow({
  word,
  ipa,
  sense,
  member,
  checked,
  onToggle,
}: {
  word: string
  ipa: string
  sense: string
  member: Member
  checked: boolean
  onToggle: (shift: boolean) => void
}): React.JSX.Element {
  const owned = member !== 'none'
  const boxState: PickBoxState = owned ? 'owned' : checked ? 'on' : 'off'

  const inner = (
    <>
      <PickBox state={boxState} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn('truncate text-sm font-medium', owned ? 'text-text-secondary' : 'text-text-primary')}>
            {word}
          </span>
          <span className="shrink-0 text-xs text-text-muted">{ipa}</span>
        </div>
        <div className="truncate text-xs text-text-muted">{sense}</div>
      </div>
      {owned && <Badge variant={MEMBER_BADGE[member].variant}>{MEMBER_BADGE[member].label}</Badge>}
    </>
  )

  if (owned) {
    return (
      <li>
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">{inner}</div>
      </li>
    )
  }
  return (
    <li>
      <button
        type="button"
        onClick={(e) => onToggle(e.shiftKey)}
        className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-bg-300"
      >
        {inner}
      </button>
    </li>
  )
}

type PickBoxState = 'off' | 'on' | 'partial' | 'owned'

/** 自绘勾选框：off 空框 / on 黑底勾 / partial 黑底横杠 / owned 灰底勾（已在库、不可再选）。 */
function PickBox({ state }: { state: PickBoxState }): React.JSX.Element {
  if (state === 'off') {
    return <span className="size-5 shrink-0 rounded-md border-2 border-border-300 transition-colors group-hover:border-border-400" />
  }
  if (state === 'owned') {
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-md bg-bg-400 text-text-muted">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    )
  }
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-md bg-fill-primary text-on-primary">
      {state === 'partial' ? <Minus className="size-3.5" strokeWidth={3} /> : <Check className="size-3.5" strokeWidth={3} />}
    </span>
  )
}
