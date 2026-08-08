import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui'
import { cn } from '@/lib/cn'

/**
 * 阅读器 chrome（顶栏 / 底栏）统一的图标按钮：CDS ghost 图标键 + Tooltip 说明，激活态加深。
 * 需外层有 `TooltipProvider`（顶/底栏各自提供）。
 * 图标自己会变色表达激活（如书签转实心橙）时传 `activeSurface={false}`：只报 aria-pressed 不加底色，
 * 否则常驻的底色会被读成鼠标一直悬停在上面。
 *
 * 划词浮层里的图标键不走这里：它画在浮起的 surface 上，用半透明 ghost 悬停色，是另一套观感。
 */
export function ToolButton({
  label,
  active,
  activeSurface = true,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  activeSurface?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(active && activeSurface && 'bg-fill-ghost-hover text-text-100')}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
