import { useEffect, useState, useSyncExternalStore } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
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
import { appUpdateStore, ensureUpdateCheck, installUpdate } from '@/lib/appUpdate'
import { upgradeGateStore } from '@/lib/upgradeGate'

/**
 * 版本挡板宿主：全局挂载一次（见 main.tsx），订阅命令桥 store 阻断整个应用。
 * 不可关闭——无 Cancel、Esc 与点击遮罩都不生效。两条出路：
 * 1. 自动更新（Windows 主路径）：挡板落下即触发检查下载（updater 走 dl.nvwa.world，
 *    不过 axios 拦截器，不受 426 影响），下载完成显示「重启更新」一键脱困；
 * 2. 重试探测：服务端回滚 / 用户手动装好新版后，重试通过即整页刷新。
 * 命令式触发见 lib/upgradeGate.ts 的 showUpgradeGate；更新状态见 lib/appUpdate.ts。
 */

/**
 * 官网下载页地址；留空则不渲染下载行（官网未上线，域名确定后回填）。
 * 自动更新失败 / dev / mac（无签名证书暂不接 updater）时这是唯一出路，长期保留。
 * `target="_blank"` 会被 main 的 setWindowOpenHandler 接住转 shell.openExternal
 * （window.ts）——不会就地导航丢掉 SPA，无需另开桥。
 */
const DOWNLOAD_URL: string = ''

export function UpgradeGateDialog(): React.JSX.Element {
  const open = useSyncExternalStore(upgradeGateStore.subscribe, upgradeGateStore.getSnapshot)
  const update = useSyncExternalStore(appUpdateStore.subscribe, appUpdateStore.getSnapshot)
  // 重试的三态：idle（初始）→ retrying → 通过则回 idle（reload 已在路上）/ 仍被挡则 blocked。
  const [retryPhase, setRetryPhase] = useState<'idle' | 'retrying' | 'blocked'>('idle')

  // 挡板落下即触发「检查 +（有新版则）下载」；幂等守卫在 store 里，重复落下无副作用。
  useEffect(() => {
    if (open) void ensureUpdateCheck()
  }, [open])

  async function handleRetry(): Promise<void> {
    setRetryPhase('retrying')
    // 探测挡板之余顺手重触发更新检查（error / latest 后放行）——服务端升版与 latest.yml
    // 上传之间若有时间差，第一次检查可能扑空，重试是补救口。
    void ensureUpdateCheck()
    // 通过则 retryUpgradeGate 内部已发起整页刷新；reload 是异步导航，后续 setState 照跑但页面即将被替换。
    setRetryPhase((await retryUpgradeGate()) ? 'idle' : 'blocked')
  }

  const downloading = update.phase === 'checking' || update.phase === 'downloading'

  return (
    <AlertDialog open={open}>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>需要更新</AlertDialogTitle>
          <AlertDialogDescription>
            {update.phase === 'downloaded'
              ? `新版本${update.version ? ` ${update.version}` : ''} 已下载就绪，重启应用即可完成更新。`
              : downloading
                ? '当前版本与服务端不匹配，正在自动下载新版本，完成后即可一键更新。'
                : '当前版本与服务端不匹配，请下载最新版本后重新安装；或稍后重试。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {downloading && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
            {update.phase === 'downloading'
              ? `正在下载${update.version ? ` ${update.version}` : ''}… ${Math.floor(update.percent)}%`
              : '正在检查更新…'}
          </div>
        )}
        {update.phase === 'error' && (
          <Alert>
            <AlertIcon>
              <TriangleAlert aria-hidden />
            </AlertIcon>
            <AlertContent>
              <AlertDescription>自动下载更新失败，请稍后重试或前往下载页手动更新。</AlertDescription>
            </AlertContent>
          </Alert>
        )}
        {DOWNLOAD_URL && (
          <a
            href={DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-text-accent underline-offset-4 hover:underline"
          >
            前往下载页
          </a>
        )}
        {retryPhase === 'blocked' && (
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
          {update.phase === 'downloaded' ? (
            <>
              <Button
                variant="secondary"
                loading={retryPhase === 'retrying'}
                onClick={() => void handleRetry()}
              >
                重试
              </Button>
              <Button onClick={() => void installUpdate()}>重启更新</Button>
            </>
          ) : (
            <Button loading={retryPhase === 'retrying'} onClick={() => void handleRetry()}>
              重试
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
