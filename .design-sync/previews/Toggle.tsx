import { Toggle } from 'desktop'

/** 单个开关式按钮（按下=激活底色）。 */
export function Basic() {
  return (
    <div className="flex gap-2">
      <Toggle defaultPressed aria-label="加粗">
        <span className="font-bold">B</span>
      </Toggle>
      <Toggle aria-label="斜体">
        <span className="italic">I</span>
      </Toggle>
      <Toggle aria-label="下划线">
        <span className="underline">U</span>
      </Toggle>
    </div>
  )
}
