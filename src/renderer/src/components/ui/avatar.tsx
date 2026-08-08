import * as React from 'react'
import { Avatar as AvatarPrimitive } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

/**
 * 圆形头像，图片加载失败时退回首字母 Fallback。支持 sm / default / lg 三种尺寸。
 */

const avatar = cva('relative flex shrink-0 items-center justify-center overflow-hidden rounded-full', {
  variants: {
    size: {
      sm: 'size-5 text-[10px]',
      default: 'size-7 text-xs',
      lg: 'size-9 text-sm',
    },
  },
  defaultVariants: { size: 'default' },
})

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & VariantProps<typeof avatar>
>(function Avatar({ className, size, ...props }, ref) {
  return <AvatarPrimitive.Root ref={ref} className={cn(avatar({ size }), className)} {...props} />
})

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(function AvatarImage({ className, ...props }, ref) {
  return <AvatarPrimitive.Image ref={ref} className={cn('aspect-square size-full object-cover', className)} {...props} />
})

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(function AvatarFallback({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      className={cn(
        'flex size-full items-center justify-center rounded-full bg-bg-300 font-normal text-text-200 select-none',
        className
      )}
      {...props}
    />
  )
})

export { Avatar, AvatarImage, AvatarFallback }
