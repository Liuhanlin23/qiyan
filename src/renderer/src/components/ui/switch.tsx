import * as React from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'
import { cn } from '@/lib/cn'

/** 开关控件。轨道颜色瞬切，滑块位移有回弹动画（cubic-bezier overshoot）。 */

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'group peer relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 outline-none',
        'bg-switch-track hover:bg-switch-track-hover',
        'data-[state=checked]:bg-fill-accent data-[state=checked]:hover:bg-fill-accent-hover',
        'focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block size-4 rounded-full bg-switch-knob shadow-sm',
          'transition-transform duration-[120ms] ease-[cubic-bezier(0.34,1.3,0.64,1)] motion-reduce:transition-none',
          'data-[state=checked]:translate-x-4'
        )}
      />
    </SwitchPrimitive.Root>
  )
})

export { Switch }
