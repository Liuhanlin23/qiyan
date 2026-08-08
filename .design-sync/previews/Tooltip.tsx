import { Tooltip, TooltipTrigger, TooltipContent, Button } from 'desktop'

// 预览里把 Tooltip 设为 `open`(常开),让近黑气泡在静态卡片中可见 —— 实际使用是 hover 触发。
// 顶部留白给「上方弹出」的气泡腾出空间。

/** Hover hint on an icon button. Near-black bubble with an arrow. */
export function Basic() {
  return (
    <div className="flex justify-center pt-12">
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="secondary" size="icon" aria-label="标记为已掌握">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </Button>
        </TooltipTrigger>
        <TooltipContent>标记为已掌握</TooltipContent>
      </Tooltip>
    </div>
  )
}
