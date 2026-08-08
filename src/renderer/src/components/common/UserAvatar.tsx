import notionAvatar from '@/assets/avatars/notion-avatar.svg'
import { Avatar, AvatarImage } from '@/components/ui'
import { cn } from '@/lib/cn'

/**
 * 用户头像：全体用户共用的同一张手绘插画（产品无更换头像入口，故不接任何用户数据）。
 * 尺寸由外部 className 给（`size-12` / `size-full`…），不自带大小。
 *
 * 底色恒定浅色 + 细描边：插画是白脸黑线，底色若随主题变深会把发色糊进背景、圆形边界也会消失。
 * 画面主体只占 1080 画布约六成，放大 1.25 倍才填得满圆（按 viewBox 坐标核过，头顶与下巴都不会被裁）。
 */
export function UserAvatar({ className }: { className?: string }): React.JSX.Element {
  return (
    <Avatar className={cn('border border-border-300 bg-always-white', className)}>
      <AvatarImage src={notionAvatar} alt="" className="scale-125" />
    </Avatar>
  )
}
