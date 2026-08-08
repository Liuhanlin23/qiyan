import { useEffect, useMemo, useState } from 'react'
import { TopBar } from '@/components/layout/TopBar'
import { BookHeader } from '../components/BookHeader'
import { useMasterDetailWordPage, WordMasterDetailBody } from '../components/MasterDetailWordPage'
import { useAsyncData } from '@/hooks/useAsyncData'
import * as wordbook from '@/wordbook'

/**
 * 今日学习（单词本首页「今日已学」卡的落地页）：桌面双栏（master-detail），复用词表的 WordList + WordDetail。
 * 两段从复习日志推导（todaySegments，study.md 每日记账）：今日学习 = 今日有 pre_state=0 日志的词；
 * 今日复习 = 今日有日志且无 pre_state=0 日志的词。段成员按日志（append-only）固定，不受标熟影响；
 * 标熟只刷新词卡态。搜索按拼写前缀在当前段内过滤。壳层（选中/词卡/动作/顶栏）与词库页共用。
 */

type QueueSeg = 'learned' | 'reviewed'

const SEGMENTS: { key: QueueSeg; label: string }[] = [
  { key: 'learned', label: '今日学习' },
  { key: 'reviewed', label: '今日复习' },
]

export default function TodayLearn(): React.JSX.Element {
  const [segment, setSegment] = useState<QueueSeg>('learned')
  const [query, setQuery] = useState('')

  // 两段一次取（日志推导）；标熟后重取以刷新词卡态（段成员不变）。
  const today = useAsyncData(() => wordbook.todaySegments(), [])
  const segList = segment === 'learned' ? today.data?.learned : today.data?.reviewed

  // 当前段 + 搜索（前缀匹配，缺行 term=null 不参与命中）过滤出的可见行。
  const rows = useMemo(() => {
    const all = segList ?? []
    const q = query.trim().toLowerCase()
    return q === '' ? all : all.filter((r) => r.term?.toLowerCase().startsWith(q))
  }, [segList, query])

  // 壳层：选中态 + 词卡加载 + 标熟/移除（reload 注入 today.reload）；选中词跨两队列解析。
  const page = useMasterDetailWordPage({
    lookupRow: (id) =>
      today.data && id != null
        ? [...today.data.learned, ...today.data.reviewed].find((r) => r.dictId === id) ?? null
        : null,
    reload: today.reload,
  })
  const { selectedId, setSelectedId } = page

  // 页面常开跨 4:00 学习日边界后，只在挂载取一次的今日队列不会刷新（无 visibilitychange/focus 兜底）。
  // 1 分钟轮询学习日标识（门面复用 dayWindow 口径），跨界即重取两段刷新为新学习日；卸载清理 interval。
  useEffect(() => {
    let learningDay = wordbook.currentLearningDay()
    const timer = window.setInterval(() => {
      const next = wordbook.currentLearningDay()
      if (next !== learningDay) {
        learningDay = next
        void today.reload()
      }
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [today.reload])

  // 段/搜索变化后校正选中：无选中或选中不在可见段 → 落到首行。
  useEffect(() => {
    if (rows.length === 0) return
    if (selectedId == null || !rows.some((r) => r.dictId === selectedId)) {
      setSelectedId(rows[0].dictId)
    }
  }, [rows, selectedId, setSelectedId])

  return (
    <div className="flex h-full flex-col">
      <TopBar segments={['单词本', '今日学习']} backTo="/wordbook" />
      {/* 全宽顶栏：今日学习 / 今日复习 二段切换 + 搜索框 */}
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
