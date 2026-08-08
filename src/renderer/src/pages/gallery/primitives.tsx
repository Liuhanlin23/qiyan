// Gallery 展示基元 —— 仅服务于组件浏览页本身,零业务耦合。
// 用 token 工具类渲染骨架; Swatch 通过 getComputedStyle 实时回读 token 在当前明暗下的真值,
// 方便设计师对照「类名 → 实际颜色」。这些基元不进 components/ui/(它们是文档脚手架,不是 DS 组件)。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** 画廊的一节:左侧目录与右侧内容共用同一份清单(manifest 驱动)。 */
export interface GallerySection {
  id: string
  label: string
  render: (mode: string) => ReactNode
}

/** 一个顶层分区:左侧目录据此锚点跳转,右侧据此渲染标题块。 */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <section id={id} className="scroll-mt-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-heading font-semibold text-text-100">{title}</h2>
        {description && <p className="text-footnote text-text-400">{description}</p>}
      </div>
      <div className="mt-5 flex flex-col gap-8">{children}</div>
    </section>
  )
}

/** 分区内的一小块,带可选标注。 */
export function Block({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-caption font-semibold text-text-300">{label}</h3>
        {hint && <span className="text-footnote text-text-400">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/** 横向自动换行的演示行,统一留白节奏。 */
export function Row({
  children,
  className,
  align = 'center',
}: {
  children: ReactNode
  className?: string
  align?: 'center' | 'start' | 'end'
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-wrap gap-3',
        align === 'center' && 'items-center',
        align === 'start' && 'items-start',
        align === 'end' && 'items-end',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** 单元演示:一个组件实例 + 下方小字注明它是哪个状态/变体。 */
export function Cell({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-start gap-2', className)}>
      <div className="flex min-h-9 items-center">{children}</div>
      <span className="font-mono text-[11px] leading-none text-text-400">{label}</span>
    </div>
  )
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/\d+(\.\d+)?/g)
  if (!m) return rgb
  const [r, g, b, a] = m.map(Number)
  const hex = (n: number): string => Math.round(n).toString(16).padStart(2, '0')
  const base = `#${hex(r)}${hex(g)}${hex(b)}`
  return a !== undefined && a < 1 ? `${base} · ${Math.round(a * 100)}%` : base
}

/** 回读某元素某 CSS 属性的计算值(随明暗切换实时更新)。 */
function useResolved(prop: string, deps: unknown[]): [React.RefObject<HTMLDivElement | null>, string] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [val, setVal] = useState('')
  useEffect(() => {
    if (!ref.current) return
    const v = getComputedStyle(ref.current).getPropertyValue(prop)
    setVal(prop.includes('color') || prop === 'background-color' ? rgbToHex(v) : v.trim())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return [ref, val]
}

/** 颜色色板:类名 + 实时真值。bg/fill/surface 类用作背景,text 类用文字示意。 */
export function Swatch({
  className,
  mode,
  kind = 'bg',
}: {
  className: string
  mode: string
  kind?: 'bg' | 'text' | 'border'
}): React.JSX.Element {
  const prop = kind === 'text' ? 'color' : kind === 'border' ? 'border-top-color' : 'background-color'
  const [ref, val] = useResolved(prop, [mode, className])
  return (
    <div className="flex w-32 flex-col gap-1.5">
      <div
        ref={ref}
        className={cn(
          'flex h-12 items-center justify-center rounded-md border border-border-200',
          kind === 'bg' && className,
          kind === 'border' && cn('border-2 bg-surface-1', className),
          kind === 'text' && cn('bg-surface-1', className),
        )}
      >
        {kind === 'text' && <span className="text-caption font-semibold">Ag</span>}
      </div>
      <div className="flex flex-col">
        <span className="font-mono text-[11px] leading-tight text-text-200">{className}</span>
        <span className="font-mono text-[10px] leading-tight text-text-400">{val || '—'}</span>
      </div>
    </div>
  )
}

/** 阴影 / 圆角等结构 token 的示意块。 */
export function TokenTile({
  className,
  label,
}: {
  className: string
  label?: string
}): React.JSX.Element {
  return (
    <div className="flex w-32 flex-col gap-1.5">
      <div className={cn('h-14 bg-surface-1', className)} />
      <span className="font-mono text-[11px] leading-tight text-text-200">{label ?? className}</span>
    </div>
  )
}

/** props 速查表 —— 每行一个属性。 */
export function PropsTable({
  rows,
}: {
  rows: { name: string; type: string; def?: string; note?: string }[]
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-card border border-border-300">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-bg-200">
            {['属性', '类型', '默认', '说明'].map((h) => (
              <th key={h} className="px-3 py-2 text-footnote font-semibold text-text-300">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-border-200 align-top">
              <td className="px-3 py-2">
                <code className="font-mono text-footnote text-text-100">{r.name}</code>
              </td>
              <td className="px-3 py-2">
                <code className="font-mono text-[11px] text-text-accent">{r.type}</code>
              </td>
              <td className="px-3 py-2">
                <code className="font-mono text-[11px] text-text-400">{r.def ?? '—'}</code>
              </td>
              <td className="px-3 py-2 text-footnote text-text-400">{r.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
