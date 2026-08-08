// 防抖值 hook：value 变化后延迟 delayMs 才更新返回值；窗口内再次变化则重新计时。
// 把高频输入（搜索框每击键）节流为低频依赖，避免每击键触发一次带 JOIN 的 DB 查询。
import { useEffect, useState } from 'react'

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
