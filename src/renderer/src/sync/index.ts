// 同步引擎单例 + 生命周期访问器。session 编排调 start/stop；本地写只累积 dirty，由引擎下一跳/手动 push
// （sync.md §3.4：无写后触发）。SyncStatus 不再经 IPC——就是引擎单例上的内存状态（诊断用）。
import { SyncEngine, INACTIVE_STATUS, type SyncStatus } from './engine'

export type { SyncStatus } from './engine'

let engine: SyncEngine | null = null

/** 登录 / 冷启动后启动引擎（幂等）。库须已由 session 打开。 */
export function startEngine(): void {
  if (!engine) engine = new SyncEngine()
  engine.start()
}

/** 登出 / 换账号：停引擎、丢弃单例（关库由 session 负责）。 */
export function stopEngine(): void {
  engine?.stop()
  engine = null
}

/** 手动触发一个完整同步回合（诊断 / 设置页）。 */
export function runRound(): Promise<void> {
  return engine ? engine.runRoundSafe() : Promise.resolve()
}

/** 逃生舱：推完脏行 → 清库 → 重灌。 */
export function forceReset(): Promise<void> {
  return engine ? engine.forceReset() : Promise.resolve()
}

export function getSyncStatus(): SyncStatus {
  return engine ? engine.getStatus() : INACTIVE_STATUS
}
