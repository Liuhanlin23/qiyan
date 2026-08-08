import { Checkbox, Label } from 'desktop'

/** 黑色选中态，配 Label —— 导出选项 / 筛选条件常用。 */
export function Basic() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <Checkbox defaultChecked id="phonetic" />
        <Label htmlFor="phonetic">包含音标</Label>
      </div>
      <div className="flex items-center gap-2.5">
        <Checkbox defaultChecked id="example" />
        <Label htmlFor="example">包含例句</Label>
      </div>
      <div className="flex items-center gap-2.5">
        <Checkbox id="note" />
        <Label htmlFor="note">包含笔记</Label>
      </div>
    </div>
  )
}
