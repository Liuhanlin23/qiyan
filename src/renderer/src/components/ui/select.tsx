import * as React from 'react'
import { Select as SelectPrimitive } from 'radix-ui'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/cn'

/** 下拉选择器，选中项尾部显示勾选图标。 */

const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(function SelectTrigger({ className, children, ...props }, ref) {
  // 打开时 Radix 会 disableOutsidePointerEvents，触发按钮拿不到指针事件、CSS :hover 失效。
  // 于是用 document 的 pointermove（打开态照常触发）判断指针是否落在按钮矩形内，驱动打开态的
  // 悬停高亮；不改 pointer-events、不影响 Radix 的点击关闭逻辑，关闭态仍走 CSS :hover。
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [openHover, setOpenHover] = React.useState(false)
  const setRefs = React.useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref]
  )
  React.useEffect(() => {
    const el = triggerRef.current
    if (!el) return
    const onPointerMove = (e: PointerEvent): void => {
      const r = el.getBoundingClientRect()
      setOpenHover(
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      )
    }
    const syncOpen = (): void => {
      if (el.getAttribute('data-state') === 'open') {
        setOpenHover(true) // 打开瞬间鼠标通常正压在按钮上，先点亮，随后 pointermove 校正
        document.addEventListener('pointermove', onPointerMove)
      } else {
        document.removeEventListener('pointermove', onPointerMove)
        setOpenHover(false)
      }
    }
    const observer = new MutationObserver(syncOpen)
    observer.observe(el, { attributes: true, attributeFilter: ['data-state'] })
    syncOpen()
    return () => {
      observer.disconnect()
      document.removeEventListener('pointermove', onPointerMove)
    }
  }, [])
  return (
    <SelectPrimitive.Trigger
      ref={setRefs}
      className={cn(
        'group flex h-8 w-fit items-center gap-1.5 rounded-lg pl-2 pr-2 text-sm text-text-primary',
        'bg-transparent outline-none transition duration-[60ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
        // 关闭态走 CSS :hover；打开态 :hover 失效、改由 JS 命中的 openHover 驱动。
        // 两者都只在鼠标真正压在按钮上时高亮，移开即灭。
        'hover:bg-fill-ghost-hover',
        openHover && 'bg-fill-ghost-hover',
        'focus-visible:shadow-focus data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left',
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          className="mr-0.5 size-4 shrink-0 text-text-muted transition-colors group-hover:text-text-secondary"
          strokeWidth={2}
          aria-hidden
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
})

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(function SelectScrollUpButton({ className, ...props }, ref) {
  return (
    <SelectPrimitive.ScrollUpButton
      ref={ref}
      className={cn('flex cursor-default items-center justify-center py-1 text-text-muted', className)}
      {...props}
    >
      <ChevronUp className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
})

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(function SelectScrollDownButton({ className, ...props }, ref) {
  return (
    <SelectPrimitive.ScrollDownButton
      ref={ref}
      className={cn('flex cursor-default items-center justify-center py-1 text-text-muted', className)}
      {...props}
    >
      <ChevronDown className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
})

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = 'popper', ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        className={cn(
          'anim-pop z-50 max-h-[var(--radix-select-content-available-height)] min-w-[12rem] overflow-hidden',
          'rounded-card bg-surface-3 text-sm text-text-primary shadow-panel outline-none',
          'origin-[var(--radix-select-content-transform-origin)]',
          position === 'popper' && 'data-[side=bottom]:mt-1 data-[side=top]:mb-1',
          className
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]'
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
})

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={cn('px-3 py-1 text-[13px] font-medium text-text-muted', className)}
      {...props}
    />
  )
})

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'group/item relative flex min-h-8 w-full cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-1',
        'text-sm text-text-primary outline-none',
        // 底色只跟物理指针走：选中与否只用尾部对勾区分，不上底色；打开瞬间 Radix 会 focus 选中项
        // （data-highlighted），故不能用它上色，否则未 hover 就变色。popper 模式下列表不覆盖触发按钮，
        // 打开时鼠标在按钮上不压任何项 → 无 :hover → 无底色，与 claude.ai 一致。
        'hover:bg-fill-ghost-hover',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="ml-auto flex shrink-0 items-center text-text-accent">
        <Check className="size-4" strokeWidth={2.5} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
})

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(function SelectSeparator({ className, ...props }, ref) {
  return <SelectPrimitive.Separator ref={ref} className={cn('mx-2.5 my-1 h-px bg-border', className)} {...props} />
})

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
