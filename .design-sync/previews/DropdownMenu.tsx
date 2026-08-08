import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuItem, DropdownMenuSeparator, Button,
} from 'desktop'

/** 上下文菜单（预览设为常开以展示菜单；菜单项 hover 用 bg-accent 实底）。 */
export function Basic() {
  return (
    <div className="flex justify-center pb-2">
      <DropdownMenu open>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">账户</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>刘翰霖 · Max</DropdownMenuLabel>
          <DropdownMenuItem>个人主页</DropdownMenuItem>
          <DropdownMenuItem>设置</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>退出登录</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
