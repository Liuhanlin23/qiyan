import { cn } from '@/lib/cn'
import type { WordAudioColumns } from '@/lib/audio'
import type { DetailTab, MeaningSource, Word } from '@/types/word'
import { WordHeadline } from '@/components/word/WordHeadline'
import { PhoneticRow } from '@/components/word/PhoneticRow'
import { MeaningSourceToggle } from '@/components/word/MeaningSourceToggle'
import { WordActionBar } from '@/components/word/WordActionBar'
import { WordDetailBody } from '@/components/word/WordDetailBody'

/**
 * 词卡顶层组合件 —— WordHeadline + PhoneticRow + MeaningSourceToggle + WordActionBar（右上角）
 * + WordDetailBody，查词 / 单词本 / 学习三页共用同一形态：单词大字 + 英美切换 + 单行音标 +
 * 音标行右侧「中文 / 中英」来源下拉 + 释义 + 词形变化 + 详情 Tab，页面差异由 props 消化。
 *
 * 阅读页的划词精简卡（`DictPopup`）不用本组合件（它不要词形变化与详情 Tab、另有底部动作条），
 * 而是直接拼上面那几个子件——形态同源、繁简不同。
 *
 * - revealed=false（学习未揭晓）：主体加 blur-sm + pointer-events-none 模糊遮盖，点击卡片触发 onReveal。
 *
 * source / tab / accent / reveal 等状态全部受控，由使用方（页面）托管；本组件自身尽量无状态。
 * 动作栏（笔记 / 加入·移除学习 / 标掌握）通过 actionBar 开关 + 受控值/回调整体透传给 WordActionBar。
 */

interface WordCardProps {
  entry: Word

  // ═══ 视图态（全部受控，由页面管理）
  source: MeaningSource
  onChangeSource: (s: MeaningSource) => void
  tab: DetailTab
  onChangeTab: (t: DetailTab) => void

  // ═══ 音标与揭晓
  /** 当前音标口音 */
  accent?: 'uk' | 'us'
  onToggleAccent?: () => void
  /** 揭晓/显示详情内容（study 用；默认 true） */
  revealed?: boolean
  /** 未揭晓时点击卡片揭晓 */
  onReveal?: () => void
  /**
   * 释义块内「释义 → 词形变化」间距形态（透传给 WordDetailBody；additive，默认 'cozy' 即既有行为）。
   * 查词页传 'legacy' 以逐像素还原旧版 10px 间距。
   */
  inflectionSpacing?: 'cozy' | 'legacy'

  /**
   * 朗读回调（音标喇叭 / 英美切换 / 点词共用）：给定口音 'us'|'uk'。页面通常传
   * `(a) => playWordAudio(dictRow, a)`（CDN 真人音频，cache/dict.md §7）；不传（dict 行缺失）则静默。
   */
  onSpeak?: (accent: 'us' | 'uk') => void
  /**
   * 该词是否有可播音频（additive，默认 true 即既有行为），透传给音标行决定摆不摆发音键。
   * 页面按 dict 行判定（@/lib/audio 的 hasWordAudio）；缺行时连同 onSpeak 一起不传。
   */
  hasAudio?: boolean
  /**
   * 该词的音频 URL 三列（additive，透传给音标行让喇叭订阅播放态；不传则喇叭无动画）。
   * 页面直接把 dict 行递进来即可（列名已对齐 @/lib/audio 的 WordAudioColumns）。
   */
  audioRow?: WordAudioColumns

  // ═══ 标题配置
  /** 是否显示单词标题行（默认 true） */
  showWordHeadline?: boolean
  /** 点击单词的回调（默认 handleSpeak(accent)；study 需拦截冒泡时改传） */
  onWordClick?: () => void

  // ═══ ActionBar 配置（透传给 WordActionBar）
  /** 各按钮显隐开关 */
  actionBar?: {
    showNote?: boolean
    showLibrary?: boolean
    showMaster?: boolean
  }
  // 受控值与回调（透传给 WordActionBar）
  note?: string
  onNoteChange?: (value: string) => void
  noteMode?: 'popover' | 'dialog'
  noteOpen?: boolean
  onNoteOpenChange?: (open: boolean) => void

  inLibrary?: boolean
  onToggleLibrary?: () => void

  mastered?: boolean
  onMasterClick?: () => void

  // ═══ 自定义内容注入（透传给 WordActionBar）
  noteContent?: React.ReactNode

  /**
   * 释义主体与详情 Tab 之间的插槽（additive，透传给 WordDetailBody）。
   * 学习页在此注入揭晓后的「我的笔记」段落；仅在 revealed 时注入（未揭晓遮盖态不渲染）。
   */
  noteSlot?: React.ReactNode
  /**
   * 是否让词头 / 音标行 / 来源下拉在点击时 stopPropagation（additive，默认 false）。
   * 学习页把整张词卡包在「点击揭晓」容器里，这些子控件需拦截冒泡以免误揭晓。
   */
  stopClickPropagation?: boolean

