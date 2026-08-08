import { useEffect, useState } from 'react'
import { WordList } from './WordList'
import { WordDetail, EmptyDetail } from './WordDetail'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useWordNote } from '@/hooks/useWordNote'
import { meaningSourceToDisplay, useSettings } from '@/hooks/useSettings'
import { hasWordAudio, playWordAudio } from '@/lib/audio'
import * as wordbook from '@/wordbook'
import type { WordListItem } from '@/wordbook'
import type { DetailTab, MeaningSource } from '@/types/word'

/**
 * 单词本双栏（master-detail）壳层：今日页 / 词库页共用的「选中态 + 词卡加载 + 标熟/移除动作」。
 * 数据层（段取数、rows 推导、选中校正、深链）两页真实不同，留在各页；本 hook 只收口逐字相同的壳。
 * - lookupRow：调用方按各自数据源把 selectedId 解析成行（今日跨两队列找，词库在可见 rows 找）。
 * - reload：标熟/移除后要重取的取数（今日 today.reload、词库 list.reload），由调用方注入。
 * 选中态由本 hook 持有：setSelectedId 暴露给各页的校正 effect；点选 selectWord 额外复位来源 / Tab。
 */
export function useMasterDetailWordPage({
  lookupRow,
  reload,
  initialSelectedId = null,
}: {
  lookupRow: (id: number | null) => WordListItem | null
  reload: () => Promise<void>
  initialSelectedId?: number | null
}) {
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedId)

  // 设置驱动的词卡默认：释义来源、口音（加载 / 换词后对齐，仍可手动切换）。
  const settings = useSettings()
  const defaultSource = meaningSourceToDisplay(settings?.meaningSource)
  const [source, setSource] = useState<MeaningSource>('simple')
  const [accent, setAccent] = useState<'uk' | 'us'>('us')
  const [tab, setTab] = useState<DetailTab>('example')
  useEffect(() => setSource(defaultSource), [defaultSource])
  useEffect(() => {
    if (settings) setAccent(settings.accent)
  }, [settings])

  const selectedRow = lookupRow(selectedId)

  // 附本次加载归属的 dictId：换词后旧词卡未落地前，渲染侧据此判归属，不复用旧词面（T3 防串卡）。
  const card = useAsyncData(() => {
    if (!selectedRow) return Promise.resolve(null)
    const forDictId = selectedRow.dictId
    return wordbook.loadWordCard(selectedRow).then((data) => ({ ...data, forDictId }))
  }, [selectedRow?.dictId, selectedRow?.state, selectedRow?.due])
  const note = useWordNote(selectedId)

  function selectWord(dictId: number): void {
    setSelectedId(dictId)
    setSource(defaultSource)
    setTab('example')
  }

  /** 标熟 ⇄ 取消（确认由 WordDetail 自持）：按当前态 master/unmaster，改后重取以刷新词卡态 / 段成员。 */
  async function toggleMastered(): Promise<void> {
    if (selectedId == null || !selectedRow) return
    await (selectedRow.state === 4 ? wordbook.unmaster(selectedId) : wordbook.master(selectedId))
    await reload()
  }

  /** 移出词库（确认由 WordDetail 自持）：置墓碑后重取（今日段按日志固定、落占位 / 换选中，词库段成员增减）。 */
  async function removeFromLibrary(): Promise<void> {
    if (selectedId == null) return
    await wordbook.removeWord(selectedId)
    await reload()
  }

  return {
    selectedId,
    setSelectedId,
    selectedRow,
    selectWord,
    source,
    tab,
    accent,
    setSource,
    setTab,
    toggleAccent: () => setAccent((a) => (a === 'uk' ? 'us' : 'uk')),
    card,
    note,
    onToggleMastered: () => void toggleMastered(),
    onRemove: () => void removeFromLibrary(),
  }
}

export type MasterDetailWordPage = ReturnType<typeof useMasterDetailWordPage>

/**
 * 双栏主体（左词表 + 右词卡）：今日页 / 词库页共用。选中词加载完且归属一致才渲染词卡，否则空态。
 * rows 由各页按自己的数据层算好传入；其余交互全走 page（useMasterDetailWordPage 的返回）。
 */
export function WordMasterDetailBody({
  rows,
  page,
}: {
  rows: WordListItem[]
  page: MasterDetailWordPage
}): React.JSX.Element {
  const {
    selectedId,
    selectedRow,
    selectWord,
    source,
    tab,
    accent,
    setSource,
    setTab,
    toggleAccent,
    card,
    note,
    onToggleMastered,
    onRemove,
  } = page
  return (
    <div className="flex min-h-0 flex-1">
      {/* 左栏：当前段单词列表 */}
      <WordList words={rows} selectedId={selectedId} onSelect={selectWord} />

      {/* 右栏：单词详情（常驻） */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {selectedRow && card.data && card.data.forDictId === selectedRow.dictId ? (
          <div className="mx-auto max-w-2xl px-8 py-6">
            <WordDetail
              entry={card.data.word}
              source={source}
              tab={tab}
              note={note.note}
              accent={accent}
              onToggleAccent={toggleAccent}
              onSpeak={card.data.dictRow ? (a) => void playWordAudio(card.data!.dictRow!, a) : undefined}
              hasAudio={!!card.data.dictRow && hasWordAudio(card.data.dictRow)}
              audioRow={card.data.dictRow ?? undefined}
              onChangeSource={setSource}
              onChangeTab={setTab}
              onToggleMastered={onToggleMastered}
              onRemove={onRemove}
              onChangeNote={note.update}
            />
          </div>
        ) : (
          <EmptyDetail />
        )}
      </main>
    </div>
  )
}
