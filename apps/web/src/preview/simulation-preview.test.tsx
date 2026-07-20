import type { NormalizedPreview } from '@simproof/contracts'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SimulationPreview } from '@/preview/simulation-preview'

const versionId = '123e4567-e89b-42d3-a456-426614174000'
const verificationRunId = '223e4567-e89b-42d3-a456-426614174000'
const hash = `sha256:${'a'.repeat(64)}`
const evidence = {
  verificationRunId,
  artifactHash: hash,
  validity: { status: 'current' as const },
  assumptions: ['Uniform gravity.'],
  limitations: ['No aerodynamic drag.'],
}

const projectile: NormalizedPreview = {
  schemaVersion: '1',
  domain: 'projectile',
  simulationVersionId: versionId,
  conceptSpec: {
    schemaVersion: '1',
    domain: 'projectile',
    title: 'Projectile trajectory',
    parameters: {
      initialSpeed: { unit: 'm/s', defaultValue: 20, requestedRange: { min: 10, max: 30 } },
      launchAngle: { unit: 'deg', defaultValue: 45, requestedRange: { min: 15, max: 75 } },
    },
    requestedControls: ['initialSpeed', 'launchAngle'],
  },
  renderer: {
    schemaVersion: '1',
    domain: 'projectile',
    renderer: 'projectile-trajectory',
    features: ['trail', 'apex-marker', 'impact-marker'],
  },
  input: { initialSpeedMps: 20, launchAngleDeg: 45 },
  evidence,
  samples: [
    { index: 0, timeS: 0, xM: 0, yM: 0, speedMps: 20 },
    { index: 1, timeS: 1, xM: 14, yM: 9, speedMps: 15 },
    { index: 2, timeS: 3, xM: 42, yM: 0, speedMps: 20 },
  ],
  events: [
    { kind: 'launch', sampleIndex: 0 },
    { kind: 'apex', sampleIndex: 1 },
    { kind: 'impact', sampleIndex: 2 },
  ],
}

const pendulum: NormalizedPreview = {
  schemaVersion: '1',
  domain: 'pendulum',
  simulationVersionId: versionId,
  conceptSpec: {
    schemaVersion: '1',
    domain: 'pendulum',
    title: 'Pendulum period',
    parameters: {
      length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
      amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 1, max: 15 } },
    },
    requestedControls: ['length', 'amplitude'],
  },
  renderer: {
    schemaVersion: '1',
    domain: 'pendulum',
    renderer: 'pendulum-bob',
    features: ['equilibrium-line', 'turning-points', 'period-markers'],
  },
  input: { lengthM: 1, amplitudeDeg: 10 },
  periodS: 2,
  evidence: { ...evidence, limitations: ['Small-angle approximation only.'] },
  samples: [
    { index: 0, timeS: 0, angleDeg: 10, angularVelocityDegPerS: 0 },
    { index: 1, timeS: 0.5, angleDeg: 0, angularVelocityDegPerS: -30 },
    { index: 2, timeS: 1, angleDeg: -10, angularVelocityDegPerS: 0 },
  ],
  events: [
    { kind: 'right-turning-point', sampleIndex: 0 },
    { kind: 'equilibrium-crossing', sampleIndex: 1 },
    { kind: 'left-turning-point', sampleIndex: 2 },
  ],
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})

afterEach(() => vi.unstubAllGlobals())

