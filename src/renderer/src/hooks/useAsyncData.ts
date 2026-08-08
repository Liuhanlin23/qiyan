// 轻量异步数据 hook（加载 / 错误 / 手动 reload）：页面读本地库与在线取数共用。
// 不引第三方数据库（无缓存、无重试、无 SWR）——每次 reload 重跑传入的取数函数，取最新一次结果落态。
// 竞态处理：只认「最后一次发起」的结果（seq 守卫），组件卸载后不再 setState。
import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncData<T> {
  data: T | undefined
  loading: boolean
  error: unknown
  /** 手动重取（同一 fetcher）。返回 Promise 便于调用方 await 后串联动作。 */
  reload: () => Promise<void>
}

/**
 * 运行 `fetcher` 并把结果落成 [data, loading, error]。`deps` 变化即自动重取（默认仅挂载时取一次）。
 * `fetcher` 需用 useCallback 稳定引用，或把真正的依赖放进 `deps` —— 本 hook 以 `deps` 为准触发重取。
 */
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList = [],
): AsyncData<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(undefined)

  // 最新一次发起的序号：只有序号相等的响应才允许落态，丢弃过期响应（切换/快速 reload 时防错位）。
  const seqRef = useRef(0)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const run = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError(undefined)
    try {
      const result = await fetcher()
      if (mountedRef.current && seq === seqRef.current) {
        setData(result)
        setLoading(false)
      }
    } catch (e) {
      if (mountedRef.current && seq === seqRef.current) {
        setError(e)
        setLoading(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    void run()
  }, [run])

  return { data, loading, error, reload: run }
}
