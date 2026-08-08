import { useCallback, useEffect, useRef, useState } from 'react'
import { SearchX, WifiOff } from 'lucide-react'
import type { Word, MeaningSource, DetailTab } from '@/types/word'
import { Button, ConfirmDialog } from '@/components/ui'
import { WordCard } from '@/components/word/WordCard'
import { useWordNote } from '@/hooks/useWordNote'
import { meaningSourceToDisplay, useSettings } from '@/hooks/useSettings'
import { hasWordAudio, playWordAudio } from '@/lib/audio'
import * as dict from '@/dict'
import type { LocalDictRow } from '@/dict'
import * as lookup from '@/lookup'
import { getSettings } from '@/settings'
import * as wordbook from '@/wordbook'

/**
 * 查词结果面板 —— 给一个词，查并展示三态。查词页与阅读页「完整词条」浮窗共用同一份实现
 * （docs/feature/reading/lookup.md §交互流程·浮层二）。
 *
 * 职责边界：**只管「词 → 结果」**。搜索栏、输入联想、查词历史列表都不在此——那是查词页自己的事；
 * 阅读页那侧则由取词逻辑给出 term。命中后记 `lookup_history` 在本组件内（两处都要记，见
 * lookup.md §附带动作），刷新历史列表则经 `onHit` 交回消费方。
 *
 * 换词时**保持上一次结果直到新结果到达**（复刻查词页既有行为，避免查 B 时先闪一下空白）；
 * 只有从未有过结果时才显示查询中占位。
 *
 * 词卡默认口音与释义来源取单词卡设置（docs/feature/wordcard.md），卡上就地切换不回写设置；
 * 查词命中**不**自动发音——自动发音只属学习页出卡。
 */

type Accent = 'uk' | 'us'

/** 查询结果三态（对齐 dict 门面读穿：命中 / 未收录 120002 / 不可用）。 */
type Result =
  | { kind: 'hit'; row: LocalDictRow; word: Word; inLibrary: boolean }
  | { kind: 'not-found'; term: string }
  | { kind: 'unavailable'; term: string }

export interface WordLookupPanelProps {
  /** 要查的词；空串不发请求。变化即重查。 */
  term: string
  /** 命中回调（历史已在内部记好，此处仅供消费方刷新自己的列表等）。 */
  onHit?: (row: LocalDictRow, word: Word) => void
  /**
   * 未收录态下追加的动作（阅读页在此塞「翻译这段」，lookup.md §浮层一）。
   * 不传则未收录态只有文案。
   */
  notFoundAction?: React.ReactNode
  /** 根节点额外类名。 */
  className?: string
}

