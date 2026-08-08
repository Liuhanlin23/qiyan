import { useEffect, useRef, useState } from 'react'
import { Clock, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui'
import { createFoliateEngine, type FoliateEngine } from '@/reading'
import { buildSamplePaperPdf } from './sample-pdf'

/** 演示用的一份「真题」元信息(纯模拟,对齐资源页 Paper 的字段气质)。 */
const PAPER = {
  year: 2024,
  caption: '模拟卷',
  title: '2024 National English Proficiency Exam',
  subtitle: 'Reading · Cloze · Writing · 模拟真题',
  durationMinutes: 120,
}

// 缩放倍率:100% = 适宽(页宽铺满阅读区),向上放大、向下缩小。
const MIN_ZOOM = 0.6
const MAX_ZOOM = 2.4
const ZOOM_STEP = 0.2

/**
 * 「真题点进去」的阅读器 demo —— 本质是展示一份 PDF。
 *
 * PDF 经阅读域门面(`@/reading`)交给 foliate 引擎渲染:引擎识出固定版式后走连续滚动,外壳 / 工具栏
 * 仍由 CDS 定制。**真题与阅读页是两回事** —— 这里只做展示,不接进度、标注、划词等任何持久化。
 */
export function PastPaperReaderDemo(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<FoliateEngine | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [page, setPage] = useState<{ index: number; total: number } | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    let cancelled = false
    let engine: FoliateEngine | null = null

    void (async () => {
      try {
        const eng = await createFoliateEngine()
        // StrictMode 双挂载 / 卸载竞态:已取消就地销毁,别把元素挂进已废弃的容器。
        if (cancelled) {
          eng.destroy()
          return
        }
        engine = eng
        containerRef.current?.appendChild(eng.element)
        await eng.open(new Blob([buildSamplePaperPdf()], { type: 'application/pdf' }))
        if (cancelled) return
        engineRef.current = eng
        setStatus('ready')
        setPage(eng.pageState())
        // 连续滚动下「当前页」随滚动变化,引擎每次 relocate 都重取一次。
        eng.onRelocate(() => setPage(eng.pageState()))
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      engineRef.current = null
      engine?.destroy()
    }
  }, [])

  const stepZoom = (dir: 1 | -1): void =>
    setZoom((z) => {
      const next = Math.round((z + dir * ZOOM_STEP) * 10) / 10
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
      engineRef.current?.setZoom(clamped)
      return clamped
    })

  return (
    <div className="flex h-full flex-col bg-bg-100">
      {/* 顶部工具栏:封面 + 标题在左,缩放 / 页码在右,发丝描边分隔。 */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border-200 bg-surface-1 px-4 py-2.5">
        <PaperThumb />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-sm font-semibold text-text-primary">{PAPER.title}</h1>
          <span className="inline-flex items-center gap-1 truncate text-xs text-text-muted">
            <Clock className="size-3" />
            用时 {PAPER.durationMinutes} 分钟 · {PAPER.subtitle}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="iconSm" onClick={() => stepZoom(-1)} aria-label="缩小">
            <ZoomOut className="size-4" />
          </Button>
          <span className="w-11 text-center text-xs tabular-nums text-text-secondary">
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="ghost" size="iconSm" onClick={() => stepZoom(1)} aria-label="放大">
            <ZoomIn className="size-4" />
          </Button>
          <span className="ml-1 w-14 text-center text-xs tabular-nums text-text-muted">
            {page ? `${page.index + 1} / ${page.total}` : '—'}
          </span>
        </div>
      </header>

      {/* 阅读区:foliate 引擎挂载点 + 加载 / 失败覆盖层。 */}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full" />
        {status !== 'ready' && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            {status === 'loading' ? (
              <span className="text-sm text-text-muted">正在打开试卷…</span>
            ) : (
              <div className="max-w-md px-6 text-center">
                <p className="text-sm font-medium text-text-danger">打开失败</p>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{error}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** 试卷小封面:near-black 竖块 + 年份 / 卷次,复刻资源页 PaperCover 的处理。 */
function PaperThumb(): React.JSX.Element {
  return (
    <div className="relative grid h-11 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-fill-primary">
      <span aria-hidden className="absolute inset-y-0 left-0.5 w-px bg-on-primary/15" />
      <div className="flex flex-col items-center leading-none text-on-primary">
        <span className="text-[11px] font-bold">{PAPER.year}</span>
        <span className="mt-0.5 text-[8px] font-medium text-on-primary/85">{PAPER.caption}</span>
      </div>
    </div>
  )
}
