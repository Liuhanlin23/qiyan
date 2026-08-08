import { Slider } from 'desktop'

/** 设置页：每日新词上限、语速等。 */
export function Basic() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-8">
      <Slider defaultValue={[20]} max={50} step={1} />
      <Slider defaultValue={[40]} max={100} step={1} />
    </div>
  )
}
