import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui'
import { LOOKUP_MAX_WORDS, type LookupTermVerdict } from '@/reading'
import type { MeaningSource, Word } from '@/types/word'
import { hasWordAudio, playWordAudio } from '@/lib/audio'
import { WordHeadline } from '@/components/word/WordHeadline'
import { PhoneticRow } from '@/components/word/PhoneticRow'
import { MeaningSourceToggle } from '@/components/word/MeaningSourceToggle'
import { WordMeaning } from '@/components/word/WordMeaning'
import { meaningSourceToDisplay, useSettings } from '@/hooks/useSettings'
import * as dict from '@/dict'
import type { LocalDictRow } from '@/dict'
import { DEFAULT_SETTINGS } from '@/settings'
import * as wordbook from '@/wordbook'
import { useViewportAnchor } from './useViewportAnchor'

/**
 * 划词查词的精简卡 —— 点标注工具栏「查词」后贴选区浮出的独立弹层（docs/feature/reading/lookup.md
 * §浮层一）。与 `TranslatorPopup` 是姊妹件：同宽、同锚点机制、同收弹层机制。
 *
 * 卡面是**词卡的缩排版**，直接拼词卡那几个子件（`WordHeadline` size=sm + `PhoneticRow` +
 * `MeaningSourceToggle` + `WordMeaning`），三页词卡与本卡的词头 / 音标 / 释义形态同源；
 * 词形变化、例句 / 派生 / 近义 / 词组与笔记不进本卡，走「查看完整词条」由宿主浮出完整词条窗。
 * 中文释义截断 3 条、释义区限高滚动，免得贴着正文的卡片长到遮挡阅读。
 *
 * 口音与释义来源的默认值随单词卡设置（docs/feature/wordcard.md），就地切换只影响本卡、不回写设置；
 * 音标单侧钉死由 `PhoneticRow` 保证。命中**不**自动发音——阅读侧自动响还会经片段互斥打断 TTS 朗读。
 *
 * **查不到就降级到翻译**：未收录与「选得太长」两态的主动作都是「翻译这段」——短语查不中时用户
 * 真正想要的就是翻译，不该让他关掉弹层重新划词再点翻译。
 *
 * 收弹层由宿主 SelectionAnnotator 统一管（点书页空白 / 点浮层外 / Esc），故带 `data-annotation-layer`
 * 豁免「点外面就收」，自身不设关闭按钮。
 */

export interface DictPopupProps {
  /** 查询词：引擎侧已清洗（`EngineSelection.lookupTerm`）。 */
  term: string
  /** 取词判定：`ok` 正常查；`too-long` 直接给降级态、**不发请求**（别拿整段正文去打有道）。 */
  verdict: Extract<LookupTermVerdict, 'ok' | 'too-long'>
  /** 锚点 x：选区水平中点。 */
  x: number
  /** 锚点 y：选区下沿。 */
  y: number
  /** 选区高度：浮层翻到上方时据此让开选中的字。 */
  height: number
  /** 点「翻译这段」：切到翻译框（未收录 / 太长时的主动作）。 */
  onTranslate: () => void
  /** 点「查看完整词条」：由宿主浮出完整词条窗。 */
  onOpenFull: () => void
  /**
   * 暂时藏起来（完整词条窗盖在上面时）：两层浮层同时只露一层，但本卡**保持挂载**——
   * 卸载再挂回会重跑一遍查询，关掉完整词条退回时白闪一下「查询中…」。
   */
  hidden?: boolean
}

/** 精简卡内部态：查询中 / 命中 / 未收录 / 不可用 / 选得太长（不查）。 */
type State =
  | { kind: 'loading' }
  | { kind: 'hit'; row: LocalDictRow; word: Word; inLibrary: boolean }
  | { kind: 'not-found' }
  | { kind: 'unavailable' }
  | { kind: 'too-long' }

