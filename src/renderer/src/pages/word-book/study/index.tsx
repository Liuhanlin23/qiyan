import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookPlus, Layers } from 'lucide-react'
import { WordCard } from '@/components/word/WordCard'
import type { DetailTab, MeaningSource } from '@/types/word'
import { Button, Card, ConfirmDialog, Separator } from '@/components/ui'
import { NoteDialog } from '@/components/word/NoteDialog'
import { PracticeTopBar } from './components/PracticeTopBar'
import { RatingBar, type RatingKey } from './components/RatingBar'
import { FinishedView } from './components/FinishedView'
import * as wordbook from '@/wordbook'
import type { ExtraCounts, ExtraKind, QueueKind, StudyCard } from '@/wordbook'
import { getSettings } from '@/settings'
import type { Settings } from '@/settings'
import type { ExtraGroupSizes } from '@/wordbook'
import { hasWordAudio, playWordAudio, resolveShownAccent } from '@/lib/audio'
import { meaningSourceToDisplay } from '@/hooks/useSettings'

/**
 * 开始学习：接 @/wordbook 会话（startTodaySession / nextCard / rate / master / extraGroup）——
 * 揭晓式 active recall + 顶栏今日剩余三计数（会话队列派生，出卡前刷新）/ 笔记 / 标熟 + 底部三档评分（真实间隔预览）+
 * 完成态再学一组三选项。评分计时 = 出示 → 提交（durationMs）；评分后按会话规则出下一张（含分钟级步回插）。
 * 自动发音：出示单词时按设置播放所选口音的真人音频（无法播放则静默）。跨次日 4:00（stale）即整队重建。
 *
 * 词卡主体由共享 WordCard（未揭晓 blur 遮盖）渲染；本页只保留会话编排与视图态。
 */

type Status = 'loading' | 'studying' | 'finished' | 'empty'
type Accent = 'uk' | 'us'

const RATING_VALUE: Record<RatingKey, number> = { again: 1, hard: 2, good: 3 }

interface Current extends StudyCard {
  dictId: number
  /** 当前卡所属类别（顶栏对应数字下划线高亮，study.md「学习页顶栏」）。 */
  kind: QueueKind
  /** 出示时刻（评分时算 durationMs）。 */
  shownAt: number
}

