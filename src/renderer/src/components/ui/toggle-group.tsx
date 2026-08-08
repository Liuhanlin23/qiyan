import * as React from 'react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { cn } from '@/lib/cn'

/**
 * 分段选择控件（radio group），选中项由绝对定位的白色 thumb 滑动高亮。
 * 纯图标选项传 className="aspect-square px-0" 给 ToggleGroupItem。
 */

type ToggleGroupProps = React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>

const ToggleGroup = React.forwardRef<HTMLDivElement, ToggleGroupProps>(function ToggleGroup(
  { className, children, value, defaultValue, onValueChange, ...props },
  ref
) {
  const innerRef = React.useRef<HTMLDivElement>(null)
  React.useImperativeHandle(ref, () => innerRef.current as HTMLDivElement)

  // 受控/非受控值统一到 currentValue，用于 thumb 位置的 DOM 测量。
  const [internalValue, setInternalValue] = React.useState(value ?? defaultValue)
  const currentValue = value !== undefined ? value : internalValue
  const handleValueChange = React.useCallback(
    (v: string) => {
      if (value === undefined) setInternalValue(v)
      onValueChange?.(v)
    },
    [value, onValueChange]
  )

  const [thumb, setThumb] = React.useState<{ left: number; width: number } | null>(null)
  const measure = React.useCallback(() => {
    const root = innerRef.current
    if (!root) return
    const checked = root.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
    if (!checked) {
      setThumb((p) => (p === null ? p : null))
      return
    }
    const cr = checked.getBoundingClientRect()
    const rr = root.getBoundingClientRect()
    const next = { left: cr.left - rr.left, width: cr.width }
    setThumb((p) => (p && p.left === next.left && p.width === next.width ? p : next))
  }, [])

  React.useLayoutEffect(() => {
    measure()
  }, [currentValue, measure])

  React.useEffect(() => {
    const root = innerRef.current
    if (!root) return
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    root.querySelectorAll('[role="radio"]').forEach((el) => ro.observe(el))
    return () => ro.disconnect()
  }, [measure, children])

  return (
    <RadioGroupPrimitive.Root
      ref={innerRef}
      value={currentValue}
      onValueChange={handleValueChange}
      className={cn(
        'relative inline-flex h-8 w-fit items-stretch rounded-lg bg-segmented-control-track p-px',
        className
      )}
      {...props}
    >
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute bottom-px top-px rounded-[7px] bg-segmented-control-thumb',
          'transition-[left,width] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
          '[box-shadow:inset_0_0_0_1px_var(--border),0_1px_2px_0_var(--alpha-1)]',
          thumb ? 'opacity-100' : 'opacity-0'
        )}
        style={thumb ? { left: thumb.left, width: thumb.width } : undefined}
      />
      {children}
    </RadioGroupPrimitive.Root>
  )
})

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(function ToggleGroupItem({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        'relative z-[1] inline-flex h-full select-none items-center justify-center gap-1.5 rounded-md',
        'border-0 bg-transparent px-3 text-sm text-text-muted outline-none',
        'transition-shadow duration-[60ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none',
        'hover:text-text-primary data-[state=checked]:text-text-primary',
        'focus-visible:shadow-focus data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    />
  )
})

export { ToggleGroup, ToggleGroupItem }