export function WordLookupPanel({
  term,
  onHit,
  notFoundAction,
  className,
}: WordLookupPanelProps): React.JSX.Element | null {
  const [result, setResult] = useState<Result | null>(null)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)

  // 词卡视图态：换词时复位释义来源与 Tab（音标偏好保留，对齐查词页）。
  const [accent, setAccent] = useState<Accent>('us')
  const [source, setSource] = useState<MeaningSource>('simple')
  const [tab, setTab] = useState<DetailTab>('example')

  // 口音默认值对齐单词卡设置：settings 挂载后到达一次，此后用户手动切换不再被覆盖。
  const settings = useSettings()
  useEffect(() => {
    if (settings) setAccent(settings.accent)
  }, [settings])

  // 词笔记（绑 dictId、独立于是否入库）。
  const note = useWordNote(result?.kind === 'hit' ? result.row.dictId : null)

  // 竞态守卫：快速连查只认最后一次。
  const seqRef = useRef(0)
  // onHit 存 ref 再用：消费方多半传内联箭头函数，直接进 runLookup 的依赖数组会让它每次渲染都换引用，
  // 查询 effect 随之重跑 → setResult → 重渲染 → 再查，死循环。
  const onHitRef = useRef(onHit)
  useEffect(() => {
    onHitRef.current = onHit
  })

  /** 组装命中态：行 → 学习态（在库与否）→ Word 视图模型。 */
  const buildHit = async (row: LocalDictRow): Promise<Extract<Result, { kind: 'hit' }>> => {
    const states = await wordbook.getWordStates([row.dictId])
    const brief = states.get(row.dictId) ?? null
    return { kind: 'hit', row, word: wordbook.wordFromDictRow(row, brief), inLibrary: brief != null }
  }

  /**
   * 执行查询：dict 门面读穿三态分流。命中记历史（权威拼写 row.term，非用户输入）；
   * 未收录 / 不可用不记（lookup.md §3/§4）。
   */
  const runLookup = useCallback(
    async (raw: string): Promise<void> => {
      const q = raw.trim()
      if (!q) return
      const seq = ++seqRef.current
      // 释义来源每次查询直读设置：runLookup 是空依赖 useCallback，闭包看不见 settings state；
      // 与 dict.lookup 并发发起，设置读（一次 db IPC）永远不是长边，还免掉「首查早于 useSettings 到达」的竞态。
      const [res, s] = await Promise.all([dict.lookup(q), getSettings()])
      if (seq !== seqRef.current) return // 过期响应丢弃
      setSource(meaningSourceToDisplay(s.meaningSource))
      setTab('example')
      if (res.status === 'hit') {
        const hit = await buildHit(res.row)
        if (seq !== seqRef.current) return
        setResult(hit)
        // explain 取命中当时首条简义快照（供历史列表展示）；短语/无义为空串。
        await lookup.recordLookup(res.row.term, hit.word.simpleSenses[0] ?? '')
        onHitRef.current?.(res.row, hit.word)
      } else if (res.status === 'not-found') {
        setResult({ kind: 'not-found', term: q })
      } else {
        setResult({ kind: 'unavailable', term: q })
      }
    },
    [],
  )

  useEffect(() => {
    if (!term.trim()) {
      seqRef.current++ // 让在途结果过期，别把上一个词的结果落到空态上
      setResult(null)
      return
    }
    void runLookup(term)
  }, [term, runLookup])

  /** 加入 / 移除学习后刷新在库态（含学习态标签）。 */
  const refreshHit = async (): Promise<void> => {
    if (result?.kind !== 'hit') return
    const hit = await buildHit(result.row)
    setResult(hit)
  }

  const addWord = async (): Promise<void> => {
    if (result?.kind !== 'hit') return
    await wordbook.addWords([result.row.dictId])
    await refreshHit()
  }

  const removeWord = async (): Promise<void> => {
    if (result?.kind !== 'hit') return
    await wordbook.removeWord(result.row.dictId)
    await refreshHit()
  }

  // 还没有过任何结果 = 首次查询在途：给个占位，别渲染空白。
  if (result == null) return term.trim() ? <Pending className={className} /> : null

  return (
    <>
      {result.kind === 'hit' ? (
        <WordCard
          entry={result.word}
          className={className}
          inflectionSpacing="legacy"
          accent={accent}
          source={source}
          tab={tab}
          onToggleAccent={() => setAccent((a) => (a === 'uk' ? 'us' : 'uk'))}
          onSpeak={(a) => void playWordAudio(result.row, a)}
          hasAudio={hasWordAudio(result.row)}
          audioRow={result.row}
          onChangeSource={setSource}
          onChangeTab={setTab}
          actionBar={{ showNote: true, showLibrary: true }}
          note={note.note}
          onNoteChange={note.update}
          noteMode="dialog"
          inLibrary={result.inLibrary}
          onToggleLibrary={() => {
            if (result.inLibrary) setConfirmRemoveOpen(true)
            else void addWord()
          }}
        />
      ) : result.kind === 'not-found' ? (
        <NotFound term={result.term} action={notFoundAction} className={className} />
      ) : (
        <Unavailable
          term={result.term}
          className={className}
          onRetry={() => void runLookup(result.term)}
        />
      )}

      <ConfirmDialog
        open={confirmRemoveOpen}
        onOpenChange={setConfirmRemoveOpen}
        title={`把「${result.kind === 'hit' ? result.word.word : ''}」移出词库？`}
        description="该词连同学习进度将一并移出词库、退出所有学习 / 复习队列。之后可在选词页重新加入（从头开始学）。"
        confirmText="移除学习"
        confirmVariant="danger"
        onConfirm={() => void removeWord()}
      />
    </>
  )
}

// ─────────────────────────── 查询中（仅首次，无旧结果可留） ───────────────────────────

function Pending({ className }: { className?: string }): React.JSX.Element {
  return (
    <div className={className}>
      <p className="pt-16 text-center text-sm text-text-muted">查询中…</p>
    </div>
  )
}

// ─────────────────────────── 未收录 ───────────────────────────

function NotFound({
  term,
  action,
  className,
}: {
  term: string
  action?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={className}>
      <div className="flex flex-col items-center gap-3 pt-16 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-bg-neutral-chip">
          <SearchX className="size-6 text-text-muted" />
        </div>
        <p className="text-base text-text-primary">
          未收录「<span className="font-semibold">{term}</span>」
        </p>
        {action}
      </div>
    </div>
  )
}

// ─────────────────────────── 不可用（离线 / 服务错误） ───────────────────────────

function Unavailable({
  term,
  onRetry,
  className,
}: {
  term: string
  onRetry: () => void
  className?: string
}): React.JSX.Element {
  return (
    <div className={className}>
      <div className="flex flex-col items-center gap-3 pt-16 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-bg-neutral-chip">
          <WifiOff className="size-6 text-text-muted" />
        </div>
        <p className="text-base text-text-primary">
          查询「<span className="font-semibold">{term}</span>」失败，请检查网络后重试
        </p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    </div>
  )
}
