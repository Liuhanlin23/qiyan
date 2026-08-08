import { Skeleton } from 'desktop'

/** 加载占位（api 未接时先上骨架屏，防白屏闪烁）。 */
export function Basic() {
  return (
    <div className="flex w-full max-w-sm items-center gap-4">
      <Skeleton className="size-12 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  )
}
