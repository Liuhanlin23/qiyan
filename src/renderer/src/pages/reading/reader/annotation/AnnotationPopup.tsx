import { useState } from 'react'
import { BookText, Check, Copy, Highlighter, Languages, PenLine, Trash2, Volume2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui'
import { HIGHLIGHT_COLORS, HIGHLIGHT_PALETTE } from '../constants'
import { useViewportAnchor } from './useViewportAnchor'
import type { HighlightColor, HighlightStyle } from '@/reading'

/**
 * 选中文字后浮出的标注工具栏 —— 复制 / 高亮 / 写笔记 / 查词 / 翻译 / 朗读。
 * 对齐 readest 的两级交互：功能栏点「高亮」→ 立刻以当前线型 + 记忆色落一条，并在其下方
 * 展开线型（填充 / 下划线 / 波浪）+ 颜色微调条（二级操作，落高亮前不显示）；再点（此时该键变
 * 删除）移除该高亮、微调条随之收起。切线型 / 换色就地重绘同一条，每种线型各自记住上次用色。
 * 若选区本就是某条高亮，弹层直接进入编辑该条（微调条已展开、按钮为删除），不再新建。
 * 查词与翻译都不在本工具栏内展开，各自由宿主浮出独立弹层（`DictPopup` / `TranslatorPopup`）。
 * 贴着选区下方定位（fixed），随选区清除而消失。
 */

export interface AnnotationPopupProps {
  /** 锚点：水平中点 x + 下沿 y + 选区高度（翻到上方时据 height 让开选中的字）。 */
  anchor: { x: number; y: number; height: number }
  /** 选区若已是某条高亮：传入它，弹层直接进入「编辑该条」模式（微调条已展开、按钮为删除），不再新建。 */
  existingHighlight?: { id: string; color: HighlightColor; style: HighlightStyle }
  /**
   * 落笔的初始线型（会话级全局记忆的种子）：上次划词用的线型带进来。
   * 缺省 `fill`。`existingHighlight` 存在时以它的线型为准。
   */
  initialStyle?: HighlightStyle
  /** 各线型各自记住的上次用色（会话级全局记忆）：切线型时颜色跟随。缺省三线型皆黄。 */
  initialStyleColors?: Record<HighlightStyle, HighlightColor>
  /** 点荧光笔即以给定线型/颜色落一条高亮，返回其 id 供随后微调。 */
  onHighlight: (color: HighlightColor, style: HighlightStyle) => string
  /** 微调本次高亮：改线型或颜色时按 id 就地重绘，不新增记录。 */
  onRestyleHighlight: (id: string, color: HighlightColor, style: HighlightStyle) => void
  /** 删除本次高亮：按 id 移除该条记录。 */
  onRemoveHighlight: (id: string) => void
  onWriteNote: () => void
  /** 点「翻译」：由宿主浮出独立的句子翻译框（TranslatorPopup），不在本工具栏内展开。 */
  onTranslate: () => void
  /**
   * 点「查词」：由宿主浮出独立的查词卡（DictPopup），不在本工具栏内展开。
   * **不传即隐藏「查词」入口**——该选区取不出可查的词（清洗后为空，如全是标点 / 符号），
   * 摆一个点了必然「未收录」的按钮没有意义（docs/feature/reading/lookup.md §取词·守卫与降级）。
   */
  onLookup?: () => void
  onCopy: () => void
  onSpeak: () => void
}

/** 会话记忆缺省种子：默认线型填充、三线型初始都记黄色。 */
const DEFAULT_STYLE: HighlightStyle = 'fill'
const DEFAULT_STYLE_COLORS: Record<HighlightStyle, HighlightColor> = {
  fill: 'yellow',
  underline: 'yellow',
  wavy: 'yellow',
}

const STYLE_OPTIONS: { value: HighlightStyle; label: string }[] = [
  { value: 'fill', label: '填充' },
  { value: 'underline', label: '下划线' },
  { value: 'wavy', label: '波浪线' },
]

export function AnnotationPopup({
  anchor,
  existingHighlight,
  initialStyle = DEFAULT_STYLE,
  initialStyleColors = DEFAULT_STYLE_COLORS,
  onHighlight,
  onRestyleHighlight,
  onRemoveHighlight,
  onWriteNote,
  onTranslate,
  onLookup,
  onCopy,
  onSpeak,
}: AnnotationPopupProps): React.JSX.Element {
  // 当前线型 + 每种线型各自记忆的颜色：切线型时颜色跟随（对齐 readest）。初值取会话记忆种子；
  // 选区本就是某条高亮时，以它的线型/色作初值，弹层直接进入编辑该条。
  const [activeStyle, setActiveStyle] = useState<HighlightStyle>(existingHighlight?.style ?? initialStyle)
  const [stylesColor, setStylesColor] = useState<Record<HighlightStyle, HighlightColor>>(() => {
    const base = { ...initialStyleColors }
    if (existingHighlight) base[existingHighlight.style] = existingHighlight.color
    return base
  })
  // 本次划词已落高亮的 id：落一条后即记住（或选区本就是高亮时带入），切线型/换色就地重绘它、按删除则移除。
  const [highlightId, setHighlightId] = useState<string | null>(existingHighlight?.id ?? null)
  // 贴选区下方浮出，但夹进视口：窗口边缘划词时原样定位会把半个工具栏推到屏幕外。
  const { ref: popupRef, left, top } = useViewportAnchor<HTMLDivElement>(anchor.x, anchor.y, anchor.height)

  // 确保选区已有高亮：没有就以给定线型/色落一条并记住 id，有则就地重绘。
  const ensureHighlight = (color: HighlightColor, style: HighlightStyle): void => {
    if (highlightId) onRestyleHighlight(highlightId, color, style)
    else setHighlightId(onHighlight(color, style))
  }
  // 高亮/删除按钮：无高亮时以当前线型 + 记忆色落一条；已有则删除并复位。
  const toggleHighlight = (): void => {
    if (highlightId) {
      onRemoveHighlight(highlightId)
      setHighlightId(null)
    } else {
      ensureHighlight(stylesColor[activeStyle], activeStyle)
    }
  }
  // 切线型：切到该线型并恢复其记忆色，就地重绘（无高亮则新建一条）。
  const selectStyle = (next: HighlightStyle): void => {
    setActiveStyle(next)
    ensureHighlight(stylesColor[next], next)
  }
  // 换颜色：记到当前线型名下，就地重绘（无高亮则新建一条）。
  const selectColor = (color: HighlightColor): void => {
    setStylesColor((prev) => ({ ...prev, [activeStyle]: color }))
    ensureHighlight(color, activeStyle)
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div
        ref={popupRef}
        // 宿主侧「点浮层外面就收」靠这个标记豁免浮层自身（见 SelectionAnnotator）。
        data-annotation-layer=""
        className="fixed z-50 -translate-x-1/2"
        style={{ left, top }}
        onMouseDown={(e) => e.preventDefault()} // 别让点击工具栏清掉选区
      >
        <div data-state="open" className="anim-pop rounded-card bg-surface-3 p-1 text-text-primary shadow-popover">
          <div className="flex flex-col gap-1">
            {/* 上行：功能栏。落一条高亮后「高亮」按钮变「删除」（对齐 readest）。 */}
            <div className="flex items-center gap-0.5">
              <Tool icon={<Copy className="size-[18px]" />} label="复制" onClick={onCopy} />
              {highlightId ? (
                <Tool icon={<Trash2 className="size-[18px]" />} label="删除高亮" onClick={toggleHighlight} />
              ) : (
                <Tool icon={<Highlighter className="size-[18px]" />} label="高亮" onClick={toggleHighlight} />
              )}
              <Tool icon={<PenLine className="size-[18px]" />} label="写笔记" onClick={onWriteNote} />
              {/* 取不出可查的词时不给这个键（见 onLookup 注释）。 */}
              {onLookup && <Tool icon={<BookText className="size-[18px]" />} label="查词" onClick={onLookup} />}
              <Tool icon={<Languages className="size-[18px]" />} label="翻译" onClick={onTranslate} />
              <Tool icon={<Volume2 className="size-[18px]" />} label="朗读" onClick={onSpeak} />
            </div>

            {/* 微调条：落高亮后才展开（二级操作，对齐 readest：落高亮前只显示功能栏）。 */}
            {highlightId && (
              <>
                {/* 分隔线 */}
                <span className="mx-1 h-px bg-border-300" />

                {/* 线型（填充 / 下划线 / 波浪）靠左、颜色靠右，两端分列（对齐 readest 布局）。 */}
                <div className="flex items-center justify-between gap-4 px-1">
                  {/* 线型：A 字预览当前线型效果，选中用其记忆色 */}
                  <div className="flex items-center gap-0.5">
                    {STYLE_OPTIONS.map((s) => (
                      <StyleButton
                        key={s.value}
                        style={s.value}
                        label={s.label}
                        active={activeStyle === s.value}
                        color={stylesColor[s.value]}
                        onClick={() => selectStyle(s.value)}
                      />
                    ))}
                  </div>
                  {/* 颜色：命中当前线型的记忆色显示对勾 */}
                  <div className="flex items-center gap-1.5">
                    {HIGHLIGHT_COLORS.map((c) => {
                      const selected = stylesColor[activeStyle] === c
                      return (
                        <button
                          key={c}
                          type="button"
                          aria-label={`${HIGHLIGHT_PALETTE[c].label}色高亮`}
                          aria-pressed={selected}
                          onClick={() => selectColor(c)}
                          className={cn(
                            'btn-squish grid size-6 place-items-center rounded-full ring-1 ring-inset transition-transform hover:scale-110',
                            HIGHLIGHT_PALETTE[c].swatch,
                          )}
                        >
                          {selected && <Check className="size-3.5 text-text-100" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

/** 工具栏图标按钮：hover 弹出 Tooltip 说明。 */
function Tool({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="btn-squish grid size-8 place-items-center rounded-md text-text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-text-100"
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** 线型选项：用 "A" 预览该线型效果 —— 选中用其记忆色，未选中用中性灰。 */
function StyleButton({
  style,
  label,
  active,
  color,
  onClick,
}: {
  style: HighlightStyle
  label: string
  active: boolean
  color: HighlightColor
  onClick: () => void
}): React.JSX.Element {
  const pal = HIGHLIGHT_PALETTE[color]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            'btn-squish grid size-7 place-items-center rounded-md transition-colors',
            active ? 'text-text-100' : 'text-text-secondary hover:bg-fill-ghost-hover',
          )}
        >
          <span
            className={cn(
              'grid size-5 place-items-center text-sm font-semibold leading-none',
              style === 'fill' && cn('rounded-sm', active ? pal.fill : 'bg-fill-secondary'),
              style === 'underline' &&
                cn('underline decoration-2 underline-offset-2', active ? pal.line : 'decoration-border-400'),
              style === 'wavy' &&
                cn('underline decoration-wavy underline-offset-2', active ? pal.line : 'decoration-border-400'),
            )}
          >
            A
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

