import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Keyboard,
  Loader2,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { generateTypingDeckWithAi } from '@/ai'
import { TopBar } from '@/components/layout/TopBar'
import {
  Button,
  Card,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import * as wordbook from '@/wordbook'
import { loadQwertyDeck, QWERTY_DECK_CATALOG, type TypingWord } from './decks'

type PracticeUnit = 'word' | 'sentence'
type PracticeMode = 'typing' | 'dictation'

const CHAPTER_SIZE = 20
const TRAILING_PUNCT_RE = /^[.!?,;:'"()]+$/

/** 用 Web Audio API 生成轻量机械按键音/完成提示音，完全离线无资源依赖。 */
function playBeep(kind: 'key' | 'error' | 'done'): void {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)

    if (kind === 'key') {
      osc.type = 'triangle'
      osc.frequency.value = 540
      gain.gain.setValueAtTime(0.04, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04)
      osc.start()
      osc.stop(ctx.currentTime + 0.04)
    } else if (kind === 'error') {
      osc.type = 'sawtooth'
      osc.frequency.value = 180
      gain.gain.setValueAtTime(0.06, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
      osc.start()
      osc.stop(ctx.currentTime + 0.12)
    } else {
      osc.type = 'sine'
      osc.frequency.value = 780
      gain.gain.setValueAtTime(0.06, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16)
      osc.start()
      osc.stop(ctx.currentTime + 0.16)
    }
    osc.onended = () => void ctx.close()
  } catch {
    // 忽略音频上下文异常
  }
}

/** 使用系统离线 SpeechSynthesis 朗读英文单词或句子。 */
function speakOffline(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'en-US'
    utter.rate = 0.92
    window.speechSynthesis.speak(utter)
  } catch {
    // 忽略语音合成异常
  }
}

