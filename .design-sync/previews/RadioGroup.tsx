import { RadioGroup, RadioGroupItem, Label } from 'desktop'

/** 单选偏好（释义显示方式）。 */
export function Basic() {
  return (
    <RadioGroup defaultValue="both" className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <RadioGroupItem value="both" id="r-both" />
        <Label htmlFor="r-both">中英对照</Label>
      </div>
      <div className="flex items-center gap-2.5">
        <RadioGroupItem value="en" id="r-en" />
        <Label htmlFor="r-en">仅英文</Label>
      </div>
      <div className="flex items-center gap-2.5">
        <RadioGroupItem value="zh" id="r-zh" />
        <Label htmlFor="r-zh">仅中文</Label>
      </div>
    </RadioGroup>
  )
}
