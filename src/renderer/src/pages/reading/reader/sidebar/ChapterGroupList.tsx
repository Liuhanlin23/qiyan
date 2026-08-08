import type { ChapterGroup } from './grouping'

/**
 * 侧栏「按章分组」列表骨架 —— 滚动容器 + 每章一个标题 + 该章条目栈。
 * 标注页签与书签页签共用，条目本体由各自的 `renderItem` 给出。
 */
export function ChapterGroupList<T>({
  groups,
  renderItem,
}: {
  groups: ChapterGroup<T>[]
  renderItem: (item: T) => React.ReactNode
}): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
      {groups.map((group) => (
        <div key={group.key} className="pb-1">
          <h3 className="truncate px-2 pb-1 pt-3 text-xs font-medium text-text-muted">{group.label}</h3>
          <div className="flex flex-col gap-1.5">{group.items.map(renderItem)}</div>
        </div>
      ))}
    </div>
  )
}