/** 精简卡里展示的中文（简明）释义条数上限；中英释义不截断，靠释义区限高滚动收住。 */
const SENSE_LIMIT = 3

export function DictPopup({
  term,
  verdict,
  x,
  y,
  height,
  onTranslate,
  onOpenFull,
  hidden = false,
}: DictPopupProps): React.JSX.Element {
  const { ref, left, top } = useViewportAnchor<HTMLDivElement>(x, y, height)
  const [state, setState] = useState<State>(verdict === 'too-long' ? { kind: 'too-long' } : { kind: 'loading' })
  // 「重试」的重跑闸：词没变，只靠改 state 不会重新触发查询 effect，得有个自增值进依赖。
  const [retry, setRetry] = useState(0)

  // 词卡视图态：默认取单词卡设置，卡上就地切换只影响本卡、不回写设置（docs/feature/wordcard.md）。
  // 设置未读回前按注册表默认值，读回后同步一次即对齐；此后用户手动切换不再被覆盖。
  // 宿主以 term 作 key，换词即重挂 —— 故两项每次浮出都从设置默认值起步。
  const [accent, setAccent] = useState<'us' | 'uk'>(DEFAULT_SETTINGS.accent)
  const [source, setSource] = useState<MeaningSource>(meaningSourceToDisplay(DEFAULT_SETTINGS.meaningSource))
  const settings = useSettings()
  useEffect(() => {
    if (!settings) return
    setAccent(settings.accent)
    setSource(meaningSourceToDisplay(settings.meaningSource))
  }, [settings])

  // 查词 + 取在库态。alive 守卫：换词时上一趟在途结果不覆盖新态。
  useEffect(() => {
    if (verdict === 'too-long') {
      setState({ kind: 'too-long' })
      return
    }
    let alive = true
    setState({ kind: 'loading' })
    void (async () => {
      const res = await dict.lookup(term)
      if (!alive) return
      if (res.status !== 'hit') {
        setState({ kind: res.status === 'not-found' ? 'not-found' : 'unavailable' })
        return
      }
      const states = await wordbook.getWordStates([res.row.dictId])
      if (!alive) return
      const brief = states.get(res.row.dictId) ?? null
      setState({
        kind: 'hit',
        row: res.row,
        word: wordbook.wordFromDictRow(res.row, brief),
        inLibrary: brief != null,
      })
    })()
    return () => {
      alive = false
    }
  }, [term, verdict, retry])

  /** 加入学习后刷新在库态（精简卡只做「加入」，移除留给完整词条那侧的动作栏）。 */
  const addWord = async (): Promise<void> => {
    if (state.kind !== 'hit') return
    await wordbook.addWords([state.row.dictId])
    setState({ ...state, inLibrary: true })
  }

  return (
    <div
      ref={ref}
      // 宿主「点浮层外面就收」靠这个标记豁免浮层自身（见 SelectionAnnotator）。
      data-annotation-layer=""
      className={cn(
        'anim-pop fixed z-50 w-[380px] -translate-x-1/2 select-text rounded-card bg-surface-3 text-text-primary shadow-popover',
        hidden && 'invisible',
      )}
      style={{ left, top }}
      onMouseDown={(e) => e.preventDefault()} // 别让点浮层清掉选区
    >
      {state.kind === 'hit' ? (
        <Hit
          row={state.row}
          word={state.word}
          inLibrary={state.inLibrary}
          accent={accent}
          onToggleAccent={() => setAccent((a) => (a === 'uk' ? 'us' : 'uk'))}
          source={source}
          onChangeSource={setSource}
          onAdd={() => void addWord()}
          onOpenFull={onOpenFull}
        />
      ) : (
        <div className="px-4 py-3.5">
          {state.kind === 'loading' && (
            <p className="text-[15px] leading-relaxed text-text-muted">查询中…</p>
          )}

          {state.kind === 'not-found' && (
            <>
              <p className="text-[15px] leading-relaxed text-text-primary">
                未收录「<span className="font-semibold">{term}</span>」
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
                词典里没有这个词条。若选的是一句话，用翻译更合适。
              </p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={onTranslate}>
                翻译这段
              </Button>
            </>
          )}

          {state.kind === 'too-long' && (
            <>
              <p className="text-[15px] leading-relaxed text-text-primary">选得太长</p>
              <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
                查词最多 {LOOKUP_MAX_WORDS} 个词，整句请用翻译。
              </p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={onTranslate}>
                翻译这段
              </Button>
            </>
          )}

          {state.kind === 'unavailable' && (
            <>
              <p className="text-[15px] leading-relaxed text-text-primary">需要联网才能查词</p>
              <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
                本地没有这个词的缓存，请检查网络后重试。
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => setRetry((n) => n + 1)}
              >
                重试
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** 命中态：词头 / 音标行 + 释义来源切换 / 释义 / 底部动作。形态 = 词卡的缩排版。 */
function Hit({
  row,
  word,
  inLibrary,
  accent,
  onToggleAccent,
  source,
  onChangeSource,
  onAdd,
  onOpenFull,
}: {
  row: LocalDictRow
  word: Word
  inLibrary: boolean
  /** 当前口音（双侧音标俱全时生效；单侧由 PhoneticRow 钉死在有的那侧）。 */
  accent: 'us' | 'uk'
  onToggleAccent: () => void
  source: MeaningSource
  onChangeSource: (s: MeaningSource) => void
  onAdd: () => void
  onOpenFull: () => void
}): React.JSX.Element {
  // 无音频 URL 就不摆发音键（全端无 TTS，cache/dict.md §7）——一个按不响的键更糟。
  const hasAudio = hasWordAudio(row)

  return (
    <>
      <div className="flex flex-col gap-2.5 px-4 pt-3.5">
        {/* 点词头朗读走当前口音本身（与三页词卡同款行为，不过音标的钉死规则）。 */}
        <WordHeadline size="sm" word={word.word} onWordClick={() => void playWordAudio(row, accent)} />

        {/* 音标行（英美切换 / 单侧钉死 / 两侧全无退化成喇叭，规则全在 PhoneticRow 内）+ 来源下拉 */}
        <div className="flex items-center gap-2.5">
          <PhoneticRow
            phoneticUK={word.phoneticUK}
            phoneticUS={word.phoneticUS}
            accent={accent}
            onToggleAccent={onToggleAccent}
            // 有 locale（切换按钮传目标口音）用之，无（音标文字按钮）回落当前 accent —— 同 WordCard。
            onSpeak={(locale) => void playWordAudio(row, locale ? (locale === 'en-GB' ? 'uk' : 'us') : accent)}
            hasAudio={hasAudio}
            audioRow={row}
          />
          <MeaningSourceToggle
            className="ml-auto"
            source={source}
            onChange={onChangeSource}
            collinsAvailable={word.collinsEntries.length > 0}
          />
        </div>
      </div>

      {/* 释义：紧凑字号档；中文截断 SENSE_LIMIT 条，中英（带例句）靠限高滚动兜住——卡片不该长到遮挡正文。 */}
      <div className="mt-3 max-h-[40vh] overflow-y-auto px-4">
        <WordMeaning entry={word} source={source} simpleLimit={SENSE_LIMIT} size="compact" />
      </div>

      <div className="mx-4 my-3 h-px bg-border-300" />

      <div className="flex items-center justify-between gap-2 px-4 pb-3">
        {inLibrary ? (
          <span className="text-xs text-text-muted">已在学习中</span>
        ) : (
          <Button variant="secondary" size="sm" onClick={onAdd}>
            加入学习
          </Button>
        )}
        <button
          type="button"
          onClick={onOpenFull}
          className="btn-squish shrink-0 text-xs text-text-muted transition-colors hover:text-text-secondary"
        >
          查看完整词条
        </button>
      </div>
    </>
  )
}
