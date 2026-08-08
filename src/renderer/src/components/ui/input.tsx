import * as React from 'react'
import { cn } from '@/lib/cn'

/** 文本输入框。invalid 为 true 时切换为红色描边（aria-invalid）。 */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', invalid, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-8 w-full min-w-0 rounded-lg bg-fill-field px-3 text-sm/5 text-text-primary',
        'shadow-field-ring outline-none placeholder:text-text-muted',
        'transition-[box-shadow,background-color] duration-150',
        'focus-visible:bg-surface-popover focus-visible:shadow-focus',
        'aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--color-border-danger)]',
        'disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
})
