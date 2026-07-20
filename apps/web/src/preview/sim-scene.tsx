/**
 * Shared coordinate frame and decorative SVG primitives for the simulation
 * graphics. Everything here is presentation only: the renderers plot the same
 * deterministic, server-normalized samples, and the equivalent data table
 * remains the accessible source of truth.
 */
export const SCENE = {
  width: 640,
  height: 320,
  left: 58,
  right: 598,
  top: 46,
  bottom: 272,
} as const

/** Glow filter, frame gradient, and vector arrowheads, scoped by id prefix. */
export function SimDefs({ id }: { readonly id: string }) {
  return (
    <defs>
      <filter height="240%" id={`${id}-glow`} width="240%" x="-70%" y="-70%">
        <feGaussianBlur result="blur" stdDeviation="5" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <linearGradient id={`${id}-frame`} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" style={{ stopColor: 'var(--card)' }} />
        <stop offset="100%" style={{ stopColor: 'var(--muted)' }} />
      </linearGradient>
      <marker
        id={`${id}-arrow-v`}
        markerHeight="7"
        markerWidth="7"
        orient="auto"
        refX="5.5"
        refY="3.5"
      >
        <path className="fill-vector-velocity" d="M0 0 L7 3.5 L0 7 Z" />
      </marker>
      <marker
        id={`${id}-arrow-c`}
        markerHeight="7"
        markerWidth="7"
        orient="auto"
        refX="5.5"
        refY="3.5"
      >
        <path className="fill-vector-component" d="M0 0 L7 3.5 L0 7 Z" />
      </marker>
    </defs>
  )
}

/** Graph-paper grid within the plot area. Purely decorative. */
export function GraphPaper({ step = 40 }: { readonly step?: number }) {
  const columns = Math.floor((SCENE.right - SCENE.left) / step)
  const rows = Math.floor((SCENE.bottom - SCENE.top) / step)
  const verticals = Array.from({ length: columns + 1 }, (_, index) => SCENE.left + index * step)
  const horizontals = Array.from({ length: rows + 1 }, (_, index) => SCENE.bottom - index * step)
  return (
    <g aria-hidden="true">
      {verticals.map((x) => (
        <line
          className="stroke-grid-line"
          key={`v${x}`}
          strokeWidth="1"
          x1={x}
          x2={x}
          y1={SCENE.top}
          y2={SCENE.bottom}
        />
      ))}
      {horizontals.map((y) => (
        <line
          className="stroke-grid-line"
          key={`h${y}`}
          strokeWidth="1"
          x1={SCENE.left}
          x2={SCENE.right}
          y1={y}
          y2={y}
        />
      ))}
    </g>
  )
}

/** The gradient-filled rounded frame that sits behind a scene. */
export function SceneFrame({ id }: { readonly id: string }) {
  return (
    <rect
      fill={`url(#${id}-frame)`}
      height={SCENE.height}
      rx="10"
      width={SCENE.width}
      x="0"
      y="0"
    />
  )
}
