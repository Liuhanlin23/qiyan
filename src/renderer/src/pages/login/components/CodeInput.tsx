import { useRef } from 'react'
import { cn } from '@/lib/cn'

/** 验证码位数（与登录页保持一致）。 */
export const CODE_LENGTH = 4

/**
 * 4 位验证码输入：每格一个数字，输入自动跳下一格、退格回退、支持整段粘贴与左右方向键。
 * 视觉对齐 ui/input 的填充/描边/聚焦签名，invalid 时切红色描边。
 */
export function CodeInput({
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
