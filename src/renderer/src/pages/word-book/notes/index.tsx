import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, MoreHorizontal, Pencil, Search, StickyNote, Trash2 } from 'lucide-react'
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@/components/ui'
import { TopBar } from '@/components/layout/TopBar'
import { cn } from '@/lib/cn'
import { playWordAudio, resolveWordAudioUrl } from '@/lib/audio'
import { SpeakerIcon, useAudioPhase } from '@/components/common/SpeakerIcon'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useSettings } from '@/hooks/useSettings'
import * as wordbook from '@/wordbook'
import type { NoteCardData } from '@/wordbook'
import { relTime } from './relTime'

/**
 * 我的笔记：聚合展示用户挂在各单词上的私人笔记（全局归属模型，无词书归属——db/04）。
 * 顶部搜索框 + 排序（最近 / 最早 / 字母），下面是笔记列表；每条笔记一张卡（单词 + 音标 + 简义 + 笔记正文 + 相对时间）。
 * 接 @/wordbook：列表走 listNoteCards（JOIN dict 取展示字段），编辑走 setNote、清空走 clearNote（墓碑），
 * 点卡跳词表页深链定位（?dictId=）。相对时间用行 edit_time。
 */

type SortKey = 'recent' | 'oldest' | 'word'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: '最近编辑' },
  { key: 'oldest', label: '最早编辑' },
  { key: 'word', label: '按字母' },
]

export default function MyNotes(): React.JSX.Element {
  const navigate = useNavigate()
  const list = useAsyncData(() => wordbook.listNoteCards(), [])
  const notes = useMemo(() => list.data ?? [], [list.data])
  // 点词发音的口音随学习设置（真人音频；缺行/离线静默，无 TTS）。
  const accent = useSettings()?.accent ?? 'us'

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')

  const [editing, setEditing] = useState<NoteCardData | null>(null)
  const [removeTarget, setRemoveTarget] = useState<NoteCardData | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)

  const now = Date.now()
  const keyword = query.trim().toLowerCase()
  const visible = useMemo(() => {
    const filtered = notes.filter(
      (n) =>
        keyword === '' ||
        n.word.toLowerCase().includes(keyword) ||
        n.note.toLowerCase().includes(keyword) ||
        n.meaning.toLowerCase().includes(keyword)
    )
    const sorted = [...filtered]
    if (sort === 'recent') sorted.sort((a, b) => b.editTime - a.editTime)
    else if (sort === 'oldest') sorted.sort((a, b) => a.editTime - b.editTime)
    else sorted.sort((a, b) => a.word.localeCompare(b.word))
    return sorted
  }, [notes, keyword, sort])

  function requestRemove(note: NoteCardData): void {
    setRemoveTarget(note)
    setRemoveOpen(true)
  }

  async function handleRemove(): Promise<void> {
    if (!removeTarget) return
    await wordbook.clearNote(removeTarget.dictId)
    setRemoveOpen(false)
    await list.reload()
  }

  async function handleSaveEdit(text: string): Promise<void> {
    if (!editing) return
    await wordbook.setNote(editing.dictId, text)
    setEditing(null)
    await list.reload()
  }

  /** 点卡进词表页并深链定位该词。 */
  function openDetail(note: NoteCardData): void {
    navigate(`/wordbook/words?dictId=${note.dictId}`)
  }

  const hasNotes = notes.length > 0

  return (
    <>
      <TopBar segments={['单词本', '我的笔记']} backTo="/wordbook" />
      <div className="mx-auto max-w-3xl px-8 py-8 lg:px-10">
        {hasNotes && (
          <div className="mb-5 flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索单词或笔记内容"
                className="pl-9"
              />
            </div>
            <SortSelect sort={sort} onChange={setSort} />
          </div>
        )}

        {!hasNotes ? (
          <EmptyState />
        ) : visible.length === 0 ? (
          <NoMatch />
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((note) => (
              <NoteCard
                key={note.dictId}
                note={note}
                now={now}
                audioUrl={resolveWordAudioUrl(note, accent)}
                onSpeak={() => void playWordAudio(note, accent)}
                onOpen={() => openDetail(note)}
                onEdit={() => setEditing(note)}
                onRemove={() => requestRemove(note)}
              />
            ))}
          </div>
        )}
      </div>

      <EditNoteDialog note={editing} onOpenChange={(open) => !open && setEditing(null)} onSave={(t) => void handleSaveEdit(t)} />

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`清空「${removeTarget?.word}」的笔记？`}
        description="清空即删除这条笔记（多端同步移除），单词本身仍保留在词库里。此操作无法撤销。"
        confirmText="清空"
        confirmVariant="danger"
        onConfirm={() => void handleRemove()}
      />
    </>
  )
}

