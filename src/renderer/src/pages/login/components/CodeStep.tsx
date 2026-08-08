import { Button, Card } from '@/components/ui'
import { CODE_LENGTH, CodeInput } from './CodeInput'

/**
 * 验证码步骤：发送提示文案 + 4 格验证码输入 + 验证按钮 + 更换邮箱 / 重发倒计时。
 * 验证码校验交给父级（onVerify）；错误由 api 响应拦截器统一弹 toast，本组件不显示内联错误。
 */
export function CodeStep({
  email,
  code,
  onCodeChange,
  verifying,
  attempt,
  onVerify,
  onBackToEmail,
  onResend,
  resendIn,
}: {
  email: string
  code: string
  onCodeChange: (next: string) => void
  verifying: boolean
  attempt: number
  onVerify: () => void
  onBackToEmail: () => void
  onResend: () => void
  resendIn: number
}): React.JSX.Element {
  return (
    <Card className="flex flex-col gap-5 p-6">
      <p className="text-sm leading-relaxed text-text-secondary">
        我们已向 <span className="font-medium text-text-primary">{email || '你的邮箱'}</span>{' '}
        发送了一个 4 位验证码。
      </p>

      <div className="flex flex-col gap-2.5">
        <CodeInput key={attempt} value={code} disabled={verifying} onChange={onCodeChange} />
        <p className="text-center text-xs text-text-muted">验证码 10 分钟内有效</p>
      </div>

      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="primary"
          size="lg"
          loading={verifying}
          disabled={code.length < CODE_LENGTH}
          onClick={onVerify}
          className="w-full justify-center"
        >
          验证
        </Button>
        <div className="flex items-center justify-between text-[0.8125rem]">
          <button
            type="button"
            onClick={onBackToEmail}
            className="btn-squish text-text-secondary transition-colors hover:text-text-primary"
          >
            更换邮箱
          </button>
          {resendIn > 0 ? (
            <span className="text-text-muted">{resendIn}s 后重发</span>
          ) : (
            <button
              type="button"
              onClick={onResend}
              className="btn-squish font-medium text-text-primary transition-colors hover:text-text-secondary"
            >
              重新发送
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}
