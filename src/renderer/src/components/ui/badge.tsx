import * as React from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

/** 小药丸标签，支持 neutral / accent / success / warning / danger / outline 六种语义变体。asChild 可将样式套到 &lt;a&gt; 等元素。 */

const badge = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium select-none',
  {
    variants: {
      variant: {
        neutral: 'bg-bg-neutral-chip text-text-secondary',
        accent: 'bg-bg-accent-chip text-text-accent',
        success: 'bg-bg-success-chip text-text-success',
        warning: 'bg-bg-warning-chip text-text-warning',
        danger: 'bg-bg-danger-chip text-text-danger',
        outline: 'border-[0.5px] border-border-300 text-text-secondary',
      },
    },
    defaultVariants: { variant: 'neutral' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badge> {
  asChild?: boolean
}

export function Badge({ className, variant, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : 'span'
  return <Comp className={cn(badge({ variant }), className)} {...props} />
}
