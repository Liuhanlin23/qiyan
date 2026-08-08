// 学习设置读取（词卡默认释义来源 / 口音等）：挂载时取一次。写走设置页 updateSettings，本 hook 只读默认。
import { useEffect, useState } from 'react'
import { getSettings } from '@/settings'
import type { Settings } from '@/settings'
import type { MeaningSource } from '@/types/word'

export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    let alive = true
    void getSettings().then((s) => {
      if (alive) setSettings(s)
    })
    return () => {
      alive = false
    }
  }, [])
  return settings
}

/** 设置的释义来源（'concise'|'collins'）→ 词卡显示态 MeaningSource（'simple'|'collins'）。 */
export function meaningSourceToDisplay(m: Settings['meaningSource'] | undefined): MeaningSource {
  return m === 'collins' ? 'collins' : 'simple'
}
