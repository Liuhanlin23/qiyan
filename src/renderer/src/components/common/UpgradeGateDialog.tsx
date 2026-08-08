import { useState, useSyncExternalStore } from 'react'
import { TriangleAlert } from 'lucide-react'
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertIcon,
  Button,
} from '@/components/ui'
import { retryUpgradeGate } from '@/api/clientGate'
import { upgradeGateStore } from '@/lib/upgradeGate'

/**
 * 版本挡板宿主：全局挂载一次（见 main.tsx），订阅命令桥 store 阻断整个应用。
 * 不可关闭——无 Cancel、Esc 与点击遮罩都不生效，唯一出路是重试成功后整页刷新。
 * 命令式触发见 lib/upgradeGate.ts 的 showUpgradeGate。
 */

/**
 * 官网下载页地址；留空则不渲染下载行（官网未上线，域名确定后回填）。
 * 回填时一并接 shell.openExternal 桥——renderer 直接跟随 `<a href>` 会导航离开 SPA，
 * 而挡板这一屏丢掉 SPA 后只能重启应用才能回来。
 */
const DOWNLOAD_URL: string = ''

export function UpgradeGateDialog(): React.JSX.Element {
  const open = useSyncExternalStore(upgradeGateStore.subscribe, upgradeGateStore.getSnapshot)
  // 重试的三态：idle（初始）→ retrying → 通过则回 idle（reload 已在路上）/ 仍被挡则 blocked。
  const [phase, setPhase] = useState<'idle' | 'retrying' | 'blocked'>('idle')

  async function handleRetry(): Promise<void> {
    setPhase('retrying')
    // 通过则 retryUpgradeGate 内部已发起整页刷新；reload 是异步导航，后续 setState 照跑但页面即将被替换。
    setPhase((await retryUpgradeGate()) ? 'idle' : 'blocked')
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>需要更新</AlertDialogTitle>
          <AlertDialogDescription>
            当前版本与服务端不匹配，请下载最新版本后重新安装；或稍后重试。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {DOWNLOAD_URL && (
          <a
            href={DOWNLOAD_URL}
            className="text-sm font-medium text-text-accent underline-offset-4 hover:underline"
          >
            前往下载页
          </a>
        )}
        {phase === 'blocked' && (
          // role=alert 由调用方补（见 ui/alert.tsx）：这条是重试失败后才出现的，需要被朗读。
          <Alert role="alert">
            <AlertIcon>
              <TriangleAlert aria-hidden />
            </AlertIcon>
            <AlertContent>
              <AlertDescription>服务端仍要求此版本更新。</AlertDescription>
            </AlertContent>
          </Alert>
        )}
        <AlertDialogFooter>
          <Button loading={phase === 'retrying'} onClick={() => void handleRetry()}>
            重试
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
