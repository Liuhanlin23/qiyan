import { Avatar, AvatarImage, AvatarFallback } from 'desktop'

/** Initials fallback (no image). Neutral by default; black/clay via the fallback's className. */
export function Fallback() {
  return (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarFallback>刘</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback className="bg-foreground text-background">刘</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback className="bg-brand text-brand-foreground">N</AvatarFallback>
      </Avatar>
    </div>
  )
}

/** Sizes via className (28 / 40 / 56px). */
export function Sizes() {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-7">
        <AvatarFallback className="text-xs">刘</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>刘</AvatarFallback>
      </Avatar>
      <Avatar className="size-14">
        <AvatarFallback className="text-lg">刘</AvatarFallback>
      </Avatar>
    </div>
  )
}

/** Account block — the shape the Sidebar footer uses. */
export function AccountBlock() {
  return (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarFallback className="bg-foreground text-background">刘</AvatarFallback>
      </Avatar>
      <div className="leading-tight">
        <div className="text-sm font-medium text-foreground">刘翰霖</div>
        <div className="text-xs text-muted-foreground">Max plan</div>
      </div>
    </div>
  )
}
