// 阅读计时内核：纯状态机、零依赖。外壳喂「此刻停在哪一页、现在几点」，它吐出零或一条**不可变**事件。
// 片段在换页 / 空闲 / 隐藏 / 关书四个时机结束；一旦吐出，startTime 与 duration 就不再变（append-only 的前提）。
// 时间单位由调用方定（本项目喂秒，落库时换回毫秒，见 tracking.ts）。空闲切段**不在**内核里——
// `idleTimeoutSeconds` 内核不读，靠外部定时器到点调 `onIdle()`。
//
// 拷自 readest `apps/readest-app/src/services/statistics/trackerCore.ts` 与 `types/statistics.ts`（AGPL-3.0）。

/** 计时调参，默认值抄 readest。 */
export interface StatsTrackingConfig {
  /** Seconds of inactivity before the current page event is flushed + paused. */
  idleTimeoutSeconds: number
  /** Hard per-event duration cap (safety net if a visibility event is missed). */
  maxEventSeconds: number
  /** Events shorter than this are dropped (ignore sub-second page flips). */
  minEventSeconds: number
}

export const DEFAULT_STATS_TRACKING_CONFIG: StatsTrackingConfig = {
  idleTimeoutSeconds: 120,
  maxEventSeconds: 120,
  minEventSeconds: 3,
}

interface PendingEvent {
  page: number
  startTime: number // Unix seconds
  totalPages: number
}

export interface FlushedEvent {
  page: number
  startTime: number
  duration: number
  totalPages: number
}

/**
 * Pure page-dwell tracker. The React layer feeds it `nowSeconds` and the
 * current `(page, totalPages)`; it returns zero-or-one immutable events to
 * persist. Events end on page-change / idle / hide / close. Each returned
 * event is final — its start_time and duration never change afterwards, which
 * lets sync use a simple start_time high-water cursor.
 */
export class TrackerCore {
  private pending: PendingEvent | null = null

  constructor(private readonly cfg: StatsTrackingConfig) {}

  /** Notify the current page at `now`. Returns events flushed by leaving the prior page. */
  onPage(page: number, totalPages: number, now: number): FlushedEvent[] {
    if (this.pending && this.pending.page === page) {
      // Same page (e.g. resume after idle, or a no-op relocate): keep dwelling.
      return []
    }
    const flushed = this.flush(now)
    this.pending = { page, startTime: now, totalPages }
    return flushed
  }

  onIdle(now: number): FlushedEvent[] {
    return this.flush(now) // flush + pause (pending cleared)
  }

  onHide(now: number): FlushedEvent[] {
    return this.flush(now)
  }

  onClose(now: number): FlushedEvent[] {
    return this.flush(now)
  }

  private flush(now: number): FlushedEvent[] {
    const p = this.pending
    this.pending = null
    if (!p) return []
    const raw = now - p.startTime
    const duration = Math.min(Math.max(raw, 0), this.cfg.maxEventSeconds)
    if (duration < this.cfg.minEventSeconds) return []
    return [{ page: p.page, startTime: p.startTime, duration, totalPages: p.totalPages }]
  }
}
