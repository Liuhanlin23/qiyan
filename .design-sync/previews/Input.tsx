import { Input } from 'desktop'

/** Default text input on the warm-white canvas. */
export function Default() {
  return (
    <div className="max-w-sm">
      <Input placeholder="Enter your email" type="email" />
    </div>
  )
}

/** Paired with a label — the common form-field composition. */
export function WithLabel() {
  return (
    <label className="flex flex-col gap-2 max-w-sm">
      <span className="text-sm font-semibold text-muted-foreground">Email</span>
      <Input placeholder="you@example.com" type="email" />
    </label>
  )
}

/** Various input types and a filled value. */
export function Types() {
  return (
    <div className="flex flex-col gap-3 max-w-sm">
      <Input placeholder="Search…" type="search" />
      <Input placeholder="Password" type="password" defaultValue="hunter2" />
      <Input type="text" defaultValue="Filled value" />
    </div>
  )
}

/** Disabled state. */
export function Disabled() {
  return (
    <div className="max-w-sm">
      <Input placeholder="Disabled" disabled />
    </div>
  )
}
