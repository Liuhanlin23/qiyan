import { useState } from 'react'
import type { ReactNode } from 'react'
import { Sidebar, MemoryRouter } from 'desktop'

// Sidebar 用 react-router 的 NavLink,必须挂在 <Router> 内。MemoryRouter 从同一个
// bundle 导出(window.ClaudeDS),与 NavLink 共用一份 react-router 实例,Context 才对得上。
//
// 组件本身是 h-screen(整屏高)。预览里把它约束到卡片高度,让 头部 + 导航 + 账户 一屏
// 可见 —— 仅改预览呈现,组件源码不动。
function Frame({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/wordbook']}>
      <div className="ds-sidebar-frame" style={{ height: 600 }}>
        <style>{`.ds-sidebar-frame > nav{height:600px!important}`}</style>
        {children}
      </div>
    </MemoryRouter>
  )
}

/**
 * 可交互演示。点头部右上角的折叠钮(PanelLeft)在 展开(240) ↔ 折叠(60) 间切换:宽度平滑
 * 动画、文字淡出、图标盒不跳位。collapsed 由这里的 useState 持有 —— 与 App 中 AppShell
 * 的接法完全一致。导航项是 NavLink,点「单词本 / 阅读 / 资源」可切换选中胶囊。
 */
export function Interactive() {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <Frame>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
    </Frame>
  )
}
