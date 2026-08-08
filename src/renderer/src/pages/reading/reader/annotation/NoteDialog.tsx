import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@/components/ui'
import type { AnnotationRecord } from '@/reading'
import { highlightTextClass, pageLabel, relativeDay, snippet } from '../util'

/**
 * 写 / 编辑笔记的模态对话框 —— 划词「写笔记」、点正文笔记锚点气泡、左侧栏标注条「编辑」都唤起它。
 * 顶部显所属页码（现算，同侧栏口径）· 相对时间；中部把这条高亮的原文按其色/线型只读画出（写作时的上下文）；
 * 下部是 markdown 编辑器；底部可删整条标注。
 *
 * **草稿语义（显式保存）**：编辑只改本地草稿，点「完成」才写回（`onSave`）；点关闭 / 遮罩 / Esc
 * 一律丢弃草稿、不保存。`annotation` 为 null 即关闭，受控开合由父层的 activeNoteId 决定。
 */

/**
 * 笔记长度上限。`note` 落 MySQL `TEXT`（物理上限 65535 字节），超限的行会被服务端守卫拒收
 * → 本地有、永不同步。15000 字符 × UTF-8 每字符至多 4 字节 = 60KB < 65535，含 emoji 也安全。
 */
const NOTE_MAX_LEN = 15000

export interface NoteDialogProps {
  /** 正在编辑的标注；null=对话框关闭。 */
  annotation: AnnotationRecord | null
  /** 这条标注的现算页号（与侧栏同源同值，出自同一张分页表）；null=未就绪则不显页码。 */
  page: number | null
  /** 点「完成」保存草稿：写回并按笔记有无增删正文里的笔记锚点。 */
  onSave: (id: string, note: string) => void
  /** 删除整条标注（连正文高亮一起）。 */
  onRemove: (id: string) => void
  /** 关闭对话框（点遮罩 / Esc / 关闭按钮 / 完成）；非「完成」路径不保存草稿。 */
  onClose: () => void
}

export function NoteDialog({
  annotation,
  page,
  onSave,
  onRemove,
  onClose,
}: NoteDialogProps): React.JSX.Element {
  return (
    <Dialog
      open={annotation != null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {annotation && (
        // key=标注 id：每次打开（或切换标注）都重挂，草稿重置为该条的当前笔记，不残留上一条的编辑。
        <NoteDialogBody
          key={annotation.id}
          annotation={annotation}
          page={page}
          onSave={onSave}
          onRemove={onRemove}
          onClose={onClose}
        />
      )}
    </Dialog>
  )
}

/** 对话框主体（草稿宿主）：本地 state 存编辑中的笔记，仅「完成」时提交。 */
function NoteDialogBody({
  annotation,
  page,
  onSave,
  onRemove,
  onClose,
}: {
  annotation: AnnotationRecord
  page: number | null
  onSave: (id: string, note: string) => void
  onRemove: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(annotation.note)
  const label = pageLabel(page)
  const meta = `${label != null ? `${label} · ` : ''}${relativeDay(annotation.createdAt)}`

  // 点「完成」：草稿有变化才写回（省一次无谓 IPC + 锚点重绘），随后关闭。
  const handleDone = (): void => {
    if (draft !== annotation.note) onSave(annotation.id, draft)
    onClose()
  }

  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>笔记</DialogTitle>
        <p className="text-xs tabular-nums text-text-muted">{meta}</p>
      </DialogHeader>

      {/* 原文（只读上下文）：按这条高亮的色 + 线型画出。 */}
      <div className="max-h-32 overflow-y-auto rounded-lg bg-bg-200 p-3">
        <span className={highlightTextClass(annotation.color, annotation.style)}>
          {snippet(annotation.text, 300)}
        </span>
      </div>

      {/* 笔记编辑器：只改本地草稿，点「完成」才提交。 */}
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="写点笔记…（支持 Markdown）"
        className="min-h-[160px] text-sm"
        maxLength={NOTE_MAX_LEN}
        autoFocus
      />

      <DialogFooter className="sm:justify-between">
        <Button
          variant="ghost"
          onClick={() => onRemove(annotation.id)}
          className="text-text-danger hover:bg-bg-danger-chip hover:text-text-danger"
        >
          <Trash2 className="size-4" />
          删除标注
        </Button>
        <Button onClick={handleDone}>完成</Button>
      </DialogFooter>
    </DialogContent>
  )
}
