import { Label, Input } from 'desktop'

/** 表单标签 + Input。 */
export function Basic() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <Label htmlFor="email">邮箱</Label>
      <Input id="email" type="email" placeholder="you@nvwa.world" />
    </div>
  )
}
