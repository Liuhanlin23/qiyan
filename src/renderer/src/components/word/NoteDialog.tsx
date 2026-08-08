import { useEffect, useState } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from '@/components/ui'

/**
 * 词笔记编辑弹框（词表 / 今日 / 学习卡共用）：居中模态，标题「{word} · 笔记」+ 大输入框 + 取消/保存。
 * 受控开合（open / onOpenChange）；每次打开以 initial 填充本地草稿，仅「保存」时经 onSave 上抛文本（空串即清空）。
 */
export function NoteDialog({
  open,
  onOpenChange,
  word,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  word: string
  initial: string
  onSave: (note: string) => void
}): React.JSX.Element {
  const [text, setText] = useState(initial)
  useEffect(() => {
    if (open) setText(initial)
  }, [open, initial])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{word} · 笔记</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="note-input">我的笔记</Label>
          <Textarea
            id="note-input"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="记录助记、搭配、易错点…"
            autoFocus
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">取消</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => onSave(text)}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
