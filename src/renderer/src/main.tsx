import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { Toaster } from './components/common/Toaster'
import { UpgradeGateDialog } from './components/common/UpgradeGateDialog'
import { initSession, isAuthenticated, isOfflineMode, signIn, signOut } from './session'
import { setAuthFailureHandler, setUpgradeRequiredHandler } from './api/request'
import { probeClientVersion } from './api/clientGate'
import { ensureUpdateCheck, initAppUpdate } from './lib/appUpdate'
import { showUpgradeGate } from './lib/upgradeGate'
import { stopEngine } from './sync'
import { applyThemePreference, readThemePreference } from './lib/theme'
import './styles/globals.css'

// 首帧前套用持久化的外观偏好，避免刷新时明暗闪烁。
applyThemePreference(readThemePreference())

if (import.meta.env.DEV) {
  import('react-grab')
}

// 组合根接线：交互模式登录失效 → 登出 + 跳登录。
// session 不认识 router，环在此断开（directory-convention §三「组合根」）。
setAuthFailureHandler(() => {
  void signOut().finally(() => void router.navigate('/login'))
})

// 服务端版本挡板（HTTP 426）→ 停同步引擎 + 落下不可关闭的升级弹窗。
// 只停服务端交互：本地库与脏行原样保留，绝不清库、绝不推脏（client-protocol.md / sync.md §4）。
setUpgradeRequiredHandler(() => {
  if (isOfflineMode()) return
  stopEngine()
  showUpgradeGate()
})

// 本地自用模式：若尚未登录则自动以本地离线身份开库直达主界面，无需弹窗/邮箱登录。
initSession()
  .catch((e) => console.error('[session] 初始化异常，尝试进入本地模式', e))
  .then(async () => {
    if (!isAuthenticated()) {
      await signIn({ token: 'offline-local', userId: 1, email: '本地自用模式' }).catch((e) =>
        console.error('[session] 自动进入本地模式失败', e),
      )
    }
  })
  .then(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <RouterProvider router={router} />
        <Toaster />
        {/* 与路由平级：登录页、阅读器全屏页也要能被阻断，不能挂在 AppShell 内。 */}
        <UpgradeGateDialog />
      </React.StrictMode>
    )
    if (!isOfflineMode()) {
      void probeClientVersion()
      initAppUpdate()
      void ensureUpdateCheck()
    }
  })
