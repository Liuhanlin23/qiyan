import { Separator } from 'desktop'

/** Horizontal rule between stacked content. */
export function Horizontal() {
  return (
    <div className="w-full max-w-sm">
      <div className="text-sm text-foreground">四级核心词汇</div>
      <Separator className="my-3" />
      <div className="text-sm text-muted-foreground">大学英语四级 · 538 词</div>
    </div>
  )
}

/** Vertical rule inside an inline row (parent sets the height). */
export function Vertical() {
  return (
    <div className="flex h-6 items-center gap-3 text-sm text-muted-foreground">
      <span>已学 124</span>
      <Separator orientation="vertical" />
      <span>待复习 32</span>
      <Separator orientation="vertical" />
      <span>共 538</span>
    </div>
  )
}
