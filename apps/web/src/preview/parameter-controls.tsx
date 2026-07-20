import type { NormalizedPreview, PreviewRequest } from '@simproof/contracts'
import { type FormEvent, type KeyboardEvent, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

type ApplyResult = 'success' | 'failure'
type NumericErrors = Readonly<Record<string, string | undefined>>

export function ParameterControls({
  preview,
  request,
  busy,
  onApply,
}: {
  readonly preview: NormalizedPreview
  readonly request: PreviewRequest
  readonly busy: boolean
  readonly onApply: (request: PreviewRequest) => Promise<ApplyResult>
}) {
  return preview.domain === 'projectile' && request.domain === 'projectile' ? (
    <ProjectileControls preview={preview} request={request} busy={busy} onApply={onApply} />
  ) : preview.domain === 'pendulum' && request.domain === 'pendulum' ? (
    <PendulumControls preview={preview} request={request} busy={busy} onApply={onApply} />
  ) : null
}

function ProjectileControls({
  preview,
  request,
  busy,
  onApply,
}: {
  readonly preview: Extract<NormalizedPreview, { domain: 'projectile' }>
  readonly request: Extract<PreviewRequest, { domain: 'projectile' }>
  readonly busy: boolean
  readonly onApply: (request: PreviewRequest) => Promise<ApplyResult>
}) {
  const [speed, setSpeed] = useState(String(preview.input.initialSpeedMps))
  const [angle, setAngle] = useState(String(preview.input.launchAngleDeg))
  const [errors, setErrors] = useState<NumericErrors>({})
  const id = useId()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const speedResult = boundedNumber(
      speed,
      preview.conceptSpec.parameters.initialSpeed.requestedRange,
      'm/s',
    )
    const angleResult = boundedNumber(
      angle,
      preview.conceptSpec.parameters.launchAngle.requestedRange,
      'deg',
    )
    const nextErrors = { speed: speedResult.error, angle: angleResult.error }
    setErrors(nextErrors)
    if (speedResult.value === undefined || angleResult.value === undefined) return
    void onApply({
      ...request,
      input: { initialSpeedMps: speedResult.value, launchAngleDeg: angleResult.value },
    })
  }
  return (
    <ControlCard onSubmit={submit} busy={busy} onKeyboardSubmit={keyboardSubmit}>
      <ParameterField
        id={`${id}-speed`}
        label="Initial speed"
        unit="m/s"
        value={speed}
        range={preview.conceptSpec.parameters.initialSpeed.requestedRange}
        step={0.1}
        error={errors.speed}
        disabled={busy}
        onChange={setSpeed}
      />
      <ParameterField
        id={`${id}-angle`}
        label="Launch angle"
        unit="deg"
        value={angle}
        range={preview.conceptSpec.parameters.launchAngle.requestedRange}
        step={0.1}
        error={errors.angle}
        disabled={busy}
        onChange={setAngle}
      />
    </ControlCard>
  )
}

function PendulumControls({
  preview,
  request,
  busy,
  onApply,
}: {
  readonly preview: Extract<NormalizedPreview, { domain: 'pendulum' }>
  readonly request: Extract<PreviewRequest, { domain: 'pendulum' }>
  readonly busy: boolean
  readonly onApply: (request: PreviewRequest) => Promise<ApplyResult>
}) {
  const [length, setLength] = useState(String(preview.input.lengthM))
  const [amplitude, setAmplitude] = useState(String(preview.input.amplitudeDeg))
  const [errors, setErrors] = useState<NumericErrors>({})
  const id = useId()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const lengthResult = boundedNumber(
      length,
      preview.conceptSpec.parameters.length.requestedRange,
      'm',
    )
    const amplitudeResult = boundedNumber(
      amplitude,
      preview.conceptSpec.parameters.amplitude.requestedRange,
      'deg',
    )
    const nextErrors = { length: lengthResult.error, amplitude: amplitudeResult.error }
    setErrors(nextErrors)
    if (lengthResult.value === undefined || amplitudeResult.value === undefined) return
    void onApply({
      ...request,
      input: { lengthM: lengthResult.value, amplitudeDeg: amplitudeResult.value },
    })
  }
  return (
    <ControlCard onSubmit={submit} busy={busy} onKeyboardSubmit={keyboardSubmit}>
      <ParameterField
        id={`${id}-length`}
        label="Pendulum length"
        unit="m"
        value={length}
        range={preview.conceptSpec.parameters.length.requestedRange}
        step={0.01}
        error={errors.length}
        disabled={busy}
        onChange={setLength}
      />
      <ParameterField
        id={`${id}-amplitude`}
        label="Release amplitude"
        unit="deg"
        value={amplitude}
        range={preview.conceptSpec.parameters.amplitude.requestedRange}
        step={0.1}
        error={errors.amplitude}
        disabled={busy}
        onChange={setAmplitude}
      />
    </ControlCard>
  )
}

function ControlCard({
  children,
  onSubmit,
  onKeyboardSubmit,
  busy,
}: {
  readonly children: React.ReactNode
  readonly onSubmit: (event: FormEvent) => void
  readonly onKeyboardSubmit: (event: KeyboardEvent<HTMLFormElement>) => void
  readonly busy: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Parameters</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={onSubmit} onKeyDown={onKeyboardSubmit} noValidate>
          <FieldGroup className="grid gap-4 md:grid-cols-2">{children}</FieldGroup>
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? 'Refreshing preview' : 'Apply parameters'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function ParameterField({
  id,
  label,
  unit,
  value,
  range,
  step,
  error,
  disabled,
  onChange,
}: {
  readonly id: string
  readonly label: string
  readonly unit: string
  readonly value: string
  readonly range: { readonly min: number; readonly max: number }
  readonly step: number
  readonly error: string | undefined
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}) {
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  return (
    <Field data-invalid={error === undefined ? undefined : true}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={id}
        type="number"
        inputMode="decimal"
        step={step}
        min={range.min}
        max={range.max}
        value={value}
        disabled={disabled}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={`${descriptionId}${error === undefined ? '' : ` ${errorId}`}`}
        data-dynamic-number
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <FieldDescription id={descriptionId}>
        Allowed {range.min} to {range.max} {unit}.
      </FieldDescription>
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  )
}

function boundedNumber(
  raw: string,
  range: { readonly min: number; readonly max: number },
  unit: string,
): { readonly value?: number; readonly error?: string } {
  if (raw.trim() === '') return { error: 'Enter a finite number.' }
  const value = Number(raw)
  if (!Number.isFinite(value)) return { error: 'Enter a finite number.' }
  if (value < range.min || value > range.max) {
    return { error: `Enter a value from ${range.min} to ${range.max} ${unit}.` }
  }
  return { value }
}

function keyboardSubmit(event: KeyboardEvent<HTMLFormElement>): void {
  if (event.key !== 'Enter' || event.target instanceof HTMLButtonElement) return
  event.preventDefault()
  event.currentTarget.requestSubmit()
}
