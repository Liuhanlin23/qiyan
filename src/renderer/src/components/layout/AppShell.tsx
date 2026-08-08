import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AppSidebar } from '@/components/layout/Sidebar'
import { SettingsDialog } from '@/components/settings/SettingsDialog'

/**
 * 应用主壳:左侧栏 + 右主区(Outlet 渲染当前路由)。
 * 侧栏(AppSidebar)基于 components/ui/sidebar 拼成;
 * 设置 Modal 覆盖在任意页之上,故开合态放在壳上、不放侧栏。
 */
export function AppShell(): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-page-bg">
      <AppSidebar onOpenSettings={() => setSettingsOpen(true)} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
