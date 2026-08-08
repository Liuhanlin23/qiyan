import { useNavigate } from 'react-router-dom'
import { ChevronRight, LayoutTemplate } from 'lucide-react'
import { Card } from '@/components/ui'
import { DEMOS, type DemoEntry } from './registry'

/**
 * UI Demo 展厅 —— 列表页。按 group 分组罗列所有 demo,点击进入 /demos/{id} 预览。
 * 仅 DEV 注册(见 router)。加 demo 只需在 registry.tsx 追加一项。
 */
export default function DemoList(): React.JSX.Element {
  const navigate = useNavigate()
  const groups = groupDemos(DEMOS)

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-9 lg:px-10">
      <header className="mb-8">
        <h1 className="text-3xl font-medium tracking-tight text-text-primary">UI Demo 展厅</h1>
        <p className="mt-1.5 text-sm text-text-secondary">
          候选页面集中在这里,点任意 demo 查看真实效果。共 {DEMOS.length} 个。
        </p>
      </header>

      {DEMOS.length === 0 ? (
        <Card className="py-16 text-center text-sm text-text-secondary">还没有 demo,定案后会陆续加进来。</Card>
      ) : (
        <div className="space-y-10">
          {groups.map(([group, items]) => (
            <section key={group}>
              <h2 className="mb-3 text-[15px] font-semibold text-text-primary">{group}</h2>
              <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,300px),300px))]">
                {items.map((demo) => (
                  <DemoCard key={demo.id} demo={demo} onClick={() => navigate(`/demos/${demo.id}`)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/** 单个 demo 卡片 —— 对齐单词本 FeatureCard:发丝描边卡片,hover 仅整卡克制加深(不换投影/不反白)。 */
function DemoCard({ demo, onClick }: { demo: DemoEntry; onClick: () => void }): React.JSX.Element {
  const Icon = demo.icon ?? LayoutTemplate
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-squish group flex items-center gap-3.5 rounded-card bg-surface-1 p-4 text-left shadow-card-ring transition-colors hover:bg-bg-200"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-bg-neutral text-text-secondary">
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-text-primary">{demo.title}</span>
        <span className="truncate text-xs text-text-secondary">{demo.description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

/** 按 group 聚合,保持 registry 内的出现顺序。 */
function groupDemos(demos: DemoEntry[]): [string, DemoEntry[]][] {
  const map = new Map<string, DemoEntry[]>()
  for (const d of demos) {
    const g = d.group ?? '未分类'
    const list = map.get(g)
    if (list) list.push(d)
    else map.set(g, [d])
  }
  return [...map.entries()]
}
