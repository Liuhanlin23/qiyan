import { useState } from 'react'
import { BookMinus, BookPlus, CircleCheck, MoreHorizontal, SquarePen } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
} from '@/components/ui'
import { NoteDialog } from '@/components/word/NoteDialog'

/**
 * 词卡右上角动作栏：聚合各页差异的按钮集合（笔记 / 更多）。
 * 笔记 popover（WordDetail）/ dialog（study）；「更多(⋯)」下拉按需含 加入学习 / 移除学习（按是否在词库切换）
 * 与 标记掌握 / 取消标熟。各弹层 open 态可受控（父页托管）或组件内自持；破坏性项（移除学习）的二次确认由父页托管。
 */

interface WordActionBarProps {
  word: string

  // ═══ 笔记（三页都有，但形态/内容注入不同）
  showNote?: boolean
  /** 笔记内容（用于显示已有笔记状态） */
  noteValue?: string
  /** 笔记弹层形态：'popover'（WordDetail）| 'dialog'（study） */
  noteMode?: 'popover' | 'dialog'
  /** 笔记保存回调 */
  onNoteChange?: (value: string) => void
  /** 笔记弹层打开状态（受控；不提供则组件内自持） */
  noteOpen?: boolean
  onNoteOpenChange?: (open: boolean) => void
  /** 自定义笔记内容注入（若提供，覆盖默认 Textarea） */
  noteContent?: React.ReactNode

  // ═══ 更多（⋯ 菜单）：加入学习 / 移除学习 + 标记掌握 / 取消标熟
  /** 菜单内「加入学习 / 移除学习」项（按 inLibrary 切换文案与语义） */
  showLibrary?: boolean
  /** 是否已在词库：true → 「移除学习」，false → 「加入学习」 */
  inLibrary?: boolean
  onToggleLibrary?: () => void
  /** 菜单内「标记掌握 / 取消标熟」项 */
  showMaster?: boolean
  mastered?: boolean
  onMasterClick?: () => void
}

export function WordActionBar({
  word,
  showNote = false,
  noteValue,
  noteMode = 'popover',
  onNoteChange,
  noteOpen,
  onNoteOpenChange,
  noteContent,
  showLibrary = false,
  inLibrary = false,
  onToggleLibrary,
  showMaster = false,
  mastered,
  onMasterClick,
}: WordActionBarProps): React.JSX.Element {
  // 弹层 open：父页可受控（提供 open + onOpenChange），否则组件内自持。
  const [noteSelfOpen, setNoteSelfOpen] = useState(false)

  const noteOpenValue = noteOpen ?? noteSelfOpen
  const setNoteOpen = onNoteOpenChange ?? setNoteSelfOpen

  return (
    <div className="flex shrink-0 items-center gap-1">
      {/* 笔记：popover（WordDetail）或 dialog（study） */}
      {showNote &&
        (noteMode === 'popover' ? (
          <Popover open={noteOpen !== undefined ? noteOpenValue : undefined} onOpenChange={onNoteOpenChange}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="笔记"
                title="笔记"
                className={noteValue ? 'text-text-secondary' : 'text-text-muted'}
              >
                <SquarePen className="size-[18px]" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              {noteContent ?? (
                <>
                  <p className="mb-2 text-xs font-semibold text-text-secondary">我的笔记 · {word}</p>
                  <Textarea
                    value={noteValue}
                    onChange={(e) => onNoteChange?.(e.target.value)}
                    placeholder="记点什么，帮助记忆…"
                    rows={4}
                  />
                </>
              )}
            </PopoverContent>
          </Popover>
        ) : (
          <>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="笔记"
              title="笔记"
              className={noteValue ? 'text-text-secondary' : 'text-text-muted'}
              onClick={() => setNoteOpen(true)}
            >
              <SquarePen className="size-[18px]" />
            </Button>
            <NoteDialog
              open={noteOpenValue}
              onOpenChange={setNoteOpen}
              word={word}
              initial={noteValue ?? ''}
              onSave={(t) => {
                onNoteChange?.(t)
                setNoteOpen(false)
              }}
            />
          </>
        ))}

      {/* 更多（⋯）：加入学习 / 移除学习 + 标记掌握 / 取消标熟收进下拉 */}
      {(showLibrary || showMaster) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label="更多操作" title="更多" className="text-text-muted">
              <MoreHorizontal className="size-[18px]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[9rem]">
            {showMaster && (
              <DropdownMenuItem onSelect={onMasterClick}>
                <CircleCheck className={cn('size-4', mastered && 'text-fill-success')} />
                {mastered ? '取消标熟' : '标记掌握'}
              </DropdownMenuItem>
            )}
            {showLibrary && showMaster && <DropdownMenuSeparator />}
            {showLibrary &&
              (inLibrary ? (
                // 移除学习：破坏性（连学习进度一并置墓碑），危险色标注；二次确认由父页托管。
                <DropdownMenuItem onSelect={onToggleLibrary} className="text-text-danger">
                  <BookMinus className="size-4" />
                  移除学习
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={onToggleLibrary}>
                  <BookPlus className="size-4" />
                  加入学习
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
