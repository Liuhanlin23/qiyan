import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui'
import { WordLookupPanel } from '@/components/word/WordLookupPanel'
import { TopBar } from '@/components/layout/TopBar'
import { useAsyncData } from '@/hooks/useAsyncData'
import { suggestBridge } from '@/platform'
import * as lookup from '@/lookup'
import type { LookupHistoryRow } from '@/lookup'

/**
 * 查词（docs/feature/lookup/lookup.md）：输入联想（有道 suggest 经主进程转发）+ 回车查词
 * + 本地查词历史（lookup_history，命中才记、记权威拼写）。
 *
 * 本页只管**搜索栏 / 联想 / 历史**；「词 → 结果」整块（读穿三态、词卡、发音、笔记、加入·移除学习）
 * 交给共享 `WordLookupPanel`——阅读页的「完整词条」浮窗用的是同一份实现
 * （docs/feature/reading/lookup.md）。历史由面板内部记录，本页只在命中回调里刷新列表。
 */

/** 联想防抖窗口：lookup.md §2 未定死具体数值，250ms 落在常见的 200–300ms 区间内。 */
const SUGGEST_DEBOUNCE_MS = 250

// ─────────────────────────── 根组件 ───────────────────────────

export default function WordLookup(): React.JSX.Element {
  const [query, setQuery] = useState('')
  // 已提交的查询词（空串 = 未查询，显示历史空态）。面板据此取数，本页不碰结果。
  const [submittedTerm, setSubmittedTerm] = useState('')

  // 查词历史（lookup_history 落库，倒序，含首条简义快照）；面板命中后经 onHit 回来 reload。
  const history = useAsyncData(() => lookup.listHistory(), [])
  const historyRows = history.data ?? []

  // 输入联想：防抖 + 序号守卫（只认最后一次请求；失败/过期静默丢弃）。
  const [suggestions, setSuggestions] = useState<SuggestEntry[]>([])
  const suggestTimer = useRef<number | null>(null)
  const suggestSeq = useRef(0)

  useEffect(
    () => () => {
      if (suggestTimer.current != null) window.clearTimeout(suggestTimer.current)
    },
    [],
  )

  /** 关闭联想面板并使在途响应过期。 */
  function closeSuggest(): void {
    if (suggestTimer.current != null) window.clearTimeout(suggestTimer.current)
    suggestSeq.current++
    setSuggestions([])
  }

  /** 输入变化：防抖后调 suggest 桥；空输入清空候选且不请求；失败静默清空。 */
  function handleQueryChange(text: string): void {
    setQuery(text)
    if (suggestTimer.current != null) window.clearTimeout(suggestTimer.current)
    const q = text.trim()
    if (!q) {
      suggestSeq.current++
      setSuggestions([])
      return
    }
    suggestTimer.current = window.setTimeout(() => {
      const seq = ++suggestSeq.current
      suggestBridge.query(q).then(
        (entries) => {
          if (seq === suggestSeq.current) setSuggestions(entries)
        },
        () => {
          if (seq === suggestSeq.current) setSuggestions([])
        },
      )
    }, SUGGEST_DEBOUNCE_MS)
  }

  /** 提交查询：归一化输入并交给面板取数（三态分流与历史记录都在面板内）。 */
  function runSearch(raw: string): void {
    const term = raw.trim()
    if (!term) return
    setQuery(term)
    closeSuggest()
    setSubmittedTerm(term)
  }

  function clearInput(): void {
    setQuery('')
    setSubmittedTerm('')
    closeSuggest()
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar segments={['查词']} />
      {/* 搜索栏 */}
      <header className="shrink-0">
        <form
          className="mx-auto w-full max-w-2xl px-6 pb-4 pt-6"
          onSubmit={(e) => {
            e.preventDefault()
            runSearch(query)
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <Input
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              // 失焦走 closeSuggest（清防抖 timer + seq++ 使在途/待发请求失效），裸 setSuggestions([])
              // 不清 timer 也不递增 seq，在途响应到达仍会重弹面板。列表项 onMouseDown preventDefault 拦住失焦，点选不受影响。
              onBlur={() => closeSuggest()}
              placeholder="输入单词或短语，回车查询"
              autoFocus
              className="h-11 rounded-lg pl-10 pr-10 text-base"
            />
            {query && (
              <button
                type="button"
                aria-label="清空"
                onClick={clearInput}
                className="btn-squish absolute right-2.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-text-muted hover:bg-bg-400 hover:text-text-secondary"
              >
                <X className="size-4" />
              </button>
            )}
            {/* 联想候选面板：词 + 简明释义；选中候选 = 以 entry 原文发起查词（lookup.md §2） */}
            {suggestions.length > 0 && (
              <div className="absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-card bg-surface-3 shadow-panel">
                <ul className="max-h-80 overflow-y-auto p-1.5">
                  {suggestions.map((s) => (
                    <li key={s.entry}>
                      <button
                        type="button"
                        // 防 Input 失焦先关面板吞掉点击
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => runSearch(s.entry)}
                        className="flex w-full items-baseline gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bg-400"
                      >
                        <span className="shrink-0 text-sm font-medium text-text-primary">{s.entry}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{s.explain}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </form>
      </header>

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 pb-12">
          {submittedTerm ? (
            <WordLookupPanel
              term={submittedTerm}
              className="pt-2"
              onHit={() => void history.reload()}
            />
          ) : (
            <EmptyState
              history={historyRows}
              onPick={runSearch}
              onClearHistory={() => {
                void lookup.clearHistory().then(() => history.reload())
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────── 空态：最近查询 ───────────────────────────

function EmptyState({
  history,
  onPick,
  onClearHistory,
}: {
  history: LookupHistoryRow[]
  onPick: (w: string) => void
  onClearHistory: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-8 pt-4">
      {history.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-text-primary">最近查询</span>
            <button
              type="button"
              onClick={onClearHistory}
              className="btn-squish text-xs text-text-muted transition-colors hover:text-text-secondary"
            >
              清空
            </button>
          </div>
          <HistoryList rows={history} onPick={onPick} />
        </section>
      )}
    </div>
  )
}

/**
 * 最近查询列表：复刻输入时 suggest 面板的行样式（词 + 首条简义截断），整行可点即以权威拼写重查。
 * explain 为空（短语 / 无义 / 存量旧行）时只显示词，不留空白行。
 */
function HistoryList({
  rows,
  onPick,
}: {
  rows: LookupHistoryRow[]
  onPick: (w: string) => void
}): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map((r) => (
        <li key={r.term}>
          <button
            type="button"
            onClick={() => onPick(r.term)}
            className="flex w-full items-baseline gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bg-400"
          >
            <span className="shrink-0 text-sm font-medium text-text-primary">{r.term}</span>
            {r.explain && (
              <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{r.explain}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
