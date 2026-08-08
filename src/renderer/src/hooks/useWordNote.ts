// 词笔记编辑（词表 / 今日 / 学习卡共用）：按 dictId 载入全局笔记，编辑即写本地库（dirty，下一同步回合带走）。
// 空串即清空（clearNote 墓碑，db/04）。v1 每次编辑落一次本地写——本地 upsert 廉价，不做防抖。
import { useCallback, useEffect, useState } from 'react'
import * as wordbook from '@/wordbook'

export function useWordNote(dictId: number | null): {
  note: string
  update: (v: string) => void
} {
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    if (dictId == null) {
      setNote('')
      return
    }
    void wordbook.getNote(dictId).then((n) => {
      if (alive) setNote(n ?? '')
    })
    return () => {
      alive = false
    }
  }, [dictId])

  const update = useCallback(
    (v: string): void => {
      setNote(v)
      if (dictId == null) return
      void (v.trim() ? wordbook.setNote(dictId, v) : wordbook.clearNote(dictId))
    },
    [dictId],
  )

  return { note, update }
}
