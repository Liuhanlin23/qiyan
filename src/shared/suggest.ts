// 跨进程共享的有道 suggest 桥契约（main 转发 / preload 传参 / renderer 消费的单一事实源）。
// 通道语义见 docs/feature/lookup/lookup.md §2：渲染层直连被有道 Origin 校验 403，须经 main 转发。

/** 一条联想候选：entry 候选词、explain 简明释义。 */
export interface SuggestEntry {
  entry: string
  explain: string
}