/** 排序选择器：直接用 CDS Select（rounded-lg 矩形触发器，无边框 ghost 风格，保持原始组件样式）。 */
function SortSelect({ sort, onChange }: { sort: SortKey; onChange: (s: SortKey) => void }): React.JSX.Element {
  return (
    <Select value={sort} onValueChange={(v) => onChange(v as SortKey)}>
      <SelectTrigger className="shrink-0" aria-label="排序方式">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SORTS.map((s) => (
          <SelectItem key={s.key} value={s.key}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * 单条笔记卡：整卡可点，进入该单词的词表详情；单词（点击朗读）+ 音标 + 简义 + 笔记正文 + 相对时间。
 * 内部的朗读按钮与操作菜单会阻止冒泡，避免误触发整卡跳转。
 */
function NoteCard({
  note,
  now,
  audioUrl,
  onSpeak,
  onOpen,
  onEdit,
  onRemove,
}: {
  note: NoteCardData
  now: number
  /** 这条笔记的单词发音 URL（供喇叭订阅播放态；无音频则 null）。 */
  audioUrl: string | null
  onSpeak: () => void
  onOpen: () => void
  onEdit: () => void
  onRemove: () => void
}): React.JSX.Element {
  // 喇叭平时藏着、hover 才显形；一旦出声就得钉住可见——否则鼠标一移开动画就跟着没了。
  const sounding = useAudioPhase(audioUrl) !== 'idle'
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault()
          onOpen()
        }
      }}
      className="group cursor-pointer p-4 transition-shadow hover:shadow-md focus-visible:shadow-focus focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onSpeak()
              }}
              className="btn-squish inline-flex items-center gap-1 text-left font-serif text-lg font-semibold text-text-primary"
              aria-label={`朗读 ${note.word}`}
            >
              {note.word}
              <SpeakerIcon
                url={audioUrl}
                className={cn(
                  'size-3.5 text-text-muted transition-opacity',
                  sounding ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
              />
            </button>
            {note.phonetic && <span className="text-xs text-text-muted">{note.phonetic}</span>}
          </div>
          {note.meaning && <p className="mt-0.5 text-xs text-text-secondary">{note.meaning}</p>}
        </div>
        <NoteActionsMenu onEdit={onEdit} onRemove={onRemove} />
      </div>

      <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{note.note}</p>

      <div className="mt-3 flex items-center gap-1 text-xs text-text-muted">
        <Clock className="size-3" />
        {relTime(note.editTime, now)}
      </div>
    </Card>
  )
}

/** 卡片右上角操作菜单：悬停 / 聚焦 / 展开时浮现，含编辑、删除。对齐词书卡的操作菜单。 */
function NoteActionsMenu({ onEdit, onRemove }: { onEdit: () => void; onRemove: () => void }): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="iconXs"
          aria-label="更多操作"
          onClick={(e) => e.stopPropagation()}
          className="-mr-1 -mt-0.5 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="size-4 text-text-muted" />
          编辑
        </DropdownMenuItem>
        <DropdownMenuItem className="text-text-danger" onSelect={onRemove}>
          <Trash2 className="size-4" />
          清空
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 编辑笔记弹窗：传入 note 即打开，按其正文预填；对齐背词页的笔记弹窗。 */
function EditNoteDialog({
  note,
  onOpenChange,
  onSave,
}: {
  note: NoteCardData | null
  onOpenChange: (open: boolean) => void
  onSave: (text: string) => void
}): React.JSX.Element {
  const [text, setText] = useState('')

  // 打开（note 从 null 变为某条）时按其正文预填。
  useEffect(() => {
    if (note) setText(note.note)
  }, [note])

  const canSave = text.trim().length > 0

  return (
    <Dialog open={note != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{note?.word} · 笔记</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-note">我的笔记</Label>
          <Textarea
            id="edit-note"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="记录助记、搭配、易错点…"
            className="min-h-28"
            autoFocus
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">取消</Button>
          </DialogClose>
          <Button variant="primary" disabled={!canSave} onClick={() => onSave(text.trim())}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 完全没有笔记时的空态。 */
function EmptyState(): React.JSX.Element {
  return (
    <Card className="flex flex-col items-center gap-3 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-card bg-bg-neutral text-text-muted">
        <StickyNote className="size-6" />
      </span>
      <p className="text-sm font-semibold text-text-primary">还没有任何笔记</p>
    </Card>
  )
}

/** 搜索 / 过滤无命中时的态。 */
function NoMatch(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-bg-neutral-chip">
        <Search className="size-5 text-text-muted" />
      </div>
      <p className="text-sm text-text-primary">没有匹配的笔记</p>
    </div>
  )
}
