// 阅读计时编排：把纯计时内核（trackerCore）、校准钟与 user_reading_event 落库串成一本书的计时器。
//
// 两处口径在此收口，页面层不必知道：
// ① **单位**——内核按秒计（拷来的形状），本表按毫秒存，秒↔毫秒只在这里换（故 startTime 是秒级精度）；
// ② **空闲截断**——内核不管空闲（`idleTimeoutSeconds` 它不读），定时器长在这里，页面只管喂位置。
//
// 事件是尽力而为的遥测：落库失败记一条错误日志就算了，不弹提示、更不打断阅读（读者对此无从处理）。
import type { Db } from '@/db/client'
import { addReadingEvent } from './events'
import { DEFAULT_STATS_TRACKING_CONFIG, TrackerCore, type FlushedEvent } from './trackerCore'

/** 一本书的阅读计时器。生命周期与「这本书开着」一致：开书 create、关书 stop。 */
export interface ReadingTracker {
  /**
   * 位置变了（翻页 / 跳转 / 重排）：结算上一页的停留、开始新一段，并把空闲定时器重新上弦。
   * 同一页重复喂不重开计时（内核判定），故 relocate 多喂几次无害。
   */
  onPage(page: number, totalPages: number, fraction: number): Promise<void>
  /** 结算当前片段并暂停（窗口隐藏 / 关书 / 空闲皆同——对内核而言就是一次 flush）。 */
  stop(): Promise<void>
}

/**
 * 造一本书的计时器。`now` 是校准钟（epoch ms），由门面绑定。
 * `fraction` 记的是「这段停留所在那一页」的比例——换页时先用旧值结算，再换成新页的。
 */
export function createReadingTracker(db: Db, bookHash: string, now: () => number): ReadingTracker {
  const cfg = DEFAULT_STATS_TRACKING_CONFIG
  const core = new TrackerCore(cfg)
  let fraction = 0
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  const nowSec = (): number => Math.floor(now() / 1000)

  const clearIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
  }

  const persist = async (events: FlushedEvent[], atFraction: number): Promise<void> => {
    for (const e of events) {
      try {
        await addReadingEvent(db, {
          bookHash,
          startTime: e.startTime * 1000,
          durationMs: e.duration * 1000,
          fraction: atFraction,
        })
      } catch (err) {
        console.error('[reading] 记录阅读事件失败：', err)
      }
    }
  }

  return {
    async onPage(page, totalPages, f) {
      // 结算的那条属于**刚离开**的那一页，故拿换值前的 fraction。
      const done = persist(core.onPage(page, totalPages, nowSec()), fraction)
      fraction = f
      clearIdle()
      // 到点还没翻页 = 人不在看：结算并暂停，下次翻页才重新开始计时。
      idleTimer = setTimeout(() => {
        idleTimer = null
        void persist(core.onIdle(nowSec()), fraction)
      }, cfg.idleTimeoutSeconds * 1000)
      await done
    },
    async stop() {
      clearIdle()
      await persist(core.onClose(nowSec()), fraction)
    },
  }
}
