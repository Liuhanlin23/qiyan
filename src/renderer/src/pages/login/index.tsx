import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { emailSignIn, sendEmailCode } from '@/api/auth'
import { signIn } from '@/session'
import { BrandHeader } from './components/BrandHeader'
import { EmailStep } from './components/EmailStep'
import { CodeStep } from './components/CodeStep'
import { CODE_LENGTH } from './components/CodeInput'

/**
 * 卡片式两步邮箱登录：左上角品牌标记 + 登录卡片（邮箱 → 4 位验证码 → 进入应用）。
 * 邮箱格式走浏览器原生校验；验证码校验通过即写入登录凭证并跳主应用。
 *
 * 登录即注册：邮箱首次登录时后端自动建号，无独立注册流程。
 * 错误提示统一由 api 响应拦截器弹 toast，本页不重复报错，仅负责推进步骤 / 清空验证码框。
 */

/** 登录两步态。 */
type Step = 'email' | 'code'

const RESEND_SECONDS = 30

export default function Login(): React.JSX.Element {
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)

  const [code, setCode] = useState('')
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

  // 邮箱 trim + 小写归一（与后端一致，做前端防御）。
  const normalizedEmail = (): string => email.trim().toLowerCase()

  const sendCode = async (): Promise<void> => {
    setSending(true)
    try {
      await sendEmailCode(normalizedEmail())
      setCode('')
      setAttempt((n) => n + 1)
      setResendIn(RESEND_SECONDS)
      setStep('code')
    } catch {
      // 错误已由响应拦截器弹 toast；停在当前步。
    } finally {
      setSending(false)
    }
  }

  const handleEmailSubmit = (e: React.FormEvent): void => {
    // 邮箱格式交给浏览器原生校验（input 的 type=email + required）；能进到这里说明已通过。
    e.preventDefault()
    void sendCode()
  }

  const handleVerify = async (): Promise<void> => {
    if (code.length < CODE_LENGTH || verifying) return
    setVerifying(true)
    try {
      const result = await emailSignIn({ email: normalizedEmail(), code })
      await signIn({ token: result.token, userId: result.userId, email: result.email })
      navigate('/', { replace: true })
    } catch {
      // 验证码错误 / 过期等已由响应拦截器弹 toast；清空验证码框、聚焦重填。
      setCode('')
      setAttempt((n) => n + 1)
    } finally {
      setVerifying(false)
    }
  }

  const backToEmail = (): void => {
    setStep('email')
    setCode('')
    setVerifying(false)
  }

  return (
    <div className="relative flex min-h-screen flex-1 items-center justify-center bg-page-bg px-6 py-12">
      <BrandHeader />

      <div className="flex w-full max-w-[360px] flex-col gap-8">
        {step === 'email' && (
          <EmailStep
            email={email}
            onEmailChange={setEmail}
            onSubmit={handleEmailSubmit}
            sending={sending}
          />
        )}

        {step === 'code' && (
          <CodeStep
            email={email}
            code={code}
            onCodeChange={setCode}
            verifying={verifying}
            attempt={attempt}
            onVerify={() => void handleVerify()}
            onBackToEmail={backToEmail}
            onResend={() => void sendCode()}
            resendIn={resendIn}
          />
        )}
      </div>
    </div>
  )
}
