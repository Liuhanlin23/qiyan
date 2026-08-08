import { Badge } from 'desktop'

/** Black `default` + neutral `secondary` + hairline `outline`. */
export function Variants() {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <Badge>必学</Badge>
      <Badge variant="secondary">CET-4</Badge>
      <Badge variant="outline">名词</Badge>
    </div>
  )
}

/** Soft status fills — the claude.ai `bg-soft-*` + status-text pairs. */
export function Status() {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <Badge variant="info">学习中</Badge>
      <Badge variant="success">已掌握</Badge>
      <Badge variant="warning">待复习</Badge>
      <Badge variant="danger">易错</Badge>
      <Badge variant="discovery">AI 释义</Badge>
    </div>
  )
}

/** A leading status dot (a `bg-current` child) reads as a live state. */
export function WithDot() {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <Badge variant="success">
        <span className="size-1.5 rounded-full bg-current" />
        在学
      </Badge>
      <Badge variant="warning">
        <span className="size-1.5 rounded-full bg-current" />
        32 待复习
      </Badge>
    </div>
  )
}
