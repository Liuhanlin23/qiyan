import {
  Dialog, DialogTrigger, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter, Button,
} from 'desktop'

/** 模态对话框（白底 bg-popover + 衬线标题 + 柔和 overlay 阴影）。点按钮打开。 */
export function Basic() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>新建笔记</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建笔记</DialogTitle>
          <DialogDescription>为这个单词记一条笔记，复习时一并显示。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost">取消</Button>
          <Button>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
