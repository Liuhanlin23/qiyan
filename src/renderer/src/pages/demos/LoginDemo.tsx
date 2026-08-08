import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import appIcon from '@/assets/app-icon.png'
import { Button, Input, Card } from '@/components/ui'
import { cn } from '@/lib/cn'

/**
 * 卡片式两步邮箱登录 demo：左上角品牌标记 + 登录卡片
 * （邮箱 → 4 位验证码 → 登录成功）。邮箱格式走浏览器原生校验，纯前端模拟，无后端接线。
 * 演示用验证码固定为 1234。
 */

/** 登录三步态。 */
type Step = 'email' | 'code' | 'done'

const CODE_LENGTH = 4
/** 演示用固定验证码。 */
const DEMO_CODE = '1234'
const RESEND_SECONDS = 30

export function LoginDemo(): React.JSX.Element {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)

  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  // 变化时让验证码框整体重挂载，从而清空并把焦点带回第一格。
  const [attempt, setAttempt] = useState(0)

  const [resendIn, setResendIn] = useState(0)

  // 验证码步骤的重发倒计时：每次 setTimeout 递减一秒，简单且无累积 interval。
  useEffect(() => {
    if (step !== 'code' || resendIn <= 0) return
    const timer = setTimeout(() => setResendIn((s) => Math.max(0, s - 1)), 1000)
    return () => clearTimeout(timer)
  }, [step, resendIn])

  const sendCode = (): void => {
    setSending(true)
    // 模拟「发送验证码」网络往返。
    setTimeout(() => {
      setSending(false)
      setCode('')
      setCodeError(null)
      setAttempt((n) => n + 1)
      setResendIn(RESEND_SECONDS)
      setStep('code')
    }, 700)
  }

  const handleEmailSubmit = (e: React.FormEvent): void => {
    // 邮箱格式交给浏览器原生校验（input 的 type=email + required）；能进到这里说明已通过。
    e.preventDefault()
    sendCode()
  }

  const handleVerify = (): void => {
    if (code.length < CODE_LENGTH || verifying) return
    setVerifying(true)
    setCodeError(null)
    // 模拟「校验验证码」网络往返。
    setTimeout(() => {
      setVerifying(false)
      if (code === DEMO_CODE) {
        setStep('done')
      } else {
        setCodeError('验证码不正确，请重试')
        setCode('')
        setAttempt((n) => n + 1)
      }
    }, 800)
  }

  const backToEmail = (): void => {
    setStep('email')
    setCode('')
    setCodeError(null)
    setVerifying(false)
  }

  const resetAll = (): void => {
    setStep('email')
    setEmail('')
    setCode('')
    setCodeError(null)
  }

  return (
    <div className="relative flex min-h-full flex-1 items-center justify-center bg-page-bg px-6 py-12">
      {/* 左上角品牌标记 */}
      <div className="absolute left-6 top-6 flex items-center gap-2">
        <img src={appIcon} alt="" className="size-8" aria-hidden />
        <span className="text-sm font-semibold tracking-tight text-text-primary">启言</span>
      </div>

      <div className="flex w-full max-w-[360px] flex-col gap-8">
        {step === 'email' && (
          <Card className="p-6">
            <form className="flex flex-col gap-5" onSubmit={handleEmailSubmit}>
              <Input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="请输入邮箱"
                required
                className="h-11 rounded-lg text-base"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={sending}
                className="w-full justify-center"
              >
                使用邮箱继续
              </Button>
            </form>
          </Card>
        )}

        {step === 'code' && (
          <Card className="flex flex-col gap-5 p-6">
            <p className="text-sm leading-relaxed text-text-secondary">
              我们已向 <span className="font-medium text-text-primary">{email || '你的邮箱'}</span>{' '}
              发送了一个 4 位验证码。
            </p>

            <div className="flex flex-col gap-2.5">
              <CodeInput
                key={attempt}
                value={code}
                invalid={Boolean(codeError)}
                disabled={verifying}
                onChange={(next) => {
                  setCode(next)
                  if (codeError) setCodeError(null)
                }}
              />
              {codeError ? (
                <p className="text-center text-xs text-text-danger">{codeError}</p>
              ) : (
                <p className="text-center text-xs text-text-muted">演示验证码：{DEMO_CODE}</p>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <Button
                type="button"
                variant="primary"
                size="lg"
                loading={verifying}
                disabled={code.length < CODE_LENGTH}
                onClick={handleVerify}
                className="w-full justify-center"
              >
                验证
              </Button>
              <div className="flex items-center justify-between text-[0.8125rem]">
                <button
                  type="button"
                  onClick={backToEmail}
                  className="btn-squish text-text-secondary transition-colors hover:text-text-primary"
                >
                  更换邮箱
                </button>
                {resendIn > 0 ? (
                  <span className="text-text-muted">{resendIn}s 后重发</span>
                ) : (
                  <button
                    type="button"
                    onClick={sendCode}
                    className="btn-squish font-medium text-text-primary transition-colors hover:text-text-secondary"
                  >
                    重新发送
                  </button>
                )}
              </div>
            </div>
          </Card>
        )}

        {step === 'done' && (
          <Card className="flex flex-col items-center gap-5 p-6 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-bg-success-chip text-text-success">
              <Check className="size-7" strokeWidth={2.5} />
            </span>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-xl font-medium tracking-tight text-text-primary">登录成功</h2>
              <p className="text-sm text-text-secondary">
                欢迎回来，<span className="font-medium text-text-primary">{email}</span>
              </p>
            </div>
            <Button
              variant="secondary"
              size="lg"
              onClick={resetAll}
              className="min-w-[10rem] justify-center"
            >
              重新演示
            </Button>
          </Card>
        )}
      </div>
    </div>
  )
}

/**
 * 4 位验证码输入：每格一个数字，输入自动跳下一格、退格回退、支持整段粘贴与左右方向键。
 * 视觉对齐 ui/input 的填充/描边/聚焦签名，invalid 时切红色描边。
 */
function CodeInput({
  value,
  onChange,
  invalid,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  invalid?: boolean
  disabled?: boolean
}): React.JSX.Element {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const digits = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '')

  const focusBox = (i: number): void => {
    const clamped = Math.max(0, Math.min(CODE_LENGTH - 1, i))
    refs.current[clamped]?.focus()
    refs.current[clamped]?.select()
  }

  const setDigit = (i: number, char: string): void => {
    const next = digits.slice()
    next[i] = char
    onChange(next.join('').slice(0, CODE_LENGTH))
  }

  const handleChange = (i: number, raw: string): void => {
    const char = raw.replace(/\D/g, '').slice(-1)
    setDigit(i, char)
    if (char && i < CODE_LENGTH - 1) focusBox(i + 1)
  }

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      e.preventDefault()
      focusBox(i - 1)
      setDigit(i - 1, '')
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault()
      focusBox(i - 1)
    } else if (e.key === 'ArrowRight' && i < CODE_LENGTH - 1) {
      e.preventDefault()
      focusBox(i + 1)
    }
  }

  const handlePaste = (e: React.ClipboardEvent): void => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH)
    if (!pasted) return
    onChange(pasted)
    focusBox(pasted.length - 1)
  }

  return (
    <div className="flex justify-center gap-3" onPaste={handlePaste}>
      {digits.map((digit, i) => (
        <input
          // eslint-disable-next-line react/no-array-index-key -- 固定长度、无重排的定长格子，索引即稳定标识
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          autoFocus={i === 0}
          value={digit}
          aria-invalid={invalid || undefined}
          aria-label={`验证码第 ${i + 1} 位`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          className={cn(
            'h-16 w-14 rounded-lg bg-fill-field text-center text-3xl font-medium text-text-primary',
            'shadow-field-ring outline-none transition-[box-shadow,background-color] duration-150',
            'focus-visible:bg-surface-popover focus-visible:shadow-focus',
            'aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--color-border-danger)]',
            'disabled:pointer-events-none disabled:opacity-50'
          )}
        />
      ))}
    </div>
  )
}
