import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/cn'

/**
 * 单词本左栏列表 —— master-detail 的「master」：橙竖条词数统计 + 平铺可选单词行。
 * 纯展示，词条筛选/搜索由父页负责，只接收已过滤好的行并按 dictId 回调选中。
 * 行只需拼写 + dictId（详情由父页按 dictId 读取组装），缺行（dict 未缓存）term=null 显「待补全」占位。
 */

/** 左栏一行：dictId 主键 + 冗余拼写（缺行为 null）。 */
export interface WordRow {
  dictId: number
  term: string | null
}

export function WordList({
  words,
  selectedId,
  onSelect,
}: {
  words: WordRow[]
  selectedId: number | null
  onSelect: (dictId: number) => void
}): React.JSX.Element {
  // 词表虚拟滚动：整段几千词只渲染视口内 ~30 行，切段/搜索时不再全量挂载。
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: words.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 12,
    getItemKey: (index) => words[index].dictId,
  })

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-border-200">
      <div className="flex flex-col gap-3 px-3 pb-2 pt-3">
        {/* 橙竖条统计（对齐 iOS WordListStatsRow） */}
        <div className="flex items-center gap-2.5 px-1">
          <span className="h-4 w-[3px] rounded-full bg-fill-brand" />
          <span className="text-sm font-semibold text-text-primary tabular-nums">{words.length} 词</span>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {words.length === 0 ? (
          <p className="px-3 pt-8 text-center text-sm text-text-muted">这里暂时没有单词</p>
        ) : (
          <ul className="relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const w = words[vi.index]
              return (
                <li
                  key={vi.key}
                  data-index={vi.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute inset-x-0 top-0"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  <WordListItem
                    index={vi.index + 1}
                    term={w.term}
                    active={w.dictId === selectedId}
                    onSelect={() => onSelect(w.dictId)}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}

function WordListItem({
  index,
  term,
  active,
  onSelect,
}: {
  index: number
  term: string | null
  active: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
        active ? 'bg-bg-400' : 'hover:bg-bg-300'
      )}
    >
      <span className="w-6 shrink-0 text-xs tabular-nums text-text-muted">{String(index).padStart(2, '0')}</span>
      {term ? (
        <span className={cn('min-w-0 flex-1 truncate text-sm', active ? 'font-medium text-text-primary' : 'text-text-secondary')}>
          {term}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm italic text-text-muted">待补全</span>
      )}
    </button>
  )
}
