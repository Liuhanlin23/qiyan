import { Collapsible, CollapsibleTrigger, CollapsibleContent, Button } from 'desktop'

/** 轻量展开/收起单块内容（无 Accordion 的分组语义）。 */
export function Basic() {
  return (
    <Collapsible defaultOpen className="flex w-full max-w-sm flex-col gap-2">
      <CollapsibleTrigger asChild>
        <Button variant="secondary" className="w-full justify-between">高级选项</Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
        这里是展开后的内容：自定义复习算法、导出格式等。
      </CollapsibleContent>
    </Collapsible>
  )
}
