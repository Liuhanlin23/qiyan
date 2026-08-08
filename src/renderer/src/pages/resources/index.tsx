import { useSearchParams } from 'react-router-dom'
import { TopBar } from '@/components/layout/TopBar'
import { cn } from '@/lib/cn'
import { CategoryContent, CategoryIcon, RESOURCE_CATEGORIES } from './catalog'

/**
 * 资源页 · 参考 iOS 单栏逐级下钻。
 *
 * L1 —— 大类功能卡（彩色图标 + 标题 / 副标题）横向网格；点卡进入 L2（音标网格 / 真题封面列表 / 语法列表）。
 * L1↔L2 走路由（?category= 搜索参数压入历史）。顶栏 L1 只标「资源」（无返回）；L2 标「资源 / 分类」+ 纯图标返回（清空参数回 L1）。
 * comingSoon 的大类只在 L1 露出占位卡（置灰不可点），手输 URL 参数也回落 L1。
 * 全为占位数据（见 catalog）。
 */
export default function Resources(): React.JSX.Element {
  const [params, setParams] = useSearchParams()
  const active =
    RESOURCE_CATEGORIES.find((c) => c.id === params.get('category') && !c.comingSoon) ?? null

  return (
    <>
      <TopBar segments={active ? ['资源', active.title] : ['资源']} onBack={() => setParams({})} />
      <div className="mx-auto w-full max-w-5xl px-8 py-6 lg:px-10">
        {active ? (
          <CategoryContent categoryId={active.id} />
        ) : (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,300px),300px))]">
            {RESOURCE_CATEGORIES.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setParams({ category: category.id })}
                disabled={category.comingSoon}
                className={cn(
                  'btn-squish group flex flex-col gap-3 rounded-card bg-surface-1 p-4 text-left shadow-card-ring transition-colors',
                  category.comingSoon ? 'cursor-not-allowed opacity-55' : 'hover:bg-bg-200'
                )}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <CategoryIcon category={category} />
                  {category.comingSoon && (
                    <span className="shrink-0 text-xs text-text-muted">即将上线</span>
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-text-primary">{category.title}</span>
                  <span className="truncate text-xs text-text-muted">{category.subtitle}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
