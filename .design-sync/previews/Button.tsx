import { Button } from 'desktop'

/** All five variants. Black `primary` is the default; `claude` (clay) is the scarce accent. */
export function Variants() {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="claude">Claude</Button>
    </div>
  )
}

/** Sizes: default (h36), large (h44), and a square icon button. */
export function Sizes() {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Add">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </Button>
    </div>
  )
}

/** Enabled vs disabled. */
export function States() {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      <Button variant="primary">Enabled</Button>
      <Button variant="primary" disabled>
        Disabled
      </Button>
      <Button variant="secondary" disabled>
        Disabled
      </Button>
    </div>
  )
}

/** Large call-to-action buttons — the primary (black) is the default emphasis; clay is reserved. */
export function CallToAction() {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      <Button size="lg" variant="primary">
        Continue with email
      </Button>
      <Button size="lg" variant="claude">
        Try Claude
      </Button>
    </div>
  )
}

/** `asChild` renders the child element (here an anchor) with button styling via Radix Slot. */
export function AsChild() {
  return (
    <Button asChild variant="secondary">
      <a href="#">Link styled as a button</a>
    </Button>
  )
}
