import { useEffect, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui'
import { translateBridge } from '@/platform'
import type { TranslationProvider } from '../translation/providerMemory'
import { useViewportAnchor } from './useViewportAnchor'

/**
 * 句子翻译框 —— 点标注工具栏「翻译」后浮出的独立弹层（对齐 readest 的 TranslatorPopup 布局：
 * 原文区 / 分隔线 / 译文区 / 底部服务商切换）。原文写死英文、译文写死中文（学习场景），故不带
 * 语言选择，只留 Google / Azure 切换。翻译请求经 main 转发（`translateBridge`，绕 CORS），
 * 切服务商即重译；失败显示错误提示、可切另一家重试。
 * 服务商是**设备级记忆**（宿主持有并落 localStorage）：切一次即记住，下次开书默认用上次那家。
 *
 * 收弹层由宿主 SelectionAnnotator 统一管（点书页空白 / 点浮层外 / Esc），故本组件带
 * `data-annotation-layer` 豁免「点外面就收」，自身不设关闭按钮。服务商下拉的选项面板走 Portal
 * 挂在 body 上（不在本弹层的 DOM 子树里），这类 Radix popper 内容已由宿主统一豁免，无需各处自贴标记。
 */

const PROVIDERS: { value: TranslationProvider; label: string }[] = [
  { value: 'google', label: 'Google' },
  { value: 'azure', label: 'Azure' },
]

export interface TranslatorPopupProps {
  /** 选区英文原文。 */
  text: string
  /** 锚点 x：选区水平中点。 */
  x: number
  /** 锚点 y：选区下沿（贴其下方浮出，由 useViewportAnchor 夹进视口）。 */
  y: number
  /** 选区矩形高度：下方塞不下时翻到选区上方，据此让开选中的字。 */
  height: number
  /** 当前翻译服务商（宿主持有，来自设备级记忆）。 */
  provider: TranslationProvider
  /** 切换服务商：上抛给宿主写记忆并广播；本框据新值即时重译。 */
  onProviderChange: (p: TranslationProvider) => void
}

export function TranslatorPopup({
  text,
  x,
  y,
  height,
  provider,
  onProviderChange,
}: TranslatorPopupProps): React.JSX.Element {
  const { ref, left, top } = useViewportAnchor<HTMLDivElement>(x, y, height)
  const [translation, setTranslation] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // 文本或服务商变化即重译。alive 守卫：切服务商时上一趟在途结果不覆盖新态。
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    setTranslation(null)
    translateBridge
      .sentence({ text, provider })
      .then((result) => {
        if (!alive) return
        setTranslation(result)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setError(true)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [text, provider])

  const providerLabel = PROVIDERS.find((p) => p.value === provider)?.label

  return (
    <div
      ref={ref}
      // 宿主「点浮层外面就收」靠这个标记豁免浮层自身（见 SelectionAnnotator）。
      data-annotation-layer=""
      className="anim-pop fixed z-50 w-[380px] -translate-x-1/2 select-text rounded-card bg-surface-3 text-text-primary shadow-popover"
      style={{ left, top }}
      onMouseDown={(e) => e.preventDefault()} // 别让点浮层清掉选区
    >
      <div className="max-h-[50vh] overflow-y-auto">
        {/* 原文区 */}
        <div className="px-4 pt-3.5">
          <div className="mb-1.5 text-xs font-medium text-text-muted">原文</div>
          <p className="text-[15px] leading-relaxed text-text-primary">{text}</p>
        </div>

        <div className="mx-4 my-3 h-px bg-border-300" />

        {/* 译文区 */}
        <div className="px-4">
          <div className="mb-1.5 text-xs font-medium text-text-muted">译文</div>
          {loading ? (
            <p className="text-[15px] leading-relaxed text-text-muted">翻译中…</p>
          ) : error ? (
            <p className="text-[15px] leading-relaxed text-text-danger">翻译失败，请稍后重试或切换翻译服务。</p>
          ) : (
            <p className="text-[15px] leading-relaxed text-text-primary">{translation || '未获得翻译结果。'}</p>
          )}
        </div>
      </div>

      {/* 底部：翻译来源 + 服务商切换 */}
      <div className="mt-3 flex items-center justify-between gap-2 px-4 pb-3">
        <span className="min-w-0 truncate text-[11px] text-text-muted">
          {!loading && !error && providerLabel ? `由 ${providerLabel} 提供翻译` : ''}
        </span>
        <Select value={provider} onValueChange={(v) => onProviderChange(v as TranslationProvider)}>
          <SelectTrigger className="h-7 shrink-0 text-xs" aria-label="翻译服务">
            <SelectValue />
          </SelectTrigger>
          {/* 宿主已统一豁免 Radix popper 内容；这里的标记留作 position 改回 item-aligned（不走 popper）时的兜底。 */}
          <SelectContent data-annotation-layer="" className="min-w-[7rem]">
            {PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value} className="text-xs">
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
