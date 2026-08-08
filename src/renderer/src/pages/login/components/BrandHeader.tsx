import appIcon from '@/assets/app-icon.png'

/** 左上角启言品牌标记（应用图标 + 文字）。 */
export function BrandHeader(): React.JSX.Element {
  return (
    <div className="absolute left-6 top-6 flex items-center gap-2">
      <img src={appIcon} alt="" className="size-8" aria-hidden />
      <span className="text-sm font-semibold tracking-tight text-text-primary">启言</span>
    </div>
  )
}
