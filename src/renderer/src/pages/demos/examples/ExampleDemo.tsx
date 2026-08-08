import { Sparkles } from 'lucide-react'
import { Card } from '@/components/ui'

/**
 * 展厅的占位示例 demo:证明「列表 → 详情」链路已通。
 * 真正讨论定案的页面会作为新的 DemoEntry 加入 registry,替代 / 补充这里。
 */
export function ExampleDemo(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-3xl px-8 py-16">
      <Card className="flex flex-col items-center gap-4 py-16 text-center">
        <span className="grid size-14 place-items-center rounded-card bg-bg-neutral text-text-primary">
          <Sparkles className="size-7" />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-medium text-text-primary">这里会渲染真实 UI 页面</h1>
          <p className="max-w-sm text-sm text-text-secondary">
            以后每讨论定一版页面,就把它作为一个 demo 加进列表,你点进来即可看到真实效果。
          </p>
        </div>
      </Card>
    </div>
  )
}
