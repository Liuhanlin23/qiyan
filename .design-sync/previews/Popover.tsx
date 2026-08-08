import { Popover, PopoverTrigger, PopoverContent, Button } from 'desktop'

/** 锚定浮层（预览设为常开）—— 筛选、小面板的地基。 */
export function Basic() {
  return (
    <div className="flex justify-center pb-2">
      <Popover open>
        <PopoverTrigger asChild>
          <Button variant="secondary">筛选</Button>
        </PopoverTrigger>
        <PopoverContent className="text-sm text-muted-foreground">
          按难度、词性、掌握状态筛选当前词表。
        </PopoverContent>
      </Popover>
    </div>
  )
}
