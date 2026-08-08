import { useEffect, useRef } from 'react'
import * as reading from '@/reading'

/**
 * 阅读时长采集（无 UI）：把阅读器的位置变化喂给域侧计时器，隐藏窗口 / 关书时结算。
 * 一段连续停留 = 一行 `user_reading_event`（append-only、不可变），将来的阅读统计全靠这些原料 SQL 派生。
 *
 * 这里只管四个触发点（位置变、窗口隐、关窗、关书）；空闲截断、时长上下限、秒↔毫秒都在 `@/reading` 内。
 *
 * `page` 是**位置键** = foliate location 刻度（~1500 字节/位，内容派生、排版无关）。UI 页码同为
 * location 刻度，二者天然同域（调用方喂 `currentPage - 1` 还原 0 基）；它只在内存里回答「位置变了没」、
 * 从不落库（落库的只有 fraction）。也不能退回章序号：按章计的话读一章十分钟只会记下一条 120s 上限的事件。
 */
export function useReadingTracker(
  bookHash: string,
  page: number | null,
  totalPages: number | null,
  fraction: number,
): void {
  const trackerRef = useRef<reading.ReadingTracker | null>(null)
  // 最新位置：转回可见时要用它续计，而下面喂位置的 effect 只在位置真的变了才跑（同页切走再切回不会触发）。
  const latestRef = useRef({ page, totalPages, fraction })
  latestRef.current = { page, totalPages, fraction }

  // 一本书一个计时器；离开阅读器（或关窗）即结算。
  // 关窗那次是尽力而为：beforeunload 等不到异步落库回来，最坏丢最后一段（同进度 flush 的边界）。
  useEffect(() => {
    if (!bookHash) return
    const tracker = reading.createReadingTracker(bookHash)
    trackerRef.current = tracker
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        void tracker.stop()
        return
      }
      // 转回可见必须重新喂一次位置：hidden 时已结算并暂停，不喂就再也不开始计时——切走再切回、
      // 同页续读半小时会一条事件都不记（不是丢最后一秒，是常态性整段少记）。
      // stop 已把内核的 pending 清空，故同页重喂不会被「同页不重开」挡住，新片段从此刻起算。
      const { page: p, totalPages: total, fraction: f } = latestRef.current
      if (p != null) void tracker.onPage(p, total ?? 0, f)
    }
    const onUnload = (): void => void tracker.stop()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onUnload)
      trackerRef.current = null
      void tracker.stop()
    }
  }, [bookHash])

  // 位置变了就喂一次。同一页重复喂不重开计时（内核判定），故 relocate 因重排多抛几次无害。
  // page 为空 = 引擎还没给出页码，此时没有位置键可喂，跳过。
  useEffect(() => {
    if (page == null) return
    void trackerRef.current?.onPage(page, totalPages ?? 0, fraction)
  }, [page, totalPages, fraction])
}
