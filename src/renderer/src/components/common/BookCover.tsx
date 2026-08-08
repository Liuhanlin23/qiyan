import { useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * 生成式封面（词书 / 图书共用）。竖版 3:4 书壳 + 衬线首字，明暗自适应（fill-primary / on-primary）。
 * 传了 `src` 就在书壳上盖真封面图，图缺失 / 加载失败自动退回文字书封（同 Avatar 的 fallback 语义）。
 * 四档尺寸分两种视觉签名：
 *
 * - `lg` / `fill`：硬壳书脊 + 烫印内框 + 首字，读起来像一本实体书而非纯色块。`lg` 是固定宽的详情封面，
 *   `fill` 铺满所在格子（书架网格）。中性深色书壳保持克制，把那一抹 clay 留给 `cta`。
 * - `md` / `sm`：省去硬壳描边的小号书壳 + 首字，用于列表 / 目录网格。
 *
 * `cta`：悬停时从底部浮现的行动号召（书架的「继续 / 开始阅读」药丸）。由外层的 `group` 悬停驱动。
 */

/** 硬壳档（lg / fill）各自的外框宽度与投影、烫印内框比例、首字字号。 */
const HARD_SHELL = {
  lg: { box: 'w-[104px] shadow-md', frame: 'w-[56%]', letter: 'text-3xl' },
  fill: { box: 'w-full shadow-sm', frame: 'w-[52%]', letter: 'font-serif text-4xl' },
}

/**
 * 真封面图层：盖在文字书封之上，加载失败就摘掉自己、露出下面那层。文字书封始终在 DOM 里，
 * 故图片就位前后都不会闪空窗。
 */
function CoverImage({ src }: { src: string }): React.JSX.Element | null {
  // 记「哪个 src 坏了」而不是一个布尔：换书（src 变）时自动重新尝试，省掉一个复位 effect。
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  if (brokenSrc === src) return null
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setBrokenSrc(src)}
      className="absolute inset-0 size-full object-cover"
    />
  )
}

export function BookCover({
  title,
  src,
  size = 'lg',
  cta,
  className,
}: {
  title: string
  /** 真封面图 URL；不传 / 为 null / 加载失败都退回文字书封。 */
  src?: string | null
  size?: 'lg' | 'fill' | 'md' | 'sm'
  /** 悬停浮现的 CTA（如书架的「继续阅读」药丸）；不传即不渲染。 */
  cta?: React.ReactNode
  className?: string
}): React.JSX.Element {
  const initial = title.trim().charAt(0) || '?'

  if (size === 'lg' || size === 'fill') {
    const spec = HARD_SHELL[size]
    return (
      <div
        className={cn(
          'relative aspect-[3/4] shrink-0 overflow-hidden rounded-lg bg-fill-primary',
          spec.box,
          className,
        )}
      >
        {/* 左上斜向柔光,给硬壳一点体积感 */}
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-on-primary/10 to-transparent" />
        {/* 书脊高光竖线 */}
        <span className="pointer-events-none absolute inset-y-0 left-2 w-px bg-on-primary/20" />
        {/* 烫印内框 + 首字 */}
        <div className="absolute inset-0 grid place-items-center pl-1.5">
          <span
            className={cn('grid aspect-square place-items-center rounded-sm border border-on-primary/25', spec.frame)}
          >
            <span className={cn('font-medium leading-none text-on-primary', spec.letter)}>{initial}</span>
          </span>
        </div>
        {src && <CoverImage src={src} />}
        {cta && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            {cta}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative grid aspect-[3/4] shrink-0 place-items-center overflow-hidden rounded-lg bg-fill-primary shadow-sm',
        size === 'md' ? 'w-16' : 'w-10',
        className,
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-1 w-px bg-on-primary/15" />
      <span className={cn('font-serif font-medium text-on-primary', size === 'md' ? 'text-2xl' : 'text-base')}>
        {initial}
      </span>
      {src && <CoverImage src={src} />}
    </div>
  )
}
