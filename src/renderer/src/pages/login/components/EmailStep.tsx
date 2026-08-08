import { Button, Card, Input } from '@/components/ui'

/**
 * 邮箱输入步骤：邮箱输入框 + 「使用邮箱继续」按钮。
 * 邮箱格式交给浏览器原生校验（input 的 type=email + required），提交后由父级发送验证码。
 */
export function EmailStep({
  email,
  onEmailChange,
  onSubmit,
  sending,
}: {
  email: string
  onEmailChange: (next: string) => void
  onSubmit: (e: React.FormEvent) => void
  sending: boolean
}): React.JSX.Element {
  return (
    <Card className="p-6">
      <form className="flex flex-col gap-5" onSubmit={onSubmit}>
        <Input
          type="email"
          name="email"
          autoComplete="email"
          placeholder="请输入邮箱"
          required
          className="h-11 rounded-lg text-base"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
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
  )
}
