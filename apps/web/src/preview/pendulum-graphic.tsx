import { type NormalizedPreview, rendererFeaturesAreImplemented } from '@simproof/contracts'

import { formatPreviewNumber } from '@/preview/format-preview-number'
import { GraphPaper, SceneFrame, SimDefs } from '@/preview/sim-scene'

type PendulumPreview = Extract<NormalizedPreview, { domain: 'pendulum' }>

const PIVOT = { x: 320, y: 60 }
const LENGTH = 190

function bobAt(angleDeg: number): { readonly x: number; readonly y: number } {
  const radians = (angleDeg * Math.PI) / 180
  return { x: PIVOT.x + Math.sin(radians) * LENGTH, y: PIVOT.y + Math.cos(radians) * LENGTH }
}

export function PendulumGraphic({
  preview,
  sampleIndex,
  id,
}: {
  readonly preview: PendulumPreview
  readonly sampleIndex: number
  readonly id: string
}) {
  const sample = preview.samples.at(sampleIndex) ?? preview.samples.at(0)
  const angleDeg = sample?.angleDeg ?? 0
  const bob = bobAt(angleDeg)
  const amplitude = preview.samples.reduce((max, item) => Math.max(max, Math.abs(item.angleDeg)), 0)
  const arcPoints = Array.from({ length: 25 }, (_, step) => {
    const angle = -amplitude + (2 * amplitude * step) / 24
    const point = bobAt(angle)
    return `${point.x},${point.y}`
  }).join(' ')
  const atTurningPoint = preview.events.some(
    (event) => event.sampleIndex === sampleIndex && event.kind.includes('turning-point'),
  )
  const hasFeature = (feature: string) =>
    preview.renderer.features.some((requested) => requested === feature) &&
    rendererFeaturesAreImplemented(preview.domain, preview.renderer.renderer, [feature])
  return (
    <svg
      aria-describedby={`${id}-description`}
      aria-labelledby={`${id}-title`}
      className="h-auto w-full rounded-lg border border-border"
      role="img"
      viewBox="0 0 640 320"
    >
      <title id={`${id}-title`}>Pendulum position view</title>
      <desc id={`${id}-description`}>
        A pendulum at the selected angle with a dashed equilibrium line. The complete numeric data
        follows in a table.
      </desc>
      <SimDefs id={id} />
      <SceneFrame id={id} />
      <GraphPaper />
      <polyline
        className="stroke-chart-3 opacity-60"
        fill="none"
        points={arcPoints}
        strokeDasharray="6 6"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <line
        className="stroke-foreground"
        strokeLinecap="round"
        strokeWidth="6"
        x1={PIVOT.x - 90}
        x2={PIVOT.x + 90}
        y1={PIVOT.y}
        y2={PIVOT.y}
      />
      {hasFeature('equilibrium-line') ? (
        <>
          <line
            className="stroke-muted-foreground"
            strokeDasharray="7 6"
            strokeWidth="2"
            x1={PIVOT.x}
            x2={PIVOT.x}
            y1={PIVOT.y}
            y2={276}
          />
          <text className="fill-muted-foreground" fontSize="14" x={PIVOT.x + 12} y="296">
            Equilibrium
          </text>
        </>
      ) : null}
      <line
        className="stroke-chart-1"
        strokeLinecap="round"
        strokeWidth="4"
        x1={PIVOT.x}
        x2={bob.x}
        y1={PIVOT.y}
        y2={bob.y}
      />
      <circle className="fill-signal" cx={bob.x} cy={bob.y} filter={`url(#${id}-glow)`} r="20" />
      <path
        className="stroke-signal-foreground"
        d={`M ${bob.x - 8} ${bob.y} h 16 M ${bob.x} ${bob.y - 8} v 16`}
        strokeWidth="2"
      />
      <text className="fill-foreground font-medium" fontSize="15" x="24" y="34">
        Angle: {formatPreviewNumber(angleDeg)}°
      </text>
      {atTurningPoint && hasFeature('turning-points') ? (
        <text className="fill-chart-3 font-medium" fontSize="14" x="24" y="58">
          Turning point
        </text>
      ) : null}
    </svg>
  )
}
