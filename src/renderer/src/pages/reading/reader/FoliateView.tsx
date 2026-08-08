import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { createFoliateEngine, type FoliateEngine } from '@/reading'

/**
 * 真实阅读正文层 —— 用 vendor 的 foliate 引擎渲染一本真 EPUB（经阅读域 `@/reading` 门面收口）。
 *
 * 只负责把 `<foliate-view>` 挂进容器、开书、把引擎实例交给外层，并盖加载 / 失败覆盖层；
 * 翻页 / 进度 / 章节 / 键盘全由外层（`Reader`）拿引擎实例接管。
 * `loadBook` 须是稳定引用（模块级函数或 useCallback），否则会反复重建引擎。
 */

export interface FoliateViewProps {
  /** 载入书内容为 Blob（如 `@/reading` 的 `openBookFile`）。**须稳定引用**。 */
  loadBook: () => Promise<Blob>
  /** 开书成功后把引擎实例交出去（划词标注等上层能力用）；卸载时会再调 `onEngineGone`。**须稳定引用**。 */
  onEngineReady?: (engine: FoliateEngine) => void
  /** 引擎销毁前回调（清理上层订阅）。**须稳定引用**。 */
  onEngineGone?: () => void
  className?: string
  /** 叠在正文之上的覆盖层（如划词浮层）。 */
  children?: React.ReactNode
}

type Status = 'loading' | 'ready' | 'error'

export function FoliateView({
  loadBook,
  onEngineReady,
  onEngineGone,
  className,
  children,
}: FoliateViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let engine: FoliateEngine | null = null

    void (async () => {
      try {
        const [eng, book] = await Promise.all([createFoliateEngine(), loadBook()])
        // StrictMode 双挂载 / 卸载竞态：已取消就地销毁，别把元素挂进已废弃的容器。
        if (cancelled) {
          eng.destroy()
          return
        }
        engine = eng
        containerRef.current?.appendChild(eng.element)
        await eng.open(book)
        if (cancelled) return
        setStatus('ready')
        onEngineReady?.(eng)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      if (engine) onEngineGone?.()
      engine?.destroy()
    }
  }, [loadBook, onEngineReady, onEngineGone])

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col bg-page-bg', className)}>
      {/* foliate 引擎挂载点：正文在此渲染（章节各自 iframe）。 */}
      <div ref={containerRef} className="min-h-0 flex-1" />

      {/* 叠加层（划词浮层等，多为 fixed 定位）。 */}
      {children}

      {/* 加载 / 错误覆盖层 */}
      {status !== 'ready' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {status === 'loading' ? (
            <span className="text-sm text-text-muted">正在打开书…</span>
          ) : (
            <div className="max-w-md px-6 text-center">
              <p className="text-sm font-medium text-text-danger">打开失败</p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
