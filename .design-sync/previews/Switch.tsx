import { Switch, Label } from 'desktop'

/** 黑色 on 态（呼应主操作色），配 Label。 */
export function Basic() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Switch defaultChecked id="autoplay" />
        <Label htmlFor="autoplay">发音自动播放</Label>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="remind" />
        <Label htmlFor="remind">每日提醒</Label>
      </div>
    </div>
  )
}
