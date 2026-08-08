import { useState } from 'react'
import type { DetailTab, MeaningSource, Word } from '@/types/word'
import type { WordAudioColumns } from '@/lib/audio'
import { WordCard } from '@/components/word/WordCard'
import { EmptyState } from '@/components/common/EmptyState'
import { ConfirmDialog } from '@/components/ui'

/**
 * 单词本右栏词卡 —— master-detail 的「detail」：现由共享 `WordCard` 渲染。
 * 与「开始学习」词卡同一形态（单词大字 + 英美切换 + 单行音标 +
 * 音标行右侧「简明 / 柯林斯」来源下拉 + 释义 + 词形变化 + 5 Tab），全局唯一一种词卡；本页只是
 * 少了开始学习底部的「不认识 / 模糊 / 认识」评分条。右上角动作栏 = 笔记 + 更多(⋯)，「⋯」内含
 * 标记掌握/取消标熟（全局生效，study.md）与 移除学习（词恒在库，故只出「移除」）。标熟与移除学习均为
 * 破坏性（标熟退出所有队列；移除学习连学习进度一并置墓碑），本组件各自持二次确认；取消标熟即时。
 * 词表页 / 今日页共用这两个确认，父页 onToggleMastered / onRemove 只需按当前态执行 master/unmaster / removeWord。
 * 本页只保留编排：持有视图态（source / tab）与笔记 / 标熟 / 移除的值与回调；换词时由父页复位
 * source / tab，英美口音（accent）为本卡本地态、跨词保持。
 */

export function WordDetail({
  entry,
  source,
  tab,
  note,
  accent,
  onToggleAccent,
  onSpeak,
  hasAudio,
  audioRow,
  onChangeSource,
  onChangeTab,
  onToggleMastered,
  onRemove,
  onChangeNote,
}: {
  entry: Word
  source: MeaningSource
  tab: DetailTab
  note: string
  /** 当前音标口音（父页托管，初值取设置 accent、跨词保持）。 */
  accent: 'uk' | 'us'
  onToggleAccent: () => void
  /** 朗读回调（父页注入 playWordAudio 走 CDN 真人音频；缺行时不传，词卡静默）。 */
  onSpeak?: (accent: 'us' | 'uk') => void
  /** 该词有无可播音频（父页按 dict 行判定）；无则词卡不摆发音键。 */
  hasAudio?: boolean
  /** 该词的音频 URL 三列（父页递 dict 行）：喇叭据此订阅播放态出动画；缺行时不传。 */
  audioRow?: WordAudioColumns
  onChangeSource: (s: MeaningSource) => void
  onChangeTab: (t: DetailTab) => void
  /** 切换标熟态：由父页按当前 state 执行 master（标熟）/ unmaster（取消）+ 刷新。 */
  onToggleMastered: () => void
  /** 移出词库：由父页执行 removeWord + 刷新列表（移除后该词从段内消失，选中自动落下一行）。 */
  onRemove: () => void
  onChangeNote: (v: string) => void
}): React.JSX.Element {
  const mastered = entry.state === 'mastered'
  // 标熟二次确认（仅「标熟」方向；取消标熟即时）。
  const [confirmOpen, setConfirmOpen] = useState(false)
  // 移除学习二次确认（破坏性：连学习进度一并置墓碑）。
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)

  const handleMasterClick = (): void => {
    if (mastered) onToggleMastered()
    else setConfirmOpen(true)
  }
  
  return (
    <>
      <WordCard
        entry={entry}
        inflectionSpacing="legacy"
        accent={accent}
        onToggleAccent={onToggleAccent}
        onSpeak={onSpeak}
        hasAudio={hasAudio}
        audioRow={audioRow}
        source={source}
        onChangeSource={onChangeSource}
        tab={tab}
        onChangeTab={onChangeTab}
        actionBar={{ showNote: true, showMaster: true, showLibrary: true }}
        note={note}
        onNoteChange={onChangeNote}
        noteMode="dialog"
        mastered={mastered}
        onMasterClick={handleMasterClick}
        inLibrary
        onToggleLibrary={() => setConfirmRemoveOpen(true)}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`标记「${entry.word}」为已掌握？`}
        description="标熟后该词全局生效、不再进入任何学习 / 复习队列。之后可在「已标熟」段取消标熟。"
        confirmText="标记掌握"
        confirmVariant="primary"
        onConfirm={onToggleMastered}
      />

      <ConfirmDialog
        open={confirmRemoveOpen}
        onOpenChange={setConfirmRemoveOpen}
        title={`把「${entry.word}」移出词库？`}
        description="该词连同学习进度将一并移出词库、退出所有学习 / 复习队列。之后可在选词页重新加入（从头开始学）。"
        confirmText="移除学习"
        confirmVariant="danger"
        onConfirm={onRemove}
      />
    </>
  )
}

/** 右栏空态：未选中单词时的占位提示（列表为空或尚未点选）。 */
export function EmptyDetail(): React.JSX.Element {
  return <EmptyState variant="detail" title="从左侧选择一个单词查看详情" />
}
