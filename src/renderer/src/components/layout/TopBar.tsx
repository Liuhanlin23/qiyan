import { Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui'

/**
 * 顶部位置条 —— 标示用户当前所在区域，复刻 claude.ai 顶栏观感：无下分割线、毛玻璃、极简。
 * segments 为面包屑：最左恒有一个纯图标返回按钮——单段（一级页面）时置灰禁用、只标区域名；多段（下钻页）时可用，末段为当前页（加重）。
 * 返回优先用 onBack；否则 navigate(backTo)（深链稳定，不依赖历史栈）；二者皆无则退回上一条历史。
 */
export function TopBar({
  segments,
  backTo,
  onBack,
}: {
  segments: string[]
  backTo?: string
  onBack?: () => void
}): React.JSX.Element {
  const navigate = useNavigate()
  const nested = segments.length > 1
  const goBack =
    onBack ??
    ((): void => {
      if (backTo) navigate(backTo)
      else navigate(-1)
    })

  return (
    <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-1.5 bg-page-bg/80 px-3 backdrop-blur">
      <Button variant="ghost" size="iconSm" onClick={goBack} disabled={!nested} aria-label="返回">
        <ArrowLeft className="size-4" />
      </Button>
      <nav className="flex items-center gap-1.5 text-sm">
        {segments.map((seg, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="text-text-muted">/</span>}
            <span className={i === segments.length - 1 ? 'font-medium text-text-primary' : 'text-text-secondary'}>
              {seg}
            </span>
          </Fragment>
        ))}
      </nav>
    </div>
  )
}
