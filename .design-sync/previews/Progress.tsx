import { Progress } from 'desktop'

/** Black fill (default) — used for almost all progress, per the black-is-primary rule. */
export function Default() {
  return (
    <div className="flex flex-col gap-4 w-full max-w-sm">
      <Progress value={23} />
      <Progress value={68} />
      <Progress value={100} />
    </div>
  )
}

/** Clay fill (`tone="brand"`) — reserve for the single headline metric on a screen. */
export function Brand() {
  return (
    <div className="flex flex-col gap-2 w-full max-w-sm">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">今日目标</span>
        <span className="font-medium text-foreground">68%</span>
      </div>
      <Progress value={68} tone="brand" />
    </div>
  )
}
