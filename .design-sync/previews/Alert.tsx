import { Alert, AlertTitle, AlertDescription } from 'desktop'

/** 行内静态提示条（区别于瞬时 Toast、模态 Dialog）。 */
export function Default() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <Alert>
        <AlertTitle>已加入「四级核心词汇」</AlertTitle>
        <AlertDescription>今日学习队列已更新。</AlertDescription>
      </Alert>
    </div>
  )
}

/** 危险变体。 */
export function Destructive() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <Alert variant="destructive">
        <AlertTitle>同步失败</AlertTitle>
        <AlertDescription>网络异常，本地进度已保存，稍后将自动重试。</AlertDescription>
      </Alert>
    </div>
  )
}
