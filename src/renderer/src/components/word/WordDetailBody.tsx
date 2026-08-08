import { cn } from '@/lib/cn'
import { Button, Separator } from '@/components/ui'
import type { DetailTab, Inflection, MeaningSource, Word } from '@/types/word'
import { playAudioUrl } from '@/lib/audio'
import { SpeakerIcon } from '@/components/common/SpeakerIcon'
import { Highlighted } from '@/components/word/Highlighted'
import { WordMeaning } from '@/components/word/WordMeaning'
import { EmptyState } from '@/components/common/EmptyState'

/**
 * 词卡「详情主体」：释义 + 词形变化 + 例句/派生/近义/词组 4 Tab。
 * 从三页逐字相同的详情主体抽取而来，以 WordDetail 版为蓝本（三版渲染一致）。
 * 视图态（释义来源 source、详情 tab）全量受控，由父组件托管；来源切换控件本身由
 * 词卡音标行承载（WordCard 的 `MeaningSourceToggle`），本组件只按 source 渲染对应释义
 * （渲染本身走 `WordMeaning`，与阅读精简卡同一份实现）。
 */

const DETAIL_TABS: { key: DetailTab; label: string }[] = [
  { key: 'example', label: '例句' },
  { key: 'derived', label: '派生' },
  { key: 'synonym', label: '近义' },
  { key: 'phrase', label: '词组' },
]

export function WordDetailBody({
  entry,
  source,
  tab,
  onChangeTab,
  inflectionSpacing = 'cozy',
  noteSlot,
  hideDetailTabs = false,
}: {
  entry: Word
  source: MeaningSource
  tab: DetailTab
  onChangeTab?: (t: DetailTab) => void
  /**
   * 释义块内「释义 → 词形变化」的间距形态（additive，默认 'cozy' 即既有行为，不影响已迁页）：
   * - 'cozy'：外层容器 gap-2.5 + Inflections mt-1（WordDetail / study，合计 14px）。
   * - 'legacy'：外层容器无 gap + Inflections mt-2.5（查词旧版的 10px，逐像素还原查词页）。
   */
  inflectionSpacing?: 'cozy' | 'legacy'
  /**
   * 释义块与详情 Tab 之间的插槽（additive，默认无）。学习页在此注入「我的笔记」段落
   * （含其自带的分隔线），逐像素还原旧版揭晓后的笔记区。
   */
  noteSlot?: React.ReactNode
  /**
   * 是否隐藏底部「分隔线 + 详情 Tab」（additive，默认 false 即既有行为）。学习页未揭晓时
   * 只模糊释义主体、不渲染详情 Tab，用此开关还原旧版遮盖态。
   */
  hideDetailTabs?: boolean
}): React.JSX.Element {
  const handleChangeTab = (t: DetailTab): void => onChangeTab?.(t)

  const legacyInflection = inflectionSpacing === 'legacy'

  return (
    <>
      {/* 释义 + 词形变化 */}
      <div className={cn('flex flex-col', legacyInflection ? 'gap-0' : 'gap-2.5')}>
        <WordMeaning entry={entry} source={source} />
        {entry.inflections.length > 0 && <Inflections items={entry.inflections} topMargin={legacyInflection ? 'mt-2.5' : 'mt-1'} />}
      </div>

      {/* 释义块与详情 Tab 之间的插槽（学习页「我的笔记」） */}
      {noteSlot}

      {/* 详情 Tab */}
      {!hideDetailTabs && (
        <>
          <Divider />
          <DetailTabs entry={entry} tab={tab} onChangeTab={handleChangeTab} />
        </>
      )}
    </>
  )
}

function Inflections({ items, topMargin = 'mt-1' }: { items: Inflection[]; topMargin?: string }): React.JSX.Element {
  return (
    <div className={cn('grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3', topMargin)}>
      {items.map((f) => (
        <div key={`${f.label}-${f.value}`} className="flex items-baseline gap-1.5 text-sm text-text-secondary">
          <span className="font-semibold">{f.label}</span>
          <span>{f.value}</span>
        </div>
      ))}
    </div>
  )
}

function DetailTabs({ entry, tab, onChangeTab }: { entry: Word; tab: DetailTab; onChangeTab: (t: DetailTab) => void }): React.JSX.Element {
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
      <div className="min-h-12">
        <TabContent entry={entry} tab={tab} />
      </div>
    </section>
  )
}

function TabContent({ entry, tab }: { entry: Word; tab: DetailTab }): React.JSX.Element {
  switch (tab) {
    case 'example':
      return entry.examples.length ? (
        <div className="flex flex-col gap-3.5">
          {entry.examples.map((ex, i) => {
            // 例句朗读播 dict 带的真人音频 URL（sentence-speech）；无音频的例句不出喇叭按钮，无 TTS。
            const { audioUrl } = ex
            return (
              <div key={i} className="flex items-start gap-2.5">
                <div className="flex flex-1 flex-col gap-1">
                  <Highlighted text={ex.english} className="text-base leading-relaxed text-text-primary" />
                  {ex.chinese && <Highlighted text={ex.chinese} className="text-sm leading-relaxed text-text-secondary" />}
                </div>
                {audioUrl && (
                  <Button variant="ghost" size="iconSm" aria-label="朗读例句" className="text-text-muted" onClick={() => void playAudioUrl(audioUrl)}>
                    <SpeakerIcon url={audioUrl} className="size-4" />
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <Empty />
      )
    case 'derived':
      return <TwoLineList items={entry.derived} />
    case 'phrase':
      return <TwoLineList items={entry.phraseGroup} />
    case 'synonym':
      return entry.synonymGroups.length ? (
        <div className="flex flex-col gap-4">
          {entry.synonymGroups.map((g, i) => (
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

function Empty(): React.JSX.Element {
  return <EmptyState title="暂无内容" />
}

function Divider(): React.JSX.Element {
  return <Separator className="bg-border-200" />
}
