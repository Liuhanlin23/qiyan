import { ScrollArea } from 'desktop'

/** 自定义滚动条（桌面端比原生滚动条更精致）—— 词表 / 长列表。 */
export function Basic() {
  return (
    <ScrollArea className="h-44 w-full max-w-xs rounded-lg border border-border p-3">
      <div className="flex flex-col gap-2 text-sm text-foreground">
        {Array.from({ length: 24 }).map((_, i) => (
          <div key={i}>单词 {i + 1}</div>
        ))}
      </div>
    </ScrollArea>
  )
}
