import { HoverCard, HoverCardTrigger, HoverCardContent } from 'desktop'

/** 悬停浮出卡片（预览设为常开）—— 词汇 App 里悬停单词浮出释义。 */
export function Basic() {
  return (
    <div className="flex justify-center pb-2">
      <HoverCard open>
        <HoverCardTrigger className="cursor-default font-medium underline underline-offset-4">
          ubiquitous
        </HoverCardTrigger>
        <HoverCardContent className="text-sm">
          <div className="font-serif text-base">ubiquitous</div>
          <div className="mt-1 text-muted-foreground">adj. 无处不在的；普遍存在的</div>
        </HoverCardContent>
      </HoverCard>
    </div>
  )
}
