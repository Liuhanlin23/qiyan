// 组件浏览页(Gallery) —— 设计师把控 CDS token 与组件的单一入口。
// 仅在 DEV 注册(见 router/index.tsx),不进侧栏、不打进生产包。
// data-mode 设在本页根容器上 → 只切换预览区明暗,不污染全局。
import { useEffect, useMemo, useRef, useState } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui'
import { cn } from '@/lib/cn'
import { TOKEN_SECTIONS } from './tokens'
import { COMPONENT_SECTIONS } from './components'
import type { GallerySection } from './primitives'

type Mode = 'light' | 'dark'

const GROUPS: { title: string; items: GallerySection[] }[] = [
  { title: 'Design Tokens', items: TOKEN_SECTIONS },
  { title: '组件', items: COMPONENT_SECTIONS },
]

export default function Gallery(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('light')
  const [active, setActive] = useState<string>(TOKEN_SECTIONS[0]?.id ?? '')
  const scrollRef = useRef<HTMLDivElement>(null)

  const all = useMemo(() => GROUPS.flatMap((g) => g.items), [])

  // 滚动监视:高亮当前可见分区。
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    )
    all.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, [all])

  const jump = (id: string): void => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div data-mode={mode} className="flex h-screen w-screen flex-col bg-bg-100 text-text-200">
      {/* 顶栏 */}
      <header className="flex shrink-0 items-center justify-between border-b border-border-200 px-6 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-caption font-semibold text-text-100">启言 · 组件库</span>
          <span className="text-footnote text-text-400">CDS Gallery · {all.length} 个分区</span>
        </div>
        <ToggleGroup value={mode} onValueChange={(v) => v && setMode(v as Mode)}>
          <ToggleGroupItem value="light">浅色</ToggleGroupItem>
          <ToggleGroupItem value="dark">深色</ToggleGroupItem>
        </ToggleGroup>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左侧目录 */}
        <nav className="w-52 shrink-0 overflow-y-auto border-r border-border-200 px-3 py-4">
          {GROUPS.map((g) => (
            <div key={g.title} className="mb-5">
              <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-500">
                {g.title}
              </div>
              <div className="flex flex-col">
                {g.items.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => jump(s.id)}
                    className={cn(
                      'rounded-md px-2 py-1.5 text-left text-footnote transition-colors',
                      active === s.id
                        ? 'bg-bg-300 font-medium text-text-100'
                        : 'text-text-400 hover:bg-fill-ghost-hover hover:text-text-200',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* 右侧内容 */}
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-14 px-8 py-8">
            {all.map((s) => (
              <div key={s.id}>{s.render(mode)}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
