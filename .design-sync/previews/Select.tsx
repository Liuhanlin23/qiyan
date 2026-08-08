import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from 'desktop'

/** 枚举选择，几何与 Input 对齐（44px 高、9.6px 圆角）。 */
export function Basic() {
  return (
    <div className="w-full max-w-xs">
      <Select defaultValue="20">
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="10">每日新词 10 个</SelectItem>
          <SelectItem value="20">每日新词 20 个</SelectItem>
          <SelectItem value="30">每日新词 30 个</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
