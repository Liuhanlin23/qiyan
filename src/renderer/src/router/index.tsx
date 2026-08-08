import { lazy, Suspense } from 'react'
import { createHashRouter, Navigate, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import Login from '@/pages/login'
import { isAuthenticated } from '@/session'
import WordBook from '@/pages/word-book'
import WordBooks from '@/pages/word-book/books'
import PickWords from '@/pages/word-book/books/pick'
import WordStudy from '@/pages/word-book/study'
import TodayLearn from '@/pages/word-book/today'
import MyWords from '@/pages/word-book/words'
import MyNotes from '@/pages/word-book/notes'
import WordLookup from '@/pages/lookup'
import Reading from '@/pages/reading'
import ReaderPage from '@/pages/reading/reader'
import Resources from '@/pages/resources'

// UI Demo 展厅 + 组件浏览页:仅 DEV 注册,懒加载成独立 chunk,不进生产包。
// 均挂在 AppShell 内(带侧栏),让预览到的就是「放进真实 app 里」的样子。
// 列表 /demos 与详情 /demos/:demoId、组件浏览 /gallery。加 demo 见 pages/demos/registry.tsx。
//
// lazy() 必须调在 DEV 分支**内部**(即 devRoute 里),不能提到模块顶层:顶层的
// `const X = lazy(() => import(...))` 即便只被死分支引用,Rollup 也无法判定 lazy() 无副作用
// (React 未加 /*#__PURE__*/ 标注),会保留调用连带里面的 import(),chunk 照样产出——
// 路由不注册但代码进包。写在分支里则整段随 `false ? ... : []` 一起被消除。
function devRoute(
  path: string,
  load: () => Promise<{ default: React.ComponentType }>
): RouteObject {
  const Page = lazy(load)
  return {
    path,
    element: (
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    ),
  }
}
const devShellRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      devRoute('gallery', () => import('@/pages/gallery')),
      devRoute('demos', () => import('@/pages/demos')),
      devRoute('demos/:demoId', () => import('@/pages/demos/DemoView')),
    ]
  : []

/**
 * 登录门禁:两处守卫都用组件在「渲染时」现查登录态(而非模块加载时求值),
 * 这样每次导航都会重新判断,登录 / 登出后跳转即时生效。
 */
function RequireAuth({ children }: { children: React.ReactNode }): React.JSX.Element {
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" replace />
}
function LoginRoute(): React.JSX.Element {
  return isAuthenticated() ? <Navigate to="/" replace /> : <Login />
}

/**
 * Electron 渲染进程走 file://,必须用 HashRouter(createHashRouter):
 * 路径落在 # 之后,刷新 / 深链不会 404。
 *
 * 信息架构 = iOS 一级 Tab 平移:单词本 / 阅读 / 资源 三个「去处」在 AppShell 内,
 * 「我的(账户/设置)」不再是独立路由,改由侧栏底部账户菜单弹出设置 Modal。
 *
 * 壳外(无侧栏)路由:Login,以及阅读器 /reader/:bookHash —— 从书架点开一本书后进入的
 * 独立整屏阅读页(像 readest 那样占满窗口、不带 app 侧栏),返回/关闭再导航回 /reading。
 * 未登录访问主应用一律被 RequireAuth 兜回 /login。
 */
export const router = createHashRouter([
  { path: '/login', element: <LoginRoute /> },
  {
    path: '/reader/:bookHash',
    element: (
      <RequireAuth>
        <ReaderPage />
      </RequireAuth>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/wordbook" replace /> },
      { path: 'wordbook', element: <WordBook /> },
      { path: 'wordbook/books', element: <WordBooks /> },
      { path: 'wordbook/books/:bookId', element: <PickWords /> },
      { path: 'wordbook/study', element: <WordStudy /> },
      { path: 'wordbook/today', element: <TodayLearn /> },
      { path: 'wordbook/words', element: <MyWords /> },
      { path: 'wordbook/notes', element: <MyNotes /> },
      { path: 'lookup', element: <WordLookup /> },
      { path: 'reading', element: <Reading /> },
      { path: 'resources', element: <Resources /> },
      ...devShellRoutes,
    ],
  },
])
