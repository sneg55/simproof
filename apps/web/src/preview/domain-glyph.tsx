import { cn } from '@/lib/utils'

/**
 * A compact, decorative thumbnail of a domain's simulation, shown on library
 * cards so projectile and pendulum simulations are visually distinguishable at
 * a glance. Purely presentational (aria-hidden); the card title and badges
 * carry the accessible meaning.
 */
export function DomainGlyph({
  domain,
  className,
}: {
  readonly domain: string | null
  readonly className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn(
        'h-16 w-full rounded-md border border-border bg-muted/40 text-muted-foreground',
        className,
      )}
      preserveAspectRatio="xMidYMid meet"
      viewBox="0 0 160 64"
    >
      <line className="stroke-grid-line" strokeWidth="1" x1="0" x2="160" y1="21" y2="21" />
      <line className="stroke-grid-line" strokeWidth="1" x1="0" x2="160" y1="43" y2="43" />
      <line className="stroke-grid-line" strokeWidth="1" x1="53" x2="53" y1="0" y2="64" />
      <line className="stroke-grid-line" strokeWidth="1" x1="107" x2="107" y1="0" y2="64" />
      {domain === 'projectile' ? <ProjectileMark /> : null}
      {domain === 'pendulum' ? <PendulumMark /> : null}
      {domain !== 'projectile' && domain !== 'pendulum' ? <GenericMark /> : null}
    </svg>
  )
}

function ProjectileMark() {
  return (
    <>
      <line className="stroke-border" strokeWidth="2" x1="14" x2="146" y1="54" y2="54" />
      <path
        className="stroke-chart-1"
        d="M16 54 Q80 2 144 54"
        fill="none"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <circle className="fill-signal" cx="80" cy="18" r="5" />
    </>
  )
}

function PendulumMark() {
  return (
    <>
      <line
        className="stroke-foreground"
        strokeLinecap="round"
        strokeWidth="3"
        x1="60"
        x2="100"
        y1="10"
        y2="10"
      />
      <line
        className="stroke-chart-1"
        strokeLinecap="round"
        strokeWidth="2.5"
        x1="80"
        x2="102"
        y1="10"
        y2="48"
      />
      <circle className="fill-signal" cx="102" cy="48" r="7" />
      <path
        className="stroke-chart-3 opacity-70"
        d="M58 48 Q80 60 102 48"
        fill="none"
        strokeDasharray="3 3"
        strokeWidth="2"
      />
    </>
  )
}

function GenericMark() {
  return (
    <>
      <circle className="fill-muted-foreground/60" cx="66" cy="32" r="4" />
      <circle className="fill-muted-foreground/60" cx="80" cy="32" r="4" />
      <circle className="fill-muted-foreground/60" cx="94" cy="32" r="4" />
    </>
  )
}
