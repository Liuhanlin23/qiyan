import { Reader } from './Reader'

/**
 * 阅读器路由入口（/reader/:bookHash）—— 独立整屏页，挂在 AppShell 之外，没有 app 左侧栏。
 *
 * Reader 本体根节点是 flex-1（好嵌进带工具栏的容器，如 Demo 展厅），这里补一层
 * h-screen/w-screen 铺满整个视口，让「点书 → 整屏阅读」像 readest 那样占满窗口。
 */
export default function ReaderPage(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-page-bg">
      <Reader />
    </div>
  )
}
