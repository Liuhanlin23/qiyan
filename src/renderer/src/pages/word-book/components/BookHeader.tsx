import { Search } from 'lucide-react'
import { Input, ToggleGroup, ToggleGroupItem } from '@/components/ui'

/**
 * 单词本双栏页全宽顶栏：段切换（ToggleGroup）+ 单词搜索框。段集合由调用方传入，
 * 故词库页（5 态滤镜）与今日页（今日学习 / 复习二段）共用一套顶栏；搜索防抖等取数策略留在各页。
 */
export function BookHeader<K extends string>({
  segments,
  segment,
  onSegmentChange,
  query,
  onQueryChange,
}: {
  segments: readonly { key: K; label: string }[]
  segment: K
  onSegmentChange: (s: K) => void
  query: string
  onQueryChange: (q: string) => void
}): React.JSX.Element {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-200 px-4">
      <ToggleGroup value={segment} onValueChange={(v) => v && onSegmentChange(v as K)}>
        {segments.map((s) => (
          <ToggleGroupItem key={s.key} value={s.key}>
            {s.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="relative ml-auto w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索单词"
          className="h-9 rounded-lg pl-9"
        />
      </div>
    </header>
  )
}
