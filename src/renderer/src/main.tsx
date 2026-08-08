import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { Toaster } from './components/common/Toaster'
import { UpgradeGateDialog } from './components/common/UpgradeGateDialog'
import { initSession, signOut } from './session'
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
  stopEngine()
  showUpgradeGate()
})

// 先从 main 读回持久化登录态，再渲染——保证路由守卫首帧就拿到正确登录态，避免闪登录页。
// initSession 失败也照常渲染（守卫会按未登录处理）；显式 catch 兜底，避免把 rejection 变成未处理拒绝。
initSession()
  .catch((e) => console.error('[session] 初始化异常，按未登录渲染', e))
  .then(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <RouterProvider router={router} />
        <Toaster />
        {/* 与路由平级：登录页、阅读器全屏页也要能被阻断，不能挂在 AppShell 内。 */}
        <UpgradeGateDialog />
      </React.StrictMode>
    )
    // 启动探测一次（fire-and-forget，不阻塞首帧）：撞挡板由响应拦截器触发上面的 handler。
    // **必须在 initSession 之后**——并发发出的话，426 可能先于 startEngine 返回，stopEngine() 空转，
    // 随后引擎照样起来，成了「弹窗已弹但同步在跑」。运行期不轮询（前台定时一跳天然承担探测）。
    void probeClientVersion()
    // 自动更新：接上 main 的事件推流后静默查一次（发现即后台下载，退出时自动装上；
    // 强制点只有版本挡板——撞 426 时弹窗内再触发，一键「重启更新」脱困）。与挡板同节奏不轮询。
    initAppUpdate()
    void ensureUpdateCheck()
  })
