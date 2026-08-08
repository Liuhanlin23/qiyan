import * as React from 'react'
import { cn } from '@/lib/cn'

/** 使用原生细滚动条（scrollbar-width: thin）的溢出容器，overlay 风格不占布局宽度。 */
function ScrollArea({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative overflow-auto [scrollbar-color:var(--scrollbar-thumb)_transparent] [scrollbar-width:thin]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { ScrollArea }
