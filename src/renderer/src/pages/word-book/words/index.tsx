import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { TopBar } from '@/components/layout/TopBar'
import { BookHeader } from '../components/BookHeader'
import { useMasterDetailWordPage, WordMasterDetailBody } from '../components/MasterDetailWordPage'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import * as wordbook from '@/wordbook'
import type { WordSegment } from '@/wordbook'

/**
 * 我的词库 · 单词列表：桌面双栏（master-detail）。全宽顶栏 = 5 态滤镜 + 单词搜索框，
 * 左栏 = 该段词列表（WordList，按 dictId 选中），右栏 = 选中词的富词卡（loadWordCard 组装）。
 * 接 @/wordbook 门面：段列表走 listSegment / listAllWords，详情走 loadWordCard（读穿补缺 + 缺行占位），
 * 标熟/取消标熟走 master/unmaster（标熟二次确认），笔记走 notes 原语。口径见 feature/wordbook/words.md。
 * 壳层（选中/词卡/动作/顶栏）与今日页共用；深链 ?seg=/?dictId= 与 deepLinkPending 为本页独有。
 */

// ─────────────────────────── 5 态滤镜 ───────────────────────────

type SegmentKey = 'all' | 'new' | 'due' | 'learning' | 'mastered'

const SEGMENTS: { key: SegmentKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'new', label: '未学习' },
  { key: 'due', label: '待复习' },
  { key: 'learning', label: '记忆中' },
  { key: 'mastered', label: '已标熟' },
]

const SEGMENT_KEYS = SEGMENTS.map((s) => s.key)

/** 搜索防抖窗口：每击键直接触发一次带 JOIN 的 DB LIKE 查询过重，节流到停顿后再查（对齐查词页口径）。 */
const SEARCH_DEBOUNCE_MS = 250

/** UI 段 → 门面段（UI「记忆中」= 门面 memorizing）；'all' 走 listAllWords，无门面段。 */
const FACADE_SEGMENT: Record<Exclude<SegmentKey, 'all'>, WordSegment> = {
  new: 'new',
  due: 'due',
  learning: 'memorizing',
  mastered: 'mastered',
}

// ─────────────────────────── 根组件 ───────────────────────────

export default function MyWords(): React.JSX.Element {
  const [searchParams] = useSearchParams()
  // 深链：?seg= 预选段（首页「等待复习」带 seg=due）；?dictId= 预选词（笔记页跳转定位）。
  const initialSegment = (SEGMENT_KEYS as string[]).includes(searchParams.get('seg') ?? '')
    ? (searchParams.get('seg') as SegmentKey)
    : 'all'
  const initialDictId = Number(searchParams.get('dictId')) || null

  const [segment, setSegment] = useState<SegmentKey>(initialSegment)
  const [query, setQuery] = useState('')
  // 深链首次未命中（笔记指向非词库词）时不强跳首行、显空态；消费一次后恢复常规「落首行」。
  const deepLinkPending = useRef(initialDictId != null)

  // 段列表：随 segment / 搜索词变化重取（listAllWords for 'all'，否则 listSegment）。
  // 搜索词防抖：输入框即时回显 query（无卡顿），但 DB 查询只在停顿 250ms 后按 debouncedQuery 触发。
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS)
  const search = debouncedQuery.trim() || undefined
  const list = useAsyncData(
    () =>
      segment === 'all'
        ? wordbook.listAllWords({ search })
        : wordbook.listSegment(FACADE_SEGMENT[segment], { search }),
    [segment, search],
  )
  const rows = useMemo(() => list.data ?? [], [list.data])

  // 壳层：选中态 + 词卡加载 + 标熟/移除（reload 注入 list.reload）；选中词在可见 rows 解析、深链初值预选。
  const page = useMasterDetailWordPage({
    lookupRow: (id) => rows.find((r) => r.dictId === id) ?? null,
    reload: list.reload,
    initialSelectedId: initialDictId,
  })
  const { selectedId, setSelectedId } = page

  // 列表变化后校正选中：选中词不在当前段/无选中 → 落到首行。
  // 例外：首次深链未命中（笔记指向非词库词，词表只列词库词）不强跳，留空态、消费掉 pending。
  useEffect(() => {
    if (rows.length === 0) return
    if (selectedId != null && rows.some((r) => r.dictId === selectedId)) {
      deepLinkPending.current = false
      return
    }
    if (deepLinkPending.current) {
      deepLinkPending.current = false
      return
    }
    setSelectedId(rows[0].dictId)
  }, [rows, selectedId, setSelectedId])

  return (
    <div className="flex h-full flex-col">
      <TopBar segments={['单词本', '我的词库']} backTo="/wordbook" />
      {/* 全宽顶栏：5 态滤镜 + 单词搜索框 */}
      <BookHeader
        segments={SEGMENTS}
        segment={segment}
        onSegmentChange={setSegment}
        query={query}
        onQueryChange={setQuery}
      />
      <WordMasterDetailBody rows={rows} page={page} />
    </div>
  )
}
