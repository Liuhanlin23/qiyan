import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from 'desktop'

/** Default white card floating on the canvas — hairline border + ultra-soft diffuse shadow. */
export function White() {
  return (
    <div className="max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>Think fast, build faster</CardTitle>
          <CardDescription>
            White card — 24px radius, .5px hairline, multi-layer soft diffuse shadow (no heavy drop).
          </CardDescription>
        </CardHeader>
        <CardContent>Primary actions use the black button; clay is reserved for the key CTA.</CardContent>
        <CardFooter>
          <Button variant="primary">Get started</Button>
          <Button variant="ghost">Learn more</Button>
        </CardFooter>
      </Card>
    </div>
  )
}

/** Cream surface variant (bg-100, 32px radius) — the warmer card used for spotlight content. */
export function Cream() {
  return (
    <div className="max-w-sm">
      <Card cream>
        <CardHeader>
          <CardTitle>奶油底卡片</CardTitle>
          <CardDescription>Cream surface on bg-100 with a larger 32px radius.</CardDescription>
        </CardHeader>
        <CardContent>用于需要更暖、更突出的内容区块。</CardContent>
        <CardFooter>
          <Button variant="claude">Continue</Button>
        </CardFooter>
      </Card>
    </div>
  )
}