export default function WordStudy(): React.JSX.Element {
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>('loading')
  const [current, setCurrent] = useState<Current | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [tab, setTab] = useState<DetailTab>('example')
  const [accent, setAccent] = useState<Accent>('us')
  const [source, setSource] = useState<MeaningSource>('simple')

  // 顶栏三计数「今天还剩」（study.md「学习页顶栏」）：即时从会话队列派生（sessionCounts），每次出卡前刷新。
  const [progress, setProgress] = useState({ new: 0, learning: 0, review: 0 })

  const [finishData, setFinishData] = useState<{ counts: ExtraCounts; sizes: ExtraGroupSizes } | null>(null)

  const [note, setNote] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [masterOpen, setMasterOpen] = useState(false)
  // 在途锁：评分/标熟/再学一组期间禁止重入 advance（防连点连跳卡、竞态重复落库）。ref 挡同步双击，state 禁按钮。
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const settingsRef = useRef<Settings | null>(null)

  // 取下一张并载入：stale 重建、done 收尾、缺行/被删跳过（循环避免深递归）。
  const advance = useCallback(async (): Promise<void> => {
    for (;;) {
      // 出卡前读一次三计数（§2.4）：顶栏永远含屏幕上这张卡，与当前卡出自同一快照；评分/标熟/跳卡各路径无需再单独刷新。
      setProgress(wordbook.sessionCounts())
      const next = wordbook.nextCard()
      if (next.kind === 'stale') {
        await wordbook.startTodaySession()
        continue
      }
      if (next.kind === 'done') {
        const [counts, sizes, seg] = await Promise.all([
          wordbook.extraCounts(),
          wordbook.getGroupSizes(),
          wordbook.segmentCounts(),
        ])
        setCurrent(null)
        // 词库无未学词 且 无可复习/提前 → 引导选词；否则今日计划完成 → 再学一组。
        if (seg.new === 0 && counts.learn === 0 && counts.review === 0 && counts.ahead === 0) {
          setStatus('empty')
        } else {
          setFinishData({ counts, sizes })
          setStatus('finished')
        }
        return
      }
      const card = await wordbook.loadStudyCard(next.dictId)
      if (!card) {
        // 缺行/被删 → 从会话丢弃再取下一张（否则分钟级步该卡会被 nextCard 反复返回，死循环）。
        wordbook.skipCard(next.dictId)
        continue
      }
      setCurrent({ ...card, dictId: next.dictId, kind: next.cardKind, shownAt: Date.now() })
      setRevealed(false)
      setTab('example')
      setSource(meaningSourceToDisplay(settingsRef.current?.meaningSource))
      setStatus('studying')
      setNote((await wordbook.getNote(next.dictId)) ?? '')
      // 自动发音（出示单词即播真人音频，active recall；无法播放则静默）。
      // 口音过钉死规则，判据取卡面同一份 word 音标：单侧音标的词播的就是显示的那一侧。
      const s = settingsRef.current
      if (s?.autoPlayAudio) {
        const accent = resolveShownAccent(
          { hasUS: !!card.word.phoneticUS, hasUK: !!card.word.phoneticUK },
          s.accent,
        )
        void playWordAudio(card.dictRow, accent)
      }
      return
    }
  }, [])

  // 进入学习页：读设置 → 建今日会话 → 出第一张（顶栏三计数在 advance 出卡前刷新）。
  useEffect(() => {
    let alive = true
    void (async () => {
      const s = await getSettings()
      if (!alive) return
      settingsRef.current = s
      setAccent(s.accent)
      await wordbook.startTodaySession()
      if (!alive) return
      await advance()
    })()
    return () => {
      alive = false
    }
  }, [advance])

  const reveal = useCallback(() => setRevealed(true), [])

  /** 评分：算 durationMs（出示→提交）→ 门面 rate（会话内回插/丢弃由门面处理）→ 下一张（顶栏三计数在 advance 出卡前刷新）。在途锁防连点连跳。 */
  async function rate(key: RatingKey): Promise<void> {
    if (!current || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const durationMs = Date.now() - current.shownAt
      await wordbook.rate({
        dictId: current.dictId,
        rating: RATING_VALUE[key],
        durationMs,
        snapshotReps: current.record.reps,
      })
      await advance()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  /** 标熟（二次确认）：门面 master 全局置 4 并移出会话；drop 使对应计数−1，下一张在 advance 出卡前刷新。在途锁防重入。 */
  async function doMaster(): Promise<void> {
    if (!current || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMasterOpen(false)
    try {
      await wordbook.master(current.dictId)
      await advance()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  /** 保存笔记：非空 setNote、空则 clearNote（墓碑）。 */
  async function saveNote(text: string): Promise<void> {
    if (!current) return
    const t = text.trim()
    await (t ? wordbook.setNote(current.dictId, t) : wordbook.clearNote(current.dictId))
    setNote(t)
    setNoteOpen(false)
  }

  /** 再学一组：extraGroup 追加进会话（不受额度），有取到则回到练习态出卡。在途锁防重入。 */
  async function startExtra(kind: ExtraKind, size: number): Promise<void> {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const added = await wordbook.extraGroup(kind, size)
      if (added > 0) {
        setStatus('loading')
        await advance()
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  /** 组大小步进：写 meta extra_group_sizes（下次默认沿用）。 */
  function changeSize(kind: ExtraKind, size: number): void {
    setFinishData((prev) => {
      if (!prev) return prev
      const sizes = { ...prev.sizes, [kind]: size }
      void wordbook.setGroupSizes(sizes)
      return { ...prev, sizes }
    })
  }

  // 空格 / 回车揭晓（桌面便捷键；iOS 为点击屏幕）。
  useEffect(() => {
    if (status !== 'studying' || revealed) return
    function onKeyDown(e: KeyboardEvent): void {
      // 守卫①：页内弹窗（笔记 / 标熟）打开时不揭晓——Radix Dialog 走 portal 但按键仍冒泡到 window，
      // 否则会吞掉弹窗内首个空格/回车并提前揭晓背后答案（MasterConfirm 焦点在按钮，守卫②挡不住，须靠此条）。
      if (noteOpen || masterOpen) return
      // 守卫②：焦点在输入控件（笔记 textarea 等）时不揭晓，按键交给控件本身。
      const el = document.activeElement
      if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        reveal()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [status, revealed, reveal, noteOpen, masterOpen])

  if (status === 'loading') {
    return <div className="grid h-full place-items-center text-sm text-text-muted">加载中…</div>
  }

  if (status === 'empty') {
    return (
      <div className="grid h-full place-items-center px-6">
        <Card className="flex max-w-md flex-col items-center gap-3 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-card bg-bg-neutral text-text-primary">
            <Layers className="size-7" />
          </span>
          <h3 className="text-xl font-medium text-text-primary">没有可学的新词了</h3>
          <Button variant="brand" size="lg" className="mt-1 gap-2" onClick={() => navigate('/wordbook/books')}>
            <BookPlus />
            去选词
          </Button>
        </Card>
      </div>
    )
  }

  if (status === 'finished' && finishData) {
    return (
      <FinishedView
        counts={finishData.counts}
        sizes={finishData.sizes}
        onSizeChange={changeSize}
        onStart={(kind, size) => void startExtra(kind, size)}
      />
    )
  }

  if (!current) {
    return <div className="grid h-full place-items-center text-sm text-text-muted">加载中…</div>
  }

  const trimmedNote = note.trim()

  return (
    <div className="flex h-full flex-col">
      <PracticeTopBar
        counts={progress}
        current={current.kind}
        onNote={() => setNoteOpen(true)}
        onMaster={() => setMasterOpen(true)}
      />

      {/* 卡片区：点击空白揭晓（active recall）。 */}
      <div className="relative min-h-0 flex-1 overflow-y-auto" onClick={() => !revealed && reveal()}>
        <div className="mx-auto max-w-2xl px-6 py-6">
          <WordCard
            entry={current.word}
            inflectionSpacing="legacy"
            revealed={revealed}
            onReveal={reveal}
            stopClickPropagation
            accent={accent}
            source={source}
            tab={tab}
            onToggleAccent={() => setAccent((a) => (a === 'uk' ? 'us' : 'uk'))}
            onSpeak={(a) => void playWordAudio(current.dictRow, a)}
            hasAudio={hasWordAudio(current.dictRow)}
            audioRow={current.dictRow}
            onChangeSource={setSource}
            onChangeTab={setTab}
            noteSlot={
              trimmedNote ? (
                <>
                  <Separator className="bg-border-200" />
                  <section className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-text-muted">我的笔记</span>
                    <p className="text-sm leading-relaxed text-text-primary">{trimmedNote}</p>
                  </section>
                </>
              ) : undefined
            }
          />
        </div>
        {!revealed && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex justify-center">
            <span className="text-sm text-text-muted">点击卡片显示答案（或按空格）</span>
          </div>
        )}
      </div>

      {/* 底部评分条：仅揭晓后出现。条后垫一段占容器高 10% 的空隙，把按钮从窗口底抬起。 */}
      {revealed && (
        <>
          <RatingBar onRate={(k) => void rate(k)} preview={current.preview} disabled={busy} />
          <div aria-hidden className="h-[10%] shrink-0" />
        </>
      )}

      <NoteDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        word={current.word.word}
        initial={note}
        onSave={(t) => void saveNote(t)}
      />
      <ConfirmDialog
        open={masterOpen}
        onOpenChange={setMasterOpen}
        title={`标记「${current.word.word}」为已掌握？`}
        description="标熟后该词全局生效、不再进入任何学习 / 复习队列。之后可在「已标熟」段取消标熟。"
        confirmText="标记掌握"
        confirmVariant="primary"
        onConfirm={() => void doMaster()}
      />
    </div>
  )
}
