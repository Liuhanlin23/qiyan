import { useLocation, useNavigate } from 'react-router-dom'
import { BookOpen, FlaskConical, LayoutGrid, Library, Palette, Search } from 'lucide-react'
import {
  Sidebar,
  SidebarBody,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarItem,
} from '@/components/ui'
import { UserAvatar } from '@/components/common/UserAvatar'
import { getUser } from '@/session'

/**
 * 应用左侧栏 —— 用 components/ui/sidebar 基元拼出启言的一级导航。
 * 信息架构与 router 对齐:单词本 / 阅读 / 资源 三个一级「去处」;
 * 底部账户区点开全局设置 Modal(开合态由 AppShell 持有,经 onOpenSettings 透传)。
 * 视觉沿用 components/ui/sidebar 基元默认样式:独立底色 + 右侧 0.5px 分隔线。
 */

const NAV_ITEMS = [
  { path: '/wordbook', label: '单词本', icon: Library },
  { path: '/lookup', label: '查词', icon: Search },
  { path: '/reading', label: '阅读', icon: BookOpen },
  { path: '/resources', label: '资源', icon: LayoutGrid },
] as const

export interface AppSidebarProps {
  onOpenSettings: () => void
}

export function AppSidebar({ onOpenSettings }: AppSidebarProps): React.JSX.Element {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const email = getUser()?.email ?? null

  return (
    <Sidebar>
      <SidebarHeader logo={<Logo />} />
      <SidebarBody>
        <SidebarGroup>
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
            <SidebarItem
              key={path}
              icon={<Icon className="size-[18px]" strokeWidth={2} />}
              active={pathname.startsWith(path)}
              onClick={() => navigate(path)}
            >
              {label}
            </SidebarItem>
          ))}
        </SidebarGroup>

        {/* DEV 专用:UI Demo 展厅与组件浏览入口,生产环境不渲染。 */}
        {import.meta.env.DEV && (
          <SidebarGroup>
            <SidebarItem
              icon={<FlaskConical className="size-[18px]" strokeWidth={2} />}
              active={pathname.startsWith('/demos')}
              onClick={() => navigate('/demos')}
            >
              UI Demo
            </SidebarItem>
            <SidebarItem
              icon={<Palette className="size-[18px]" strokeWidth={2} />}
              active={pathname.startsWith('/gallery')}
              onClick={() => navigate('/gallery')}
            >
              组件浏览
            </SidebarItem>
          </SidebarGroup>
        )}
      </SidebarBody>
      <SidebarFooter
        name={email ?? '未登录'}
        caption=""
        avatar={<UserAvatar className="size-full" />}
        onClick={onOpenSettings}
      />
    </Sidebar>
  )
}

function Logo(): React.JSX.Element {
  return (
    <span className="select-none text-xl font-medium leading-none text-text-100">启言</span>
  )
}
