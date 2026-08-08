import { ChevronsUpDown } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui'
import type { MeaningSource } from '@/types/word'

/**
 * 释义来源切换药丸 ——「中文（简明）/ 中英（柯林斯）」下拉，与音标行的口音药丸同款外观。
 * 完整词卡（`WordCard` 音标行右侧）与阅读精简卡（`DictPopup`）共用；该词无柯林斯时「中英」置灰。
 *
 * 受控；就地切换只影响当前卡、不回写单词卡设置（docs/feature/wordcard.md）。
 * 选项面板走 Radix Portal 挂在 body 上，阅读浮层那侧已由宿主统一豁免「点外面就收」。
 */

interface MeaningSourceToggleProps {
  source: MeaningSource
  onChange: (s: MeaningSource) => void
  /** 该词有无柯林斯释义；无则「中英」置灰不可选。 */
  collinsAvailable: boolean
  /**
   * 是否在点击时 stopPropagation（additive，默认 false）。
   * 学习页把词卡包在「点击揭晓」容器里，控件点击需拦截冒泡以免误揭晓。
   */
  stopClickPropagation?: boolean
  className?: string
}

export function MeaningSourceToggle({
  source,
  onChange,
  collinsAvailable,
  stopClickPropagation = false,
  className,
}: MeaningSourceToggleProps): React.JSX.Element {
  // 无柯林斯时按钮显示回落后的「中文」，与 WordMeaning 的就地回落同一口径。
  const effective: MeaningSource = source === 'collins' && collinsAvailable ? 'collins' : 'simple'
  return (
    <div className={className} onClick={stopClickPropagation ? (e) => e.stopPropagation() : undefined}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="btn-squish inline-flex items-center gap-1 rounded-full border border-border-300 bg-surface-1 px-2.5 py-1 text-xs font-semibold text-text-secondary"
          >
            {effective === 'collins' ? '中英' : '中文'}
            <ChevronsUpDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onChange('simple')}>中文</DropdownMenuItem>
          <DropdownMenuItem disabled={!collinsAvailable} onSelect={() => onChange('collins')}>
            中英
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