describe('accessible simulation preview', () => {
  it('renders projectile SVG and an equivalent complete data table', () => {
    render(<SimulationPreview preview={projectile} />)

    expect(screen.getByRole('img', { name: 'Projectile trajectory view' })).toBeVisible()
    expect(screen.getByText(/^A projectile launched at 20 m\/s and 45°/)).toBeVisible()
    const table = screen.getByRole('table', { name: 'Projectile trajectory data' })
    expect(
      screen.getByRole('region', { name: 'Scrollable projectile trajectory data' }),
    ).toContainElement(table)
    expect(table.querySelector('caption')).not.toBeNull()
    expect(within(table).getAllByRole('row')).toHaveLength(projectile.samples.length + 1)
    expect(within(table).getByRole('cell', { name: '14' })).toBeVisible()
    expect(within(table).getByRole('cell', { name: '9' })).toBeVisible()
    expect(within(table).getByRole('row', { name: /1 0 0 0 20/u })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(within(table).getByText('Rows 1 to 3 of 3.')).toBeVisible()
    const state = screen.getByRole('region', { name: 'Current physical state' })
    expect(within(state).getByText('Horizontal position')).toBeVisible()
    expect(within(state).getAllByText('0 m')).toHaveLength(2)
    expect(screen.getByText('Uniform gravity.')).toBeVisible()
    expect(screen.getByText('No aerodynamic drag.')).toBeVisible()
  })

  it('supports labeled pointer and keyboard controls with announced current data', () => {
    render(<SimulationPreview preview={projectile} />)
    const controls = screen.getByRole('region', { name: 'Playback controls' })
    expect(screen.getByRole('button', { name: 'Play simulation' })).toBeEnabled()

    fireEvent.keyDown(controls, { key: 'ArrowRight' })
    expect(screen.getByRole('status')).toHaveTextContent('Sample 2 of 3. Time 1 seconds.')
    expect(screen.getByText('14 m')).toBeVisible()
    expect(screen.getByText('9 m')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Reset simulation' }))
    expect(screen.getByRole('status')).toHaveTextContent('Sample 1 of 3. Time 0 seconds.')
    fireEvent.keyDown(controls, { key: ' ' })
    expect(screen.getByRole('button', { name: 'Pause simulation' })).toBeVisible()
    fireEvent.keyDown(controls, { key: ' ' })
    expect(screen.getByRole('button', { name: 'Play simulation' })).toBeVisible()
  })

  it('renders pendulum position, period, angular data, and non-color event labels', () => {
    render(<SimulationPreview preview={pendulum} />)

    expect(screen.getByRole('img', { name: 'Pendulum position view' })).toBeVisible()
    expect(
      screen.getByText('One full swing (the period) takes 2 seconds in the trusted model.'),
    ).toBeVisible()
    const table = screen.getByRole('table', { name: 'Pendulum motion data' })
    expect(
      screen.getByRole('region', { name: 'Scrollable pendulum motion data' }),
    ).toContainElement(table)
    expect(table.querySelector('caption')).not.toBeNull()
    expect(within(table).getAllByRole('row')).toHaveLength(pendulum.samples.length + 1)
    expect(within(table).getByRole('columnheader', { name: 'Angle (deg)' })).toBeVisible()
    expect(
      within(table).getByRole('columnheader', { name: 'Angular velocity (deg/s)' }),
    ).toBeVisible()
    expect(screen.getByText('Equilibrium')).toBeVisible()
    expect(screen.getByText('Turning point')).toBeVisible()
  })

  it('formats educator-facing measurements without floating-point residue', () => {
    const noisyPreview: NormalizedPreview = {
      ...pendulum,
      periodS: 2.837006706885775,
      samples: [
        {
          index: 0,
          timeS: 0.0100333403563238,
          angleDeg: 9.9506554321,
          angularVelocityDegPerS: -2.1369281743466316e-14,
        },
        pendulum.samples[1]!,
      ],
    }
    render(<SimulationPreview preview={noisyPreview} />)

    expect(
      screen.getByText('One full swing (the period) takes 2.837 seconds in the trusted model.'),
    ).toBeVisible()
    expect(screen.getByText('0 deg/s')).toBeVisible()
    const table = screen.getByRole('table', { name: 'Pendulum motion data' })
    expect(table).toHaveTextContent('0.01')
    expect(table).toHaveTextContent('9.951')
    expect(table).not.toHaveTextContent('2.1369281743466316e-14')
    expect(table).not.toHaveTextContent('0.0100333403563238')
  })

  it('renders only features requested from the typed implementation registry', () => {
    const { container, rerender } = render(
      <SimulationPreview
        preview={{ ...projectile, renderer: { ...projectile.renderer, features: [] } }}
      />,
    )
    const projectileGraphic = screen.getByRole('img', { name: 'Projectile trajectory view' })
    expect(projectileGraphic.querySelector('polyline')).toBeNull()
    expect(within(projectileGraphic).queryByText('Apex')).toBeNull()
    expect(within(projectileGraphic).queryByText('Impact')).toBeNull()

    rerender(
      <SimulationPreview
        preview={{ ...pendulum, renderer: { ...pendulum.renderer, features: [] } }}
      />,
    )
    const pendulumGraphic = screen.getByRole('img', { name: 'Pendulum position view' })
    expect(within(pendulumGraphic).queryByText('Equilibrium')).toBeNull()
    expect(within(pendulumGraphic).queryByText('Turning point')).toBeNull()
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(1)
  })

  it('renders hostile strings only as text and never creates host HTML or executable nodes', () => {
    const hostile = '<script>globalThis.pwned=true</script><img src=x onerror=alert(1)>'
    const preview = {
      ...projectile,
      conceptSpec: { ...projectile.conceptSpec, title: hostile },
      evidence: { ...projectile.evidence, assumptions: [hostile], limitations: [hostile] },
    }
    const { container } = render(<SimulationPreview preview={preview} />)

    expect(screen.getAllByText(hostile).length).toBeGreaterThan(0)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('dangerouslySetInnerHTML')
  })

  it('disables automatic playback under reduced motion while preserving stepping', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    render(<SimulationPreview preview={pendulum} />)

    expect(screen.getByRole('button', { name: 'Play simulation' })).toBeDisabled()
    expect(
      screen.getByText(
        'Automatic playback is off because reduced motion is enabled. Use Step forward.',
      ),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Step forward' }))
    expect(screen.getByRole('status')).toHaveTextContent('Sample 2 of 3')
  })

  it('advances playback without stale state and stops at the final sample', async () => {
    vi.useFakeTimers()
    render(<SimulationPreview preview={projectile} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play simulation' }))
    await act(async () => await vi.advanceTimersByTimeAsync(2_000))
    expect(screen.getByRole('status')).toHaveTextContent('Sample 3 of 3')
    expect(screen.getByRole('button', { name: 'Play simulation' })).toBeVisible()
    vi.useRealTimers()
  })

  it('bounds large equivalent tables and provides explicit pagination captions', () => {
    const samples = Array.from({ length: 120 }, (_, index) => ({
      index,
      timeS: index,
      xM: index,
      yM: index / 2,
      speedMps: 20,
    }))
    render(<SimulationPreview preview={{ ...projectile, samples, events: [] }} />)
    const table = screen.getByRole('table', { name: 'Projectile trajectory data' })
    expect(within(table).getAllByRole('row')).toHaveLength(51)
    expect(within(table).getByText('Rows 1 to 50 of 120.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Next data page' }))
    expect(within(table).getAllByRole('row')).toHaveLength(51)
    expect(within(table).getByText('Rows 51 to 100 of 120.')).toBeVisible()
    expect(within(table).getByRole('row', { name: /^51 50 50 25 20/u })).toBeVisible()
  })
})
