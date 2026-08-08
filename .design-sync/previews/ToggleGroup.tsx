import { ToggleGroup, ToggleGroupItem } from 'desktop'

/** 互斥单选组 —— 阅读器视图选项（中英 / 仅英 / 仅中）。 */
export function Basic() {
  return (
    <ToggleGroup type="single" defaultValue="zh-en">
      <ToggleGroupItem value="zh-en">中英</ToggleGroupItem>
      <ToggleGroupItem value="en">仅英</ToggleGroupItem>
      <ToggleGroupItem value="zh">仅中</ToggleGroupItem>
    </ToggleGroup>
  )
}
