import * as React from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 通用按钮，支持 primary / brand / secondary / ghost / danger 五种变体。
 * loading 状态自动显示 spinner 并锁定交互。asChild 可将样式套到任意子元素。
 */

const button = cva(
  'btn-squish inline-flex items-center justify-center relative shrink-0 select-none whitespace-nowrap gap-1.5 ' +
    'text-sm font-medium border-0 outline-2 outline-offset-1 outline-transparent ' +
    'focus-visible:outline-accent-100 disabled:pointer-events-none [&:disabled:not([aria-busy=true])]:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-fill-primary text-on-primary hover:bg-fill-primary-hover font-semibold',
        brand: 'bg-fill-brand text-on-brand hover:bg-fill-brand-hover font-semibold',
        danger: 'bg-fill-danger text-on-danger hover:bg-fill-danger-hover font-semibold',
        secondary:
          'bg-transparent text-text-000 border-[0.5px] border-border-200 hover:bg-bg-400 hover:border-transparent font-semibold',
        ghost: 'bg-transparent text-text-300 hover:bg-bg-300 hover:text-text-100',
      },
      size: {
        default: 'h-9 px-4 py-2 rounded-lg min-w-[5rem]',
        sm: 'h-8 rounded-md px-3 min-w-[4rem] !text-xs',
        lg: 'h-11 rounded-[0.6rem] px-5 min-w-[6rem] !text-base',
        icon: 'h-9 w-9 rounded-md',
        iconXs: 'h-6 w-6 rounded-md',
        iconSm: 'h-8 w-8 rounded-md',
        iconLg: 'h-11 w-11 rounded-[0.6rem]',
      },
      round: { true: '!rounded-full' },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, round, asChild = false, loading = false, disabled, type, children, ...props },
  ref
) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      ref={ref}
      {...(asChild ? {} : { type: type ?? 'button' })}
      aria-busy={loading || undefined}
      disabled={disabled || loading || undefined}
      className={cn(button({ variant, size, round }), className)}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
          <span className="sr-only">加载中</span>
        </>
      ) : (
        children
      )}
    </Comp>
  )
})

export { button as buttonVariants }
