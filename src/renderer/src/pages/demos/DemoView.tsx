import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/cn'
import { DemoCrumbContext } from './DemoCrumb'
import { DEMOS } from './registry'

/**
 * Demo 详情页 —— 顶部一条极简返回栏,下面在真实主内容区里渲染该 demo。
 * 因为挂在 AppShell 内(带侧栏),预览到的就是「放进真实 app 里」的样子。
 */
export default function DemoView(): React.JSX.Element {
  const { demoId } = useParams()
  const navigate = useNavigate()
  const demo = DEMOS.find((d) => d.id === demoId)
  // demo 内部下钻时上报的子级名（如资源页的「音标」）；null 表示当前在 demo 顶层。
  const [crumb, setCrumb] = useState<string | null>(null)

  // 返回按历史后退：demo 内用路由下钻（如资源页 ?category=）时，一步退回上一级；无历史则兜底回列表。
  const goBack = (): void => {
    if (window.history.length > 1) navigate(-1)
    else navigate('/demos')
  }

  if (!demo) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-16 text-center">
        <h1 className="text-2xl font-medium text-text-primary">未找到该 demo</h1>
        <p className="mt-1.5 text-sm text-text-secondary">它可能已重命名或移除。</p>
        <Link
          to="/demos"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-text-primary hover:underline"
        >
          <ArrowLeft className="size-4" />
          返回 Demo 列表
        </Link>
      </div>
    )
  }

  const Demo = demo.Component
  return (
    <div className="flex min-h-full flex-col">
      {/* 返回栏:发丝描边 + 毛玻璃,尽量轻,不抢 demo 的视觉。 */}
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2.5 bg-page-bg/80 px-6 py-2.5 backdrop-blur">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="size-4" />
          返回
        </button>
        <span className="text-text-muted">/</span>
        <span className={cn('text-sm font-medium', crumb ? 'text-text-secondary' : 'text-text-primary')}>
          {demo.title}
        </span>
        {crumb && (
          <>
            <span className="text-text-muted">/</span>
            <span className="text-sm font-medium text-text-primary">{crumb}</span>
          </>
        )}
      </div>
      {/* demo 本体:flex 列容器,让需要撑满的全屏 demo 能用 flex-1 铺满高度;block 型 demo 按内容高度不受影响。 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <DemoCrumbContext.Provider value={setCrumb}>
          <Demo />
        </DemoCrumbContext.Provider>
      </div>
    </div>
  )
}