/** 解析用户粘贴的自定义文本：支持「英文文章自动拆句」或「单词 | 释义」逐行词表。 */
function parseCustomInput(raw: string): { words: TypingWord[]; preferSentence: boolean } {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  if (lines.length === 0) return { words: [], preferSentence: false }

  const hasPipeOrTab = lines.some((l) => l.includes('|') || l.includes('\t'))
  if (hasPipeOrTab) {
    const words: TypingWord[] = lines
      .map((line) => {
        const parts = line.split(/\||\t/).map((p) => p.trim())
        return {
          term: parts[0] ?? '',
          phonetic: parts[2] ?? '',
          meaning: parts[1] ?? '自定义词条',
          example: parts[3] || undefined,
          exampleZh: parts[4] || undefined,
        }
      })
      .filter((w) => w.term.length > 0)
    return { words, preferSentence: false }
  }

  const sentences = raw
    .replace(/\r?\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)

  const words: TypingWord[] = sentences.map((s, idx) => ({
    term: s.split(/\s+/)[0]?.replace(/[^a-zA-Z'-]/g, '') || `sentence-${idx + 1}`,
    phonetic: '',
    meaning: `自定义句子 #${idx + 1}`,
    example: s,
    exampleZh: '自定义导入句子',
  }))
  return { words, preferSentence: true }
}

export default function TypingPractice(): React.JSX.Element {
  const [deckId, setDeckId] = useState<string>('ket2021')
  const [allWords, setAllWords] = useState<TypingWord[]>([])
  const [chapterIndex, setChapterIndex] = useState(0)
  const [loadingDeck, setLoadingDeck] = useState(true)

  const [unit, setUnit] = useState<PracticeUnit>('word')
  const [mode, setMode] = useState<PracticeMode>('typing')
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [peekWord, setPeekWord] = useState(false)

  // AI 生成词库输入
  const [aiTopic, setAiTopic] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [deckMessage, setDeckMessage] = useState<string | null>(null)
  const [deckError, setDeckError] = useState<string | null>(null)
  const [importingToWordbook, setImportingToWordbook] = useState(false)

  // 自定义文本/句子导入面板
  const [showCustomPanel, setShowCustomPanel] = useState(false)
  const [customText, setCustomText] = useState('')

  // 打字状态
  const [index, setIndex] = useState(0)
  const [typed, setTyped] = useState('')
  const [hasError, setHasError] = useState(false)
  const [finished, setFinished] = useState(false)

  // 统计
  const [correctKeys, setCorrectKeys] = useState(0)
  const [totalKeys, setTotalKeys] = useState(0)
  const [streak, setStreak] = useState(0)
  const startTimeRef = useRef<number | null>(null)
  const [wpm, setWpm] = useState(0)

  const resetProgress = useCallback((nextAllWords?: TypingWord[], nextChapter = 0) => {
    if (nextAllWords) setAllWords(nextAllWords)
    setChapterIndex(nextChapter)
    setIndex(0)
    setTyped('')
    setHasError(false)
    setFinished(false)
    setPeekWord(false)
    setCorrectKeys(0)
    setTotalKeys(0)
    setStreak(0)
    setWpm(0)
    startTimeRef.current = null
  }, [])

  // 首次挂载加载默认词库（剑桥 KET）
  useEffect(() => {
    const initial = QWERTY_DECK_CATALOG.find((d) => d.id === 'ket2021') ?? QWERTY_DECK_CATALOG[0]
    let cancelled = false
    setLoadingDeck(true)
    loadQwertyDeck(initial)
      .then((loaded) => {
        if (!cancelled) resetProgress(loaded, 0)
      })
      .catch((e) => {
        if (!cancelled) setDeckError(e instanceof Error ? e.message : '加载词库失败')
      })
      .finally(() => {
        if (!cancelled) setLoadingDeck(false)
      })
    return () => {
      cancelled = true
    }
  }, [resetProgress])

  // 按单元过滤后分章（每章 20 词）
  const filteredWords = useMemo(() => {
    if (unit === 'word') return allWords
    return allWords.filter((w) => typeof w.example === 'string' && w.example.trim().length > 0)
  }, [unit, allWords])

  const totalChapters = Math.max(1, Math.ceil(filteredWords.length / CHAPTER_SIZE))
  const safeChapter = Math.min(chapterIndex, totalChapters - 1)
  const activeItems = useMemo(() => {
    const start = safeChapter * CHAPTER_SIZE
    return filteredWords.slice(start, start + CHAPTER_SIZE)
  }, [filteredWords, safeChapter])

  const currentItem = activeItems[index] ?? null
  const targetText = useMemo(() => {
    if (!currentItem) return ''
    return unit === 'sentence' ? (currentItem.example ?? '').trim() : currentItem.term.trim()
  }, [currentItem, unit])

  const handleUnitChange = (next: string): void => {
    if (!next) return
    setUnit(next as PracticeUnit)
    resetProgress(undefined, 0)
  }

  // 切换条目或进入听写模式时自动朗读
  useEffect(() => {
    if (!targetText || finished || loadingDeck) return
    if (soundEnabled) speakOffline(targetText)
  }, [targetText, finished, loadingDeck, mode, unit, soundEnabled])

  // 切换词库
  const handleSelectDeck = async (nextId: string): Promise<void> => {
    setDeckError(null)
    setDeckMessage(null)
    setDeckId(nextId)
    if (nextId === 'my-wordbook') {
      setLoadingDeck(true)
      try {
        const list = await wordbook.listAllWords({ limit: 500 })
        const valid = list
          .filter((item) => typeof item.term === 'string' && item.term.trim().length > 0)
          .map((item) => ({
            term: item.term!.trim(),
            phonetic: '',
            meaning: '来自我的生词本',
          }))
        if (valid.length === 0) {
          setDeckError('你的生词本暂时为空，可点击「加入本组到单词本」将当前分组导入。')
          setAllWords([])
        } else {
          setUnit('word')
          resetProgress(valid, 0)
        }
      } catch (e) {
        setDeckError(e instanceof Error ? e.message : '读取生词本失败')
      } finally {
        setLoadingDeck(false)
      }
      return
    }

    const meta = QWERTY_DECK_CATALOG.find((d) => d.id === nextId)
    if (!meta) return
    setLoadingDeck(true)
    try {
      const loaded = await loadQwertyDeck(meta)
      setUnit(meta.sentenceFormat ? 'sentence' : 'word')
      resetProgress(loaded, 0)
      setDeckMessage(`已加载「${meta.name}」，共 ${loaded.length} 条。`)
    } catch (e) {
      setDeckError(e instanceof Error ? e.message : '加载词库失败')
    } finally {
      setLoadingDeck(false)
    }
  }

  // 一键将当前章节词汇导入本地单词本（FSRS 记忆曲线）
  const handleImportToWordbook = async (): Promise<void> => {
    if (activeItems.length === 0 || importingToWordbook) return
    setImportingToWordbook(true)
    setDeckError(null)
    setDeckMessage(null)
    try {
      const count = await wordbook.importOfflineWords(activeItems)
      setDeckMessage(`已将本组 ${count} 个词条加入本地「单词本」，可在「单词本」页用 FSRS 记忆曲线复习。`)
    } catch (e) {
      setDeckError(e instanceof Error ? e.message : '导入单词本失败')
    } finally {
      setImportingToWordbook(false)
    }
  }

  // 导入自定义文本/句子
  const handleApplyCustom = (): void => {
    setDeckError(null)
    setDeckMessage(null)
    const { words: parsed, preferSentence } = parseCustomInput(customText)
    if (parsed.length === 0) {
      setDeckError('未识别到有效英文内容，请粘贴英文句子或「单词 | 释义」格式文本。')
      return
    }
    setDeckId('custom-import')
    if (preferSentence) setUnit('sentence')
    resetProgress(parsed, 0)
    setShowCustomPanel(false)
    setDeckMessage(`已加载 ${parsed.length} 条自定义练习内容。`)
  }

  // AI 生成主题词库
  const handleGenerateAiDeck = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const topic = aiTopic.trim()
    if (!topic || aiLoading) return
    setAiLoading(true)
    setDeckError(null)
    setDeckMessage(null)
    try {
      const generated = await generateTypingDeckWithAi(topic, 12)
      setDeckId('ai-custom')
      resetProgress(generated, 0)
    } catch (err) {
      setDeckError(err instanceof Error ? err.message : 'AI 生成词库失败，请检查设置中的 AI 配置')
    } finally {
      setAiLoading(false)
    }
  }

  // 全局键盘监听
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (!targetText || finished || loadingDeck) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === 'Tab') {
        e.preventDefault()
        setPeekWord((p) => !p)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        speakOffline(targetText)
        return
      }
      if (e.key === 'Backspace') {
        e.preventDefault()
        setTyped((prev) => prev.slice(0, -1))
        setHasError(false)
        return
      }
      if (e.key.length !== 1) return

      e.preventDefault()
      if (startTimeRef.current === null) startTimeRef.current = Date.now()

      const expected = targetText[typed.length]
      setTotalKeys((k) => k + 1)

      const isMatch = expected !== undefined && e.key.toLowerCase() === expected.toLowerCase()
      if (isMatch) {
        let nextTyped = typed + expected
        const rest = targetText.slice(nextTyped.length)
        if (rest.length > 0 && TRAILING_PUNCT_RE.test(rest)) {
          nextTyped = targetText
        }

        setTyped(nextTyped)
        setHasError(false)
        setCorrectKeys((k) => k + 1)

        const elapsedMin = Math.max((Date.now() - startTimeRef.current) / 60000, 0.05)
        setWpm(Math.round((correctKeys + 1) / 5 / elapsedMin))

        if (nextTyped.length === targetText.length) {
          if (soundEnabled) playBeep('done')
          setStreak((s) => s + 1)
          setTimeout(() => {
            if (index + 1 >= activeItems.length) {
              setFinished(true)
            } else {
              setIndex((i) => i + 1)
              setTyped('')
              setPeekWord(false)
            }
          }, 200)
        } else if (soundEnabled) {
          playBeep('key')
        }
      } else {
        if (soundEnabled) playBeep('error')
        setHasError(true)
        setStreak(0)
        setTimeout(() => setHasError(false), 260)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeItems.length, correctKeys, finished, index, loadingDeck, soundEnabled, targetText, typed])

  const accuracy = useMemo(() => {
    if (totalKeys === 0) return 100
    return Math.round((correctKeys / totalKeys) * 100)
  }, [correctKeys, totalKeys])

  const showLetters = mode === 'typing' || peekWord

  return (
    <div className="flex h-full flex-col">
      <TopBar segments={['打字听写']} />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-8 py-6">
        {/* 顶部控制区 */}
        <Card className="flex flex-col gap-3.5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {QWERTY_DECK_CATALOG.map((deck) => (
                <Button
                  key={deck.id}
                  variant={deckId === deck.id ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => void handleSelectDeck(deck.id)}
                >
                  {deck.name}
                </Button>
              ))}
              <Button
                variant={deckId === 'my-wordbook' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => void handleSelectDeck('my-wordbook')}
              >
                我的生词本
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup value={unit} onValueChange={handleUnitChange}>
                <ToggleGroupItem value="word">单词练习</ToggleGroupItem>
                <ToggleGroupItem value="sentence">句子默写</ToggleGroupItem>
              </ToggleGroup>

              <ToggleGroup value={mode} onValueChange={(v) => v && setMode(v as PracticeMode)}>
                <ToggleGroupItem value="typing">跟打</ToggleGroupItem>
                <ToggleGroupItem value="dictation">听写</ToggleGroupItem>
              </ToggleGroup>

              <Button
                variant="ghost"
                size="sm"
                title={soundEnabled ? '关闭音效与自动朗读' : '开启音效与自动朗读'}
                onClick={() => setSoundEnabled((s) => !s)}
              >
                {soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </Button>
            </div>
          </div>

          {/* 章节切换 + AI 生成 + 导入 */}
          <div className="flex flex-wrap items-center gap-2">
            {filteredWords.length > CHAPTER_SIZE && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={safeChapter <= 0}
                  onClick={() => resetProgress(undefined, safeChapter - 1)}
                  title="上一组"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Select
                  value={String(safeChapter)}
                  onValueChange={(v) => resetProgress(undefined, Number(v))}
                >
                  <SelectTrigger className="h-8 w-40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: totalChapters }, (_, i) => {
                      const start = i * CHAPTER_SIZE + 1
                      const end = Math.min((i + 1) * CHAPTER_SIZE, filteredWords.length)
                      return (
                        <SelectItem key={i} value={String(i)}>
                          第 {i + 1} 组 ({start}-{end})
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={safeChapter >= totalChapters - 1}
                  onClick={() => resetProgress(undefined, safeChapter + 1)}
                  title="下一组"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}

            <form onSubmit={(e) => void handleGenerateAiDeck(e)} className="flex min-w-[220px] flex-1 items-center gap-2">
              <Sparkles className="size-4 shrink-0 text-text-muted" />
              <Input
                value={aiTopic}
                onChange={(e) => setAiTopic(e.target.value)}
                placeholder="输入主题让 AI 生成词库与例句（如：KET 旅游、雅思环保）"
                className="flex-1"
              />
              <Button type="submit" variant="secondary" size="sm" disabled={aiLoading || !aiTopic.trim()}>
                {aiLoading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                AI 生成
              </Button>
            </form>

            <Button variant="secondary" size="sm" onClick={() => setShowCustomPanel((v) => !v)}>
              <FileText className="mr-1.5 size-3.5" />
              导入文章 / 词表
            </Button>

            {deckId !== 'my-wordbook' && deckId !== 'custom-import' && activeItems.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                disabled={importingToWordbook}
                onClick={() => void handleImportToWordbook()}
              >
                <BookPlus className="mr-1.5 size-3.5" />
                {importingToWordbook ? '导入中…' : '加入本组到单词本'}
              </Button>
            )}
          </div>

          {showCustomPanel && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-1 p-3">
              <p className="text-xs text-text-secondary">
                可直接粘贴任意英文文章/句子（自动拆句进入「句子默写」），或每行按「单词 | 中文释义」粘贴自定义词表：
              </p>
              <textarea
                rows={4}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder={'示例文章：Practice makes perfect. Never give up on your goals.\n或词表：resilient | adj. 有韧性的'}
                className="w-full rounded-md border border-border bg-surface-2 p-2.5 text-sm text-text-primary outline-none focus:border-text-primary"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowCustomPanel(false)}>
                  取消
                </Button>
                <Button size="sm" onClick={handleApplyCustom}>
                  开始练习
                </Button>
              </div>
            </div>
          )}

          {deckError && <p className="text-xs text-danger">{deckError}</p>}
          {deckMessage && <p className="text-xs text-emerald-600 dark:text-emerald-400">{deckMessage}</p>}
        </Card>

        {/* 主练习卡片 */}
        <Card className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
          {loadingDeck ? (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <Loader2 className="size-4 animate-spin" />
              <span>正在加载词库…</span>
            </div>
          ) : finished ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <CheckCircle2 className="size-12 text-emerald-500" />
              <h2 className="text-2xl font-semibold text-text-primary">本组练习完成！</h2>
              <p className="text-sm text-text-secondary">
                共完成 {activeItems.length} 项 · 正确率 {accuracy}% · 速度 {wpm} WPM
              </p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => resetProgress(undefined, safeChapter)}>
                  <RotateCcw className="mr-1.5 size-4" />
                  重练本组
                </Button>
                {safeChapter + 1 < totalChapters && (
                  <Button onClick={() => resetProgress(undefined, safeChapter + 1)}>
                    下一组
                    <ChevronRight className="ml-1 size-4" />
                  </Button>
                )}
              </div>
            </div>
          ) : currentItem && targetText ? (
            <>
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span>
                  本组 {index + 1} / {activeItems.length}
                </span>
                <span>·</span>
                <span>总词量 {filteredWords.length}</span>
                <span>·</span>
                <span>正确率 {accuracy}%</span>
                <span>·</span>
                <span>连击 {streak}</span>
                <span>·</span>
                <span>{wpm} WPM</span>
              </div>

              {/* 单词/句子逐字符高亮区 */}
              <div
                className={cn(
                  'flex max-w-3xl flex-wrap items-center justify-center gap-y-2 font-mono font-semibold select-none',
                  unit === 'sentence' ? 'text-2xl leading-relaxed tracking-normal' : 'text-4xl tracking-wider',
                  hasError && 'animate-pulse text-danger',
                )}
              >
                {targetText.split('').map((ch, i) => {
                  const isTyped = i < typed.length
                  const isCursor = i === typed.length
                  const isSpace = ch === ' '
                  const displayChar = isSpace ? '\u00A0' : showLetters || isTyped ? ch : '_'
                  return (
                    <span
                      key={`${safeChapter}-${index}-${i}`}
                      className={cn(
                        'inline-block border-b-2 pb-0.5 text-center transition-colors',
                        isSpace ? 'w-[0.55ch]' : 'min-w-[0.62ch]',
                        isTyped
                          ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                          : isCursor
                            ? 'border-text-primary text-text-primary'
                            : 'border-transparent text-text-muted/60',
                        hasError && isCursor && 'border-danger text-danger',
                      )}
                    >
                      {displayChar}
                    </span>
                  )
                })}
              </div>

              {/* 音标 / 中文提示 / 操作按钮 */}
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="flex items-center gap-2 text-sm text-text-muted">
                  {unit === 'word' && currentItem.phonetic && <span>{currentItem.phonetic}</span>}
                  {unit === 'sentence' && (
                    <span className="rounded bg-bg-neutral px-2 py-0.5 text-xs text-text-secondary">
                      核心词：{currentItem.term}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => speakOffline(targetText)}
                    title="朗读发音 (Enter)"
                  >
                    <Volume2 className="size-4" />
                  </Button>
                  {mode === 'dictation' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPeekWord((p) => !p)}
                      title="显示/隐藏答案 (Tab)"
                    >
                      {peekWord ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  )}
                </div>

                {unit === 'word' ? (
                  <>
                    <p className="text-lg font-medium text-text-primary">{currentItem.meaning}</p>
                    {currentItem.example && (
                      <p className="max-w-xl text-sm text-text-secondary">{currentItem.example}</p>
                    )}
                  </>
                ) : (
                  <p className="text-lg font-medium text-text-primary">
                    {currentItem.exampleZh || currentItem.meaning}
                  </p>
                )}
              </div>

              <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                <Keyboard className="size-3.5" />
                <span>直接敲击键盘输入 · Enter 重听发音 · Tab 切换提示 · Backspace 退格</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-text-muted">
              {unit === 'sentence'
                ? '当前词库暂未附带英文例句，请选择「4000 核心例句库」或点击「导入文章 / 词表」粘贴英文句子。'
                : '暂无可练习词汇'}
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
