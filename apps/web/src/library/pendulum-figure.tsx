export function PendulumFigure() {
  return (
    <figure
      aria-hidden="true"
      className="relative m-0 hidden aspect-square w-full max-w-[340px] justify-self-end overflow-hidden rounded-[26px] border border-border shadow-surface lg:block"
      style={{
        background:
          'radial-gradient(120% 120% at 50% 0%, color-mix(in oklab, var(--primary) 12%, var(--card)) 0%, var(--card) 62%)',
      }}
    >
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full" role="presentation">
        <line
          x1="70"
          y1="252"
          x2="330"
          y2="252"
          stroke="var(--grid-line)"
          strokeWidth="1.5"
          strokeDasharray="1 6"
          strokeLinecap="round"
        />
        <path
          d="M120 250 Q200 350 280 250"
          stroke="var(--primary)"
          strokeWidth="1.6"
          fill="none"
          strokeDasharray="2 7"
          opacity="0.55"
        />
        <line
          x1="200"
          y1="46"
          x2="200"
          y2="300"
          stroke="var(--border)"
          strokeWidth="1.2"
          strokeDasharray="3 5"
        />
        <circle cx="200" cy="46" r="5" fill="var(--foreground)" />
        <g className="pendulum-arm">
          <line
            x1="200"
            y1="46"
            x2="200"
            y2="250"
            stroke="var(--foreground)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="200" cy="250" r="22" fill="var(--status-verified)" />
          <circle cx="192" cy="242" r="6" fill="#ffffff" opacity="0.28" />
        </g>
      </svg>
      <figcaption className="absolute bottom-4 left-4 rounded-lg border border-border bg-card/80 px-2 py-1 font-mono text-xs text-muted-foreground">
        θ ≤ 15° · verified range
      </figcaption>
    </figure>
  )
}
