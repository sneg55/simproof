import { type NormalizedPreview, rendererFeaturesAreImplemented } from '@simproof/contracts'

import { GraphPaper, SCENE, SceneFrame, SimDefs } from '@/preview/sim-scene'

type ProjectilePreview = Extract<NormalizedPreview, { domain: 'projectile' }>

const VELOCITY_SCALE = 1.8

export function ProjectileGraphic({
  preview,
  sampleIndex,
  id,
}: {
  readonly preview: ProjectilePreview
  readonly sampleIndex: number
  readonly id: string
}) {
  const geometry = projectileGeometry(preview.samples)
  const current = geometry.points.at(sampleIndex) ?? geometry.points.at(0)
  const sample = preview.samples.at(sampleIndex) ?? preview.samples.at(0)
  const hasFeature = (feature: string) =>
    preview.renderer.features.some((requested) => requested === feature) &&
    rendererFeaturesAreImplemented(preview.domain, preview.renderer.renderer, [feature])
  const midX = (SCENE.left + SCENE.right) / 2
  const midY = (SCENE.top + SCENE.bottom) / 2
  return (
    <svg
      aria-describedby={`${id}-description`}
      aria-labelledby={`${id}-title`}
      className="h-auto w-full rounded-lg border border-border"
      role="img"
      viewBox="0 0 640 320"
    >
      <title id={`${id}-title`}>Projectile trajectory view</title>
      <desc id={`${id}-description`}>
        A plotted trajectory with labeled launch, apex, and impact markers. The complete numeric
        data follows in a table.
      </desc>
      <SimDefs id={id} />
      <SceneFrame id={id} />
      <GraphPaper />
      <line
        className="stroke-foreground"
        strokeWidth="2"
        x1={SCENE.left}
        x2={SCENE.right}
        y1={SCENE.bottom}
        y2={SCENE.bottom}
      />
      <line
        className="stroke-border"
        strokeWidth="1.5"
        x1={SCENE.left}
        x2={SCENE.left}
        y1={SCENE.top}
        y2={SCENE.bottom}
      />
      {hasFeature('trail') ? (
        <polyline
          className="stroke-chart-1"
          fill="none"
          filter={`url(#${id}-glow)`}
          points={geometry.points.map(({ x, y }) => `${x},${y}`).join(' ')}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
      ) : null}
      {preview.events.map((event) => {
        const point = geometry.points.at(event.sampleIndex)
        const enabled =
          event.kind === 'launch' ||
          (event.kind === 'apex' && hasFeature('apex-marker')) ||
          (event.kind === 'impact' && hasFeature('impact-marker'))
        return point === undefined || !enabled ? null : (
          <g key={event.kind}>
            <circle className="fill-foreground" cx={point.x} cy={point.y} r="4" />
            <text
              className="fill-muted-foreground font-medium"
              fontSize="13"
              textAnchor="middle"
              x={point.x}
              y={Math.max(20, point.y - 12)}
            >
              {eventLabel(event.kind)}
            </text>
          </g>
        )
      })}
      {current !== undefined &&
      sample?.velocityXMps !== undefined &&
      sample.velocityYMps !== undefined ? (
        <g strokeLinecap="round" strokeWidth="3">
          <line
            className="stroke-vector-velocity"
            markerEnd={`url(#${id}-arrow-v)`}
            x1={current.x}
            x2={current.x + sample.velocityXMps * VELOCITY_SCALE}
            y1={current.y}
            y2={current.y}
          />
          <line
            className="stroke-vector-component"
            markerEnd={`url(#${id}-arrow-c)`}
            x1={current.x}
            x2={current.x}
            y1={current.y}
            y2={current.y - sample.velocityYMps * VELOCITY_SCALE}
          />
        </g>
      ) : null}
      {current === undefined ? null : (
        <g>
          <circle
            className="fill-signal"
            cx={current.x}
            cy={current.y}
            filter={`url(#${id}-glow)`}
            r="9"
          />
          <circle className="fill-background" cx={current.x} cy={current.y} r="4" />
        </g>
      )}
      <text className="fill-muted-foreground" fontSize="13" textAnchor="middle" x={midX} y="306">
        Horizontal position (m)
      </text>
      <text
        className="fill-muted-foreground"
        fontSize="13"
        textAnchor="middle"
        transform={`rotate(-90 18 ${midY})`}
        x="18"
        y={midY}
      >
        Height (m)
      </text>
    </svg>
  )
}

function projectileGeometry(samples: ProjectilePreview['samples']): {
  readonly points: readonly { readonly x: number; readonly y: number }[]
} {
  let maxX = 0
  let maxY = 0
  for (const sample of samples) {
    maxX = Math.max(maxX, sample.xM)
    maxY = Math.max(maxY, sample.yM)
  }
  const xScale = maxX === 0 ? 1 : 540 / maxX
  const yScale = maxY === 0 ? 1 : 210 / maxY
  return {
    points: samples.map((sample) => ({
      x: 58 + sample.xM * xScale,
      y: 272 - sample.yM * yScale,
    })),
  }
}

function eventLabel(kind: 'launch' | 'apex' | 'impact'): string {
  if (kind === 'launch') return 'Launch'
  if (kind === 'apex') return 'Apex'
  return 'Impact'
}
