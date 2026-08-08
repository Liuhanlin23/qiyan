# Claude Design System — sync notes

Re-sync is `node .ds-sync/resync.mjs` from `desktop/` (this is the package root). Read this first.

## What this DS actually is
- A faithful replica of **claude.ai's** visual design language (light mode only), built as **shadcn-style** components in an Electron app (`desktop/`).
- Synced surface = the tsup build of `src/renderer/src/components/ui/` (**30 components**) **plus `Sidebar`** (a layout component — see the Sidebar section below; lands in the `layout` group). Compound sub-parts (CardHeader/Title/…, Dialog*/AlertDialog*/DropdownMenu*/Select*/Popover*/Sheet*/Accordion*/Tabs* sub-parts, etc.) are in the bundle but excluded from the component list via `componentSrcMap: null` — keep those exclusions or the DS pane regrows dozens of junk cards.
- **Component roster (2026-06-26 sync, 4 → 30):** general = Button, Input, Card, Badge, Progress, Tabs, Avatar, Separator, Tooltip, Dialog, AlertDialog, DropdownMenu, Select, Popover, HoverCard, Sheet, Switch, Checkbox, RadioGroup, Slider, Label, Toggle, ToggleGroup, Skeleton, Toaster, Alert, Accordion, Collapsible, ScrollArea; layout = Sidebar. The 26 added are shadcn 4.11 components restyled to the claude tokens (white `bg-popover` overlays, serif titles, `shadow-overlay`, `rounded-2xl`, Button variant fixes — `variant` union is `primary|secondary|ghost|danger|claude`, NOT shadcn's `default/outline`). `Toaster` (sonner, next-themes removed, theme pinned light) ships as a **floor card** by design — a toast can't render statically; that is not a failure.

## Overlay preview conventions (don't "fix" these)
- **Always-open portals** — DropdownMenu, HoverCard, Popover, Tooltip — render their open state and would escape the multi-column grid, so they carry `cfg.overrides.<Name> = {cardMode:"single", primaryStory:"Basic"}`. This silences `[GRID_OVERFLOW]`; keep the overrides.
- **Trigger-only overlays** — Dialog, AlertDialog, Sheet — previews intentionally show the styled trigger (closed state), a deliberate user decision (a full-screen overlay would obscure a small card). They render real styled controls and graded `good`. If a richer card is ever wanted, switch to `open` + `cardMode:"single"` + a viewport — but only on the user's say-so.
- **Select** preview shows the resting trigger with its value (the control's natural state) — fine as-is.
- Tokens were extracted live from claude.ai and regenerated into `src/renderer/src/styles/globals.css` by `../.design-extract/gen-globals.mjs`. Source visualization doc: `../.design-extract/claude-design-system.html`.

## Build (cfg.buildCmd = `npm run build:ds`)
- Runs `tsup` → `dist/index.mjs` + `dist/index.d.mts`, then **`cp index.d.mts index.d.ts`**, then tailwind CLI → `dist/ds.css`.
- The `cp` to `.d.ts` is REQUIRED: tsup names the dts `.d.mts` (esm in a non-module package), but the converter scans the `.d.ts` tree.
- `dist/ds.css` is a **static compiled Tailwind** sheet: `:root` tokens + `@layer components` (.btn/.input/.ds-card — verbatim claude.ai mechanics) + a forced utility safelist (`styles/_safelist.html`) so designs get a working `bg-bg-*`/`text-text-*`/layout utility vocabulary even if the render env doesn't re-run Tailwind.

## Fonts
- Anthropic Sans/Serif/Mono are proprietary → substituted with **Inter / Newsreader / ui-monospace**, loaded via a remote `@import` (Google Fonts) at the top of `ds.css`. Expect `[FONT_REMOTE]` (informational), not `[FONT_MISSING]`.

## Render check
- User opted to review previews in their own browser; validate is run with `--no-render-check`. Previews are eyeballed via `.review.html`, not headless-verified.
- **Headless capture, when you need it** (e.g. a render-coupled new component like Sidebar): playwright isn't a declared dep and the cached browser build can mismatch the freshly-installed package. Workaround that worked: `npm i playwright --no-save` in `.ds-sync/`, then run capture with `DS_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` — drives system Chrome, no browser download. Sidebar was verified this way (both cells graded `good`).

## Sidebar (layout component — router-coupled)
- Lives at `src/renderer/src/components/layout/Sidebar.tsx` (the app's real left nav: brand "nvwa", 单词本/阅读/资源, account 刘翰霖/Max plan). Shipped **as-is** at the user's request (Q2), incl. the personal account block.
- It's surfaced into the DS bundle by re-exporting from the packaged entry `components/ui/index.ts` (`export { Sidebar } …` + `export { MemoryRouter } from 'react-router-dom'`). Pinned via `componentSrcMap.Sidebar`; `MemoryRouter: null` keeps the re-exported router OUT of the component card list.
- **Router requirement (the one provider exception):** Sidebar uses react-router `NavLink` → must be mounted inside a `<Router>` or it throws. `MemoryRouter` is exported from the SAME bundle so its `NavLink`s share one react-router instance (a separately-imported router = second instance = context mismatch = still crashes). Documented in `conventions.md` ("Setup — one exception").
- Preview `.design-sync/previews/Sidebar.tsx` wraps Sidebar in `MemoryRouter` (from `'desktop'`) and caps the component's `h-screen` to 600px via an injected `<style>` so header+nav+account fit one card. Two cells: `Expanded` (route /wordbook) + `Collapsed` (route /reading) show the active-pill states.
- `tsconfig.build.json` `include` had to add `components/layout/Sidebar.tsx` for dts. Sidebar's ~30 utility classes (incl. `bg-sidebar*`, `w-[60px]`, `size-[18px]`, hover/transition/opacity) were added to `styles/_safelist.html` — auto-scan can't be relied on for the static `ds.css`. lucide-react + react-router-dom are bundled by the converter (tsup keeps them external; converter inlines from node_modules).

## Re-sync risks / watch-list
- If `gen-globals.mjs` is re-run, diff the regenerated `globals.css` (token values could shift if claude.ai changed). The extracted raw JSON lives in `../.design-extract/raw/`.
- The ~80 `componentSrcMap: null` sub-part exclusions (Card/Dialog/AlertDialog/DropdownMenu/Select/Popover/Sheet/Accordion/Tabs/Avatar/Tooltip/RadioGroup/ToggleGroup/Alert/ScrollArea/Collapsible parts) must stay, or the DS pane regrows dozens of junk cards. Adding a new component? add its main name (path) + every `.d.ts`-exported sub-part as `null`.
- The 4 overlay `cfg.overrides` (cardMode:single for DropdownMenu/HoverCard/Popover/Tooltip) must stay or `[GRID_OVERFLOW]` returns.
- Capture/render-check needs Chrome: playwright is installed `--no-save` in `.ds-sync/`; drive system Chrome with `DS_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` on the resync/validate/capture commands (no `--no-render-check` needed — renders ARE machine-verified this way).
- `componentSrcMap.MemoryRouter: null` must stay, or the re-exported router shows up as a bogus DS card.
- Don't drop the `MemoryRouter` re-export from `components/ui/index.ts` — Sidebar's preview (and any design using Sidebar) needs it from the same bundle, or NavLink crashes.
- Light mode only — dark tokens were extracted (`[data-mode="dark"]`) but not shipped.

## Preview scope decisions (user)
- **Card previews are generic surfaces only** — no business forms. The earlier `SignInForm` cell (cream card + Inputs + CTA) was removed at the user's request; the login form is authored separately by the user, NOT as a Card story. Keep Card stories to generic White/Cream surface demos.

## Token architecture (v2 — current)
- Switched from claude-native utility names (bg-bg-100/text-text-100 + custom .btn classes) to **shadcn semantic roles** (`--color-primary`/`background`/`border`/`ring`/`muted`…) so `npx shadcn add` works and it matches the OpenAI Platform DS architecture. `components.json` added.
- `globals.css` is now **hand-authored** (raw claude palette → shadcn roles, one hop). The old `.design-extract/gen-globals.mjs` generator was REMOVED (it produced the v1 claude-native sheet — do not resurrect it). Raw extracted values still live in `.design-extract/raw/`.
- Components use shadcn utility idiom (`bg-primary`, `border-border`, etc.); claude signatures kept: `.ds-press` spring scale(.96), serif CardTitle, .5px hairline + `shadow-card`, black focus ring, clay as `bg-brand` (scarce), primary/danger no hover colour change.