  /** 根节点额外类名（用于消化 lookup 的 pt-2 等页面级微调，照搬现有 className） */
  className?: string
}

export function WordCard({
  entry,
  source,
  onChangeSource,
  tab,
  onChangeTab,
  accent = 'us',
  onToggleAccent,
  revealed = true,
  onReveal,
  inflectionSpacing = 'cozy',
  onSpeak,
  hasAudio = true,
  audioRow,
  showWordHeadline = true,
  onWordClick,
  actionBar,
  note,
  onNoteChange,
  noteMode = 'popover',
  noteOpen,
  onNoteOpenChange,
  inLibrary,
  onToggleLibrary,
  mastered,
  onMasterClick,
  noteContent,
  noteSlot,
  stopClickPropagation = false,
  className,
}: WordCardProps): React.JSX.Element {
  const collinsAvailable = entry.collinsEntries.length > 0

  // 动作栏是否有任何按钮：有则与单词并排（右上角），无则单词独占一行（study 顶栏另管动作）。
  const hasActionBar =
    !!actionBar && (actionBar.showNote || actionBar.showLibrary || actionBar.showMaster)

  // 朗读：页面注入 onSpeak（playWordAudio 走 CDN 真人音频）则用之；未注入（dict 行缺失）静默，不做 TTS 兜底。
  const handleSpeak = (a: 'us' | 'uk'): void => {
    onSpeak?.(a)
  }

  const headline = showWordHeadline ? (
    <WordHeadline
      word={entry.word}
      onWordClick={onWordClick ?? (() => handleSpeak(accent))}
      stopClickPropagation={stopClickPropagation}
    />
  ) : null

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* 词头：单词 + 右上角动作栏（有动作栏时并排；无则单词独占一行） */}
      {hasActionBar ? (
        <div className="flex items-start justify-between gap-3">
          {headline}
          <WordActionBar
            word={entry.word}
            showNote={actionBar?.showNote}
            noteValue={note}
            noteMode={noteMode}
            onNoteChange={onNoteChange}
            noteOpen={noteOpen}
            onNoteOpenChange={onNoteOpenChange}
            noteContent={noteContent}
            showLibrary={actionBar?.showLibrary}
            inLibrary={inLibrary}
            onToggleLibrary={onToggleLibrary}
            showMaster={actionBar?.showMaster}
            mastered={mastered}
            onMasterClick={onMasterClick}
          />
        </div>
      ) : (
        headline
      )}

      {/* 音标行：英美切换 + 单行音标 + 右侧「简明 / 柯林斯」来源下拉 */}
      <div className="flex items-center gap-2.5">
        <PhoneticRow
          phoneticUK={entry.phoneticUK}
          phoneticUS={entry.phoneticUS}
          accent={accent}
          onToggleAccent={onToggleAccent}
          // 有 locale（切换按钮传目标口音）用之，无（音标文字按钮）回落当前 accent。
          // 页面没给 onSpeak（dict 缺行）时原样不传，让音标行知道这词根本发不出声。
          onSpeak={onSpeak ? (locale) => handleSpeak(locale ? (locale === 'en-GB' ? 'uk' : 'us') : accent) : undefined}
          hasAudio={hasAudio}
          audioRow={audioRow}
          stopClickPropagation={stopClickPropagation}
        />
        <MeaningSourceToggle
          className="ml-auto"
          source={source}
          onChange={onChangeSource}
          collinsAvailable={collinsAvailable}
          stopClickPropagation={stopClickPropagation}
        />
      </div>

      {/* 主体：释义 + 词形 + 详情 Tab（来源切换已在音标行）。已揭晓时主体各段直接作为 gap-4
          根容器的子项（与三页一致的间距）；未揭晓（study）时另套模糊遮盖层，点击卡片揭晓。 */}
      {revealed ? (
        <WordDetailBody
          entry={entry}
          source={source}
          tab={tab}
          onChangeTab={onChangeTab}
          inflectionSpacing={inflectionSpacing}
          noteSlot={noteSlot}
        />
      ) : (
        <div
          className="flex flex-col gap-4 pointer-events-none select-none blur-sm transition-all duration-200"
          onClick={(e) => {
            e.stopPropagation()
            onReveal?.()
          }}
        >
          <WordDetailBody
            entry={entry}
            source={source}
            tab={tab}
            onChangeTab={onChangeTab}
            inflectionSpacing={inflectionSpacing}
            hideDetailTabs
          />
        </div>
      )}
    </div>
  )
}
