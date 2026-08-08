import {
  Sheet, SheetTrigger, SheetContent, SheetHeader,
  SheetTitle, SheetDescription, Button,
} from 'desktop'

/** 侧滑面板（白底 + overlay 阴影）。点按钮从右侧滑出。 */
export function Basic() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="secondary">打开筛选面板</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>筛选</SheetTitle>
          <SheetDescription>按难度与词性筛选当前词表。</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  )
}
