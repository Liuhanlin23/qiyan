# Claude Design System — how to build with it

A faithful replica of **claude.ai's** visual language (light mode only), as React + **shadcn**/Tailwind v4 components. Components import from `window.ClaudeDS`; the look comes entirely from `styles.css`. Tokens follow **shadcn semantic roles**, so standard shadcn class names apply.

## Setup — no provider needed (one exception: `Sidebar`)
There is **no theme provider or wrapper component** for styling. Tokens are plain `:root` CSS variables (light mode), so any markup is styled as long as the design loads `styles.css` (it `@import`s the tokens + `_ds_bundle.css`). Do not set a `data-theme`/`.dark` class — there is no dark mode (the `dark:` variant is a safe no-op). Browser-default greys/fonts ⇒ `styles.css` isn't loaded.

**The one exception is `Sidebar`**, which uses react-router and must be mounted inside a router or it throws. Wrap it in `window.ClaudeDS.MemoryRouter` (re-exported from the same bundle, so its `NavLink`s resolve against the same router instance) — or your app's own `<BrowserRouter>`. No other component needs a provider.

## Color philosophy — read this first
**Black is the primary brand action.** Use the black `primary` button and `text-foreground` for almost all emphasis. **Clay (the `claude` button variant / `bg-brand`) is a SCARCE accent** — reserve it for the single most important call-to-action per screen; overuse destroys its meaning. The canvas is **warm white** (`bg-background`, not pure white); white (`bg-card`) is for raised surfaces. Hover rule: black/danger keep their colour (press feedback only), clay lightens, secondary/ghost gain a grey wash.

## Styling idiom — Tailwind v4 + shadcn role utilities
Style your own layout glue with these utilities (real role names, all in `styles.css`); use the **components** for controls.

| Group | Utilities |
|---|---|
| Surfaces | `bg-background` (warm-white canvas) · `bg-card` / `bg-popover` (white, raised) · `bg-cream` · `bg-muted` · `bg-accent` (hover surface) · sidebar: `bg-sidebar` / `bg-sidebar-accent` (active/hover) / `border-sidebar-border` |
| Text | `text-foreground` (near-black, primary) · `text-muted-foreground` (secondary) · `text-faint` · `text-strong` |
| Actions | `bg-primary text-primary-foreground` (black) · `bg-secondary` · `bg-brand text-brand-foreground` (clay — scarce) · `bg-destructive` |
| Status | `text-info` (blue) · `text-success` (green) · `text-warning` · `text-discovery` (violet/AI) · soft fills `bg-soft-info` / `bg-soft-success` / `bg-soft-warning` / `bg-soft-danger` / `bg-soft-discovery` |
| Border / focus | `border-border` (hairline) · `border-input` · `ring-ring` (use `/40`) |
| Type | `font-sans` (Inter¹) · `font-serif` (Newsreader¹ — display/titles) · `font-mono` |
| Radius / shadow | `rounded-md` (8, button) · `rounded-lg` (10) · `rounded-3xl` (24, card) · `rounded-input` (9.6) · `shadow-card` (soft diffuse) |
| Layout | standard Tailwind: `flex` `grid` `gap-*` `p-*` `max-w-sm` … |

¹ Anthropic Sans/Serif are proprietary → substituted with Inter / Newsreader (loaded via a remote `@import`). This is a shadcn-compatible token set, so `npx shadcn add <component>` drops in components that already match the theme.

## Components (from `window.ClaudeDS`)
- **`Button`** — `variant`: `primary` (black, default) · `secondary` (outline) · `ghost` · `danger` · `claude` (clay, scarce). `size`: `default` · `lg` · `icon`. `asChild` renders a child (e.g. an `<a>`) as the button. Press springs `scale(.96)`.
- **`Input`** — standard `<input>` props. 44px tall, 9.6px radius, soft black focus ring.
- **`Card`** + `CardHeader`, `CardTitle` (serif), `CardDescription`, `CardContent`, `CardFooter` — surface primitive. `Card` takes `cream` (boolean) for the warmer surface / 32px radius. (Sub-parts are exported on the bundle but have no separate cards.)
- **`Sidebar`** — full-height left nav on the `bg-sidebar` surface (240px expanded / 60px icon rail collapsed; smooth width transition, no element jumps). Serif wordmark, primary destinations with a solid `bg-sidebar-accent` active pill, a bottom account block. Props: `collapsed: boolean`, `onToggle: () => void`. **Router-dependent** (uses `NavLink`) — see Setup; mount inside `MemoryRouter`/your router. **`MemoryRouter`** is exported alongside for that wrap (no separate card).

## Where the truth lives
Read `styles.css` (and its `@import`s: tokens + `_ds_bundle.css`) for exact token values, and each component's `<Name>.d.ts` (props) + `<Name>.prompt.md` (usage) before composing.

## Idiomatic snippet
```tsx
const { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } = window.ClaudeDS
<div className="bg-background p-8 flex justify-center">
  <Card className="max-w-sm">
    <CardHeader>
      <CardTitle>Think fast, build faster</CardTitle>
      <CardDescription>White card on the warm-white canvas.</CardDescription>
    </CardHeader>
    <CardContent>Primary actions are black; clay is reserved for the key CTA.</CardContent>
    <CardFooter>
      <Button variant="primary">Get started</Button>
      <Button variant="ghost">Learn more</Button>
    </CardFooter>
  </Card>
</div>
```

Sidebar shell (note the required router wrap — `Sidebar` is the one component that needs it):
```tsx
const { Sidebar, MemoryRouter } = window.ClaudeDS
const [collapsed, setCollapsed] = React.useState(false)
<MemoryRouter initialEntries={['/wordbook']}>
  <div className="flex h-screen bg-background">
    <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} />
    <main className="min-w-0 flex-1 overflow-y-auto p-8">…</main>
  </div>
</MemoryRouter>
```
