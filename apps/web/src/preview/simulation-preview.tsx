import type { NormalizedPreview } from '@simproof/contracts'
import PauseIcon from 'lucide-react/dist/esm/icons/pause.mjs'
import PlayIcon from 'lucide-react/dist/esm/icons/play.mjs'
import RotateCcwIcon from 'lucide-react/dist/esm/icons/rotate-ccw.mjs'
import StepForwardIcon from 'lucide-react/dist/esm/icons/step-forward.mjs'
import { type KeyboardEvent, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { formatPreviewNumber } from '@/preview/format-preview-number'
import { PreviewGraphic } from '@/preview/preview-graphic'
import { PreviewDataTable } from '@/preview/preview-table'

export function SimulationPreview({ preview }: { readonly preview: NormalizedPreview }) {
  const [sampleIndex, setSampleIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const reducedMotion = useReducedMotion()
  const lastIndex = preview.samples.length - 1
  const current = preview.samples.at(sampleIndex) ?? preview.samples.at(0)

  useEffect(() => {
    if (!playing || reducedMotion) return
    const interval = window.setInterval(() => {
      setSampleIndex((index) => {
        const next = Math.min(index + 1, lastIndex)
        if (next === lastIndex) {
          window.clearInterval(interval)
          setPlaying(false)
        }
        return next
      })
    }, 600)
    return () => window.clearInterval(interval)
  }, [lastIndex, playing, reducedMotion])

  const step = () => {
    setPlaying(false)
    setSampleIndex((index) => Math.min(index + 1, lastIndex))
  }
  const reset = () => {
    setPlaying(false)
    setSampleIndex(0)
  }
  const togglePlayback = () => {
    if (reducedMotion) return
    if (!playing && sampleIndex === lastIndex) setSampleIndex(0)
    setPlaying((currentPlaying) => !currentPlaying)
  }
  const shortcuts = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key === ' ') {
      event.preventDefault()
      togglePlayback()
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      step()
    } else if (event.key === 'Home') {
      event.preventDefault()
      reset()
    }
  }

  return (
    <article className="grid gap-6" aria-labelledby="simulation-preview-heading">
      <header className="grid max-w-3xl gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{preview.domain}</Badge>
          <Badge
            variant={preview.evidence.validity.status === 'current' ? 'outline' : 'destructive'}
          >
            {preview.evidence.validity.status} evidence
          </Badge>
        </div>
        <h1
          id="simulation-preview-heading"
          className="text-page-title font-heading font-semibold tracking-tight"
        >
          {preview.conceptSpec.title}
        </h1>
        <p className="text-muted-foreground">{explanation(preview)}</p>
        {preview.domain === 'pendulum' ? (
          <p data-dynamic-number>
            One full swing (the period) takes {formatPreviewNumber(preview.periodS)} seconds in the
            trusted model.
          </p>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Simulation view</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <PreviewGraphic preview={preview} sampleIndex={sampleIndex} />
          <section
            role="region"
            aria-label="Playback controls"
            tabIndex={0}
            onKeyDown={shortcuts}
            className="grid gap-3 rounded-lg bg-muted p-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={togglePlayback}
                disabled={reducedMotion}
                aria-label={playing ? 'Pause simulation' : 'Play simulation'}
              >
                {playing ? (
                  <PauseIcon data-icon="inline-start" />
                ) : (
                  <PlayIcon data-icon="inline-start" className="ml-0.5" />
                )}
                {playing ? 'Pause' : 'Play'}
              </Button>
              <Button type="button" variant="outline" onClick={reset} aria-label="Reset simulation">
                <RotateCcwIcon data-icon="inline-start" /> Reset
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={step}
                disabled={sampleIndex === lastIndex}
                aria-label="Step forward"
              >
                <StepForwardIcon data-icon="inline-start" /> Step forward
              </Button>
            </div>
            <Slider
              aria-label="Scrub to sample"
              aria-valuetext={`Sample ${sampleIndex + 1} of ${preview.samples.length}`}
              max={lastIndex}
              min={0}
              onChange={(event) => {
                setPlaying(false)
                setSampleIndex(Number(event.target.value))
              }}
              step={1}
              value={sampleIndex}
            />
            <p className="text-sm text-muted-foreground">
              Keyboard: Space plays or pauses, Right Arrow steps, and Home resets when this control
              region is focused.
            </p>
            {reducedMotion ? (
              <p className="text-sm">
                Automatic playback is off because reduced motion is enabled. Use Step forward.
              </p>
            ) : null}
            <p role="status" aria-live="polite" className="text-sm font-medium" data-dynamic-number>
              Sample {sampleIndex + 1} of {preview.samples.length}. Time{' '}
              {formatPreviewNumber(current?.timeS ?? 0)} seconds.
            </p>
            {current === undefined ? null : (
              <CurrentPhysicalState preview={preview} sample={current} />
            )}
          </section>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Equivalent data table</CardTitle>
        </CardHeader>
        <CardContent>
          <PreviewDataTable key={sampleIndex} preview={preview} currentIndex={sampleIndex} />
        </CardContent>
      </Card>
      <InterpretationBoundaries preview={preview} />
    </article>
  )
}

function CurrentPhysicalState({
  preview,
  sample,
}: {
  readonly preview: NormalizedPreview
  readonly sample: NormalizedPreview['samples'][number]
}) {
  const entries =
    preview.domain === 'projectile' && 'xM' in sample
      ? [
          ['Time', `${formatPreviewNumber(sample.timeS)} s`],
          ['Horizontal position', `${formatPreviewNumber(sample.xM)} m`],
          ['Height', `${formatPreviewNumber(sample.yM)} m`],
          ['Speed', `${formatPreviewNumber(sample.speedMps)} m/s`],
          [
            'Horizontal velocity',
            sample.velocityXMps === undefined
              ? 'Not provided'
              : `${formatPreviewNumber(sample.velocityXMps)} m/s`,
          ],
          [
            'Vertical velocity',
            sample.velocityYMps === undefined
              ? 'Not provided'
              : `${formatPreviewNumber(sample.velocityYMps)} m/s`,
          ],
        ]
      : 'angleDeg' in sample
        ? [
            ['Time', `${formatPreviewNumber(sample.timeS)} s`],
            ['Angle', `${formatPreviewNumber(sample.angleDeg)} deg`],
            [
              'Angular velocity',
              sample.angularVelocityDegPerS === undefined
                ? 'Not provided'
                : `${formatPreviewNumber(sample.angularVelocityDegPerS)} deg/s`,
            ],
          ]
        : []
  return (
    <section aria-labelledby="current-physical-state-heading" className="grid gap-2">
      <h3 id="current-physical-state-heading" className="font-medium">
        Current physical state
      </h3>
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        {entries.map(([label, value]) => (
          <div key={label} className="grid gap-0.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd data-dynamic-number>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function InterpretationBoundaries({ preview }: { readonly preview: NormalizedPreview }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Interpretation boundaries</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <BoundaryList title="Assumptions" items={preview.evidence.assumptions} />
        <BoundaryList title="Limitations" items={preview.evidence.limitations} />
      </CardContent>
    </Card>
  )
}

function BoundaryList({
  title,
  items,
}: {
  readonly title: string
  readonly items: readonly string[]
}) {
  return (
    <section>
      <h2 className="font-medium">{title}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  )
}

function explanation(preview: NormalizedPreview): string {
  if (preview.domain === 'projectile') {
    return `A projectile launched at ${formatPreviewNumber(preview.input.initialSpeedMps)} m/s and ${formatPreviewNumber(preview.input.launchAngleDeg)}°. The graphic and table below use only precomputed, verified data, so no code runs in your browser.`
  }
  return `A ${formatPreviewNumber(preview.input.lengthM)} m pendulum released at ${formatPreviewNumber(preview.input.amplitudeDeg)}°. The graphic and table below use only precomputed, verified data, so no code runs in your browser.`
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? false
      : window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}
