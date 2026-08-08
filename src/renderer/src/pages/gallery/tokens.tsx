// Design Token 面板 —— 设计师的核心把控面。每个色板用 token 工具类渲染,
// 并实时回读它在当前明暗下的计算真值。类名拼写均与组件源码一致(双前缀:bg-bg-* / text-text-* / border-border-*)。
import { Block, Section, Swatch, TokenTile, type GallerySection } from './primitives'

const PAGE_BG = ['bg-bg-000', 'bg-bg-100', 'bg-bg-200', 'bg-bg-300', 'bg-bg-400', 'bg-bg-500']
const SURFACE = [
  'bg-surface-0',
  'bg-surface-1',
  'bg-surface-2',
  'bg-surface-3',
  'bg-surface-panel',
  'bg-surface-popover',
]
const FILL = [
  'bg-fill-primary',
  'bg-fill-brand',
  'bg-fill-accent',
  'bg-fill-secondary',
  'bg-fill-danger',
  'bg-fill-success',
  'bg-fill-warning',
  'bg-fill-control',
  'bg-fill-field',
  'bg-fill-disabled',
]
const CHIP = [
  'bg-bg-accent-chip',
  'bg-bg-neutral-chip',
  'bg-bg-success-chip',
  'bg-bg-warning-chip',
  'bg-bg-danger-chip',
]
const TEXT = [
  'text-text-000',
  'text-text-100',
  'text-text-200',
  'text-text-300',
  'text-text-400',
  'text-text-500',
  'text-text-accent',
  'text-text-danger',
  'text-text-success',
  'text-text-warning',
  'text-text-muted',
  'text-text-disabled',
]
const BORDER = [
  'border-border-100',
  'border-border-200',
  'border-border-300',
  'border-border-400',
  'border-border-accent',
  'border-border-danger',
  'border-border-success',
  'border-border-warning',
  'border-border-strong',
  'border-border-stronger',
]
// 彩底 + 配套前景文字成对。
const ON_PAIRS: { fill: string; on: string; label: string }[] = [
  { fill: 'bg-fill-primary', on: 'text-on-primary', label: 'on-primary' },
  { fill: 'bg-fill-brand', on: 'text-on-brand', label: 'on-brand' },
  { fill: 'bg-fill-accent', on: 'text-on-accent', label: 'on-accent' },
  { fill: 'bg-fill-danger', on: 'text-on-danger', label: 'on-danger' },
  { fill: 'bg-fill-success', on: 'text-on-success', label: 'on-success' },
  { fill: 'bg-fill-warning', on: 'text-on-warning', label: 'on-warning' },
]

const RADIUS = ['rounded-card', 'rounded-lg', 'rounded-md', 'rounded-sm', 'rounded-full']
const SHADOW = [
  'shadow-sm',
  'shadow-md',
  'shadow-lg',
  'shadow-popover',
  'shadow-panel',
  'shadow-panel-sm',
  'shadow-card-ring',
  'shadow-field-ring',
  'shadow-focus',
  'shadow-tooltip',
]
const TYPE: { cls: string; sample: string }[] = [
  { cls: 'text-title', sample: '标题 Title 32' },
  { cls: 'text-heading', sample: '小标题 Heading' },
  { cls: 'text-body', sample: '正文 Body 文本' },
  { cls: 'text-caption', sample: '说明 Caption' },
  { cls: 'text-footnote', sample: '脚注 Footnote' },
  { cls: 'text-code', sample: 'const code = true' },
]
const FONTS = [
  { cls: 'font-sans', sample: '无衬线 Sans 字族' },
  { cls: 'font-mono', sample: '等宽 Mono 0O1l' },
]

