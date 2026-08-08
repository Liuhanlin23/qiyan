import { Tabs, TabsList, TabsTrigger, TabsContent } from 'desktop'

/** Segmented control: the active trigger lifts onto a white surface (the Sidebar "active pill" idiom). */
export function Segmented() {
  return (
    <Tabs defaultValue="all" className="w-full max-w-md">
      <TabsList>
        <TabsTrigger value="all">全部</TabsTrigger>
        <TabsTrigger value="learning">在学</TabsTrigger>
        <TabsTrigger value="done">已完成</TabsTrigger>
      </TabsList>
      <TabsContent value="all" className="text-sm text-muted-foreground">全部词书 · 共 6 本</TabsContent>
      <TabsContent value="learning" className="text-sm text-muted-foreground">在学 · 2 本</TabsContent>
      <TabsContent value="done" className="text-sm text-muted-foreground">已完成 · 1 本</TabsContent>
    </Tabs>
  )
}