function ColorTokens({ mode }: { mode: string }): React.JSX.Element {
  return (
    <Section
      id="tokens-color"
      title="颜色 Token"
      description="改色优先改 primitives.css；这里取用语义层 system.css 的双值,随明暗自动切换。"
    >
      <Block label="页面背景" hint="bg-bg-000 → 500 · 由亮到深">
        <div className="flex flex-wrap gap-3">
          {PAGE_BG.map((c) => (
            <Swatch key={c} className={c} mode={mode} />
          ))}
        </div>
      </Block>
      <Block label="表面 Surface" hint="卡片/面板/浮层底">
        <div className="flex flex-wrap gap-3">
          {SURFACE.map((c) => (
            <Swatch key={c} className={c} mode={mode} />
          ))}
        </div>
      </Block>
      <Block label="交互填充 Fill" hint="实色按钮/选中/控件底">
        <div className="flex flex-wrap gap-3">
          {FILL.map((c) => (
            <Swatch key={c} className={c} mode={mode} />
          ))}
        </div>
      </Block>
      <Block label="Chip 底色" hint="与 text-text-* 成对用于 Badge">
        <div className="flex flex-wrap gap-3">
          {CHIP.map((c) => (
            <Swatch key={c} className={c} mode={mode} />
          ))}
        </div>
      </Block>
      <Block label="彩底前景 On-color" hint="落在 fill-* 上的文字色">
        <div className="flex flex-wrap gap-3">
          {ON_PAIRS.map((p) => (
            <div key={p.label} className="flex w-32 flex-col gap-1.5">
              <div className={`flex h-12 items-center justify-center rounded-md ${p.fill}`}>
                <span className={`text-caption font-semibold ${p.on}`}>Aa 文字</span>
              </div>
              <span className="font-mono text-[11px] leading-tight text-text-200">{p.on}</span>
            </div>
          ))}
        </div>
      </Block>
      <Block label="文字色" hint="text-text-000 最重 → 500 最淡">
        <div className="flex flex-wrap gap-3">
          {TEXT.map((c) => (
            <Swatch key={c} className={c} mode={mode} kind="text" />
          ))}
        </div>
      </Block>
      <Block label="描边 Border" hint="默认细线 border-border-300">
        <div className="flex flex-wrap gap-3">
          {BORDER.map((c) => (
            <Swatch key={c} className={c} mode={mode} kind="border" />
          ))}
        </div>
      </Block>
    </Section>
  )
}

function ShapeTypeTokens(): React.JSX.Element {
  return (
    <Section id="tokens-shape" title="形状 · 阴影 · 排版" description="圆角、投影与字号阶梯。">
      <Block label="圆角 Radius">
        <div className="flex flex-wrap gap-3">
          {RADIUS.map((c) => (
            <TokenTile key={c} className={`${c} border border-border-300`} label={c} />
          ))}
        </div>
      </Block>
      <Block label="阴影 Shadow" hint="表面用 card-ring(描边环)；浮层才叠投影">
        <div className="flex flex-wrap gap-3">
          {SHADOW.map((c) => (
            <TokenTile key={c} className={`${c} rounded-card`} label={c} />
          ))}
        </div>
      </Block>
      <Block label="字号 Type" hint="text-title → text-footnote">
        <div className="flex flex-col gap-2">
          {TYPE.map((t) => (
            <div key={t.cls} className="flex items-baseline gap-4">
              <span className="w-28 shrink-0 font-mono text-[11px] text-text-400">{t.cls}</span>
              <span className={`${t.cls} text-text-100`}>{t.sample}</span>
            </div>
          ))}
        </div>
      </Block>
      <Block label="字族 Font">
        <div className="flex flex-col gap-2">
          {FONTS.map((f) => (
            <div key={f.cls} className="flex items-baseline gap-4">
              <span className="w-28 shrink-0 font-mono text-[11px] text-text-400">{f.cls}</span>
              <span className={`${f.cls} text-body text-text-100`}>{f.sample}</span>
            </div>
          ))}
        </div>
      </Block>
    </Section>
  )
}

export const TOKEN_SECTIONS: GallerySection[] = [
  { id: 'tokens-color', label: '颜色', render: (mode) => <ColorTokens mode={mode} /> },
  { id: 'tokens-shape', label: '形状·排版', render: () => <ShapeTypeTokens /> },
]
