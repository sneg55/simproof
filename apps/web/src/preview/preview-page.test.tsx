import type { NormalizedPreview, PreviewRequest } from '@simproof/contracts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ReportPreviewApi } from '@/api/report-preview-api'
import { SimulationPreviewPageView } from '@/preview/preview-page'

const versionId = '123e4567-e89b-42d3-a456-426614174000'
const runId = '223e4567-e89b-42d3-a456-426614174000'
const csrfToken = 'c'.repeat(43)
const hash = `sha256:${'a'.repeat(64)}`

function projectilePreview(
  xM = 14,
  initialSpeedMps = 20,
): Extract<NormalizedPreview, { domain: 'projectile' }> {
  return {
    schemaVersion: '1',
    domain: 'projectile',
    simulationVersionId: versionId,
    conceptSpec: {
      schemaVersion: '1',
      domain: 'projectile',
      title: 'Projectile controls',
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
      features: ['trail'],
    },
    input: { initialSpeedMps, launchAngleDeg: 45 },
    evidence: {
      verificationRunId: runId,
      artifactHash: hash,
      validity: { status: 'current' },
      assumptions: ['Uniform gravity.'],
      limitations: ['No drag.'],
    },
    samples: [
      { index: 0, timeS: 0, xM: 0, yM: 0, speedMps: 20 },
      { index: 1, timeS: 1, xM, yM: 4.567, speedMps: 18 },
    ],
    events: [{ kind: 'launch', sampleIndex: 0 }],
  }
}

function pendulumPreview(): Extract<NormalizedPreview, { domain: 'pendulum' }> {
  return {
    schemaVersion: '1',
    domain: 'pendulum',
    simulationVersionId: versionId,
    conceptSpec: {
      schemaVersion: '1',
      domain: 'pendulum',
      title: 'Pendulum controls',
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
      features: ['equilibrium-line'],
    },
    input: { lengthM: 1, amplitudeDeg: 10 },
    periodS: 2,
    evidence: {
      verificationRunId: runId,
      artifactHash: hash,
      validity: { status: 'current' },
      assumptions: ['Uniform gravity.'],
      limitations: ['Small-angle model.'],
    },
    samples: [
      { index: 0, timeS: 0, angleDeg: 10 },
      { index: 1, timeS: 1, angleDeg: -10 },
    ],
    events: [{ kind: 'right-turning-point', sampleIndex: 0 }],
  }
}

function api(overrides: Partial<ReportPreviewApi>): ReportPreviewApi {
  return {
    versionReport: vi.fn(),
    seedReport: vi.fn(),
    versionPreview: vi.fn(),
    seedPreview: vi.fn(),
    publishVersion: vi.fn(),
    reverifyVersion: vi.fn(),
    ...overrides,
  }
}

describe('bounded preview parameters', () => {
  it('keeps loading and unavailable preview states titled, headed, and non-disruptive to focus', async () => {
    let resolvePreview:
      | ((result: Awaited<ReturnType<ReportPreviewApi['versionPreview']>>) => void)
      | undefined
    const pendingPreview = new Promise<Awaited<ReturnType<ReportPreviewApi['versionPreview']>>>(
      (resolve) => {
        resolvePreview = resolve
      },
    )
    render(
      <>
        <button type="button">Existing focus target</button>
        <SimulationPreviewPageView
          api={api({
            versionPreview: vi
              .fn<ReportPreviewApi['versionPreview']>()
              .mockReturnValue(pendingPreview),
          })}
          csrfToken={csrfToken}
          request={{
            domain: 'pendulum',
            expectedVersionRevision: 3,
            input: { lengthM: 1, amplitudeDeg: 10 },
            sampleCount: 101,
          }}
          target={{ kind: 'version', versionId }}
        />
      </>,
    )
    const focusTarget = screen.getByRole('button', { name: 'Existing focus target' })
    focusTarget.focus()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Loading simulation preview' }),
    ).toBeVisible()
    expect(document.title).toBe('Loading simulation preview | SimProof')
    expect(focusTarget).toHaveFocus()

    resolvePreview?.({ ok: false, error: { kind: 'unavailable', id: 'fixture.unavailable' } })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Simulation preview unavailable' }),
    ).toBeVisible()
    expect(document.title).toBe('Simulation preview unavailable | SimProof')
    expect(focusTarget).toHaveFocus()
  })

  it('validates projectile bounds and submits exact parameters from the keyboard', async () => {
    let resolveRefresh:
      | ((result: Awaited<ReturnType<ReportPreviewApi['seedPreview']>>) => void)
      | undefined
    const refresh = new Promise<Awaited<ReturnType<ReportPreviewApi['seedPreview']>>>((resolve) => {
      resolveRefresh = resolve
    })
    const seedPreview = vi
      .fn<ReportPreviewApi['seedPreview']>()
      .mockResolvedValueOnce({ ok: true, value: projectilePreview() })
      .mockReturnValueOnce(refresh)
    const request: PreviewRequest = {
      domain: 'projectile',
      expectedVersionRevision: 8,
      input: { initialSpeedMps: 20, launchAngleDeg: 45 },
      sampleCount: 51,
    }
    render(
      <SimulationPreviewPageView
        api={api({ seedPreview })}
        csrfToken={csrfToken}
        request={request}
        target={{ kind: 'seed', seedId: 'projectile-motion' }}
      />,
    )

    const speed = await screen.findByRole('spinbutton', { name: 'Initial speed' })
    const angle = screen.getByRole('spinbutton', { name: 'Launch angle' })
    expect(speed).toHaveValue(20)
    expect(angle).toHaveValue(45)
    expect(speed).toHaveAttribute('step', '0.1')
    expect(angle).toHaveAttribute('step', '0.1')
    expect(speed).toHaveAccessibleDescription('Allowed 10 to 30 m/s.')
    expect(angle).toHaveAccessibleDescription('Allowed 15 to 75 deg.')

    fireEvent.change(speed, { target: { value: '31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply parameters' }))
    expect(screen.getByText('Enter a value from 10 to 30 m/s.')).toBeVisible()
    expect(speed).toHaveAttribute('aria-invalid', 'true')
    expect(speed).toHaveAccessibleDescription(
      'Allowed 10 to 30 m/s. Enter a value from 10 to 30 m/s.',
    )
    expect(seedPreview).toHaveBeenCalledOnce()

    fireEvent.change(speed, { target: { value: '25' } })
    speed.focus()
    fireEvent.keyDown(speed, { key: 'Enter' })
    await waitFor(() => expect(seedPreview).toHaveBeenCalledTimes(2))
    expect(seedPreview).toHaveBeenLastCalledWith(
      'projectile-motion',
      {
        domain: 'projectile',
        expectedVersionRevision: 8,
        input: { initialSpeedMps: 25, launchAngleDeg: 45 },
        sampleCount: 51,
      },
      csrfToken,
    )
    const table = screen.getByRole('table', { name: 'Projectile trajectory data' })
    expect(within(table).getByRole('cell', { name: '14' })).toBeVisible()
    expect(within(table).queryByRole('cell', { name: '7.123' })).not.toBeInTheDocument()

    resolveRefresh?.({ ok: true, value: projectilePreview(7.123, 25) })
    expect(await within(table).findByRole('cell', { name: '7.123' })).toBeVisible()
    expect(screen.getByText('Preview refreshed with server-validated samples.')).toHaveAttribute(
      'role',
      'status',
    )
    expect(document.activeElement).toBe(speed)
  })

  it('validates pendulum finite values and preserves valid inputs and samples on failure', async () => {
    const versionPreview = vi
      .fn<ReportPreviewApi['versionPreview']>()
      .mockResolvedValueOnce({ ok: true, value: pendulumPreview() })
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: 'unavailable', id: 'preview.runner-unavailable' },
      })
    const request: PreviewRequest = {
      domain: 'pendulum',
      expectedVersionRevision: 3,
      input: { lengthM: 1, amplitudeDeg: 10 },
      sampleCount: 101,
    }
    render(
      <SimulationPreviewPageView
        api={api({ versionPreview })}
        csrfToken={csrfToken}
        request={request}
        target={{ kind: 'version', versionId }}
      />,
    )

    const length = await screen.findByRole('spinbutton', { name: 'Pendulum length' })
    const amplitude = screen.getByRole('spinbutton', { name: 'Release amplitude' })
    expect(length).toHaveAccessibleDescription('Allowed 0.5 to 2 m.')
    expect(amplitude).toHaveAccessibleDescription('Allowed 1 to 15 deg.')
    expect(length).toHaveAttribute('step', '0.01')
    expect(amplitude).toHaveAttribute('step', '0.1')

    fireEvent.change(length, { target: { value: '' } })
    fireEvent.change(amplitude, { target: { value: '16' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply parameters' }))
    expect(screen.getByText('Enter a finite number.')).toBeVisible()
    expect(screen.getByText('Enter a value from 1 to 15 deg.')).toBeVisible()
    expect(versionPreview).toHaveBeenCalledOnce()

    fireEvent.change(length, { target: { value: '1.5' } })
    fireEvent.change(amplitude, { target: { value: '12' } })
    amplitude.focus()
    fireEvent.keyDown(amplitude, { key: 'Enter' })
    await waitFor(() => expect(versionPreview).toHaveBeenCalledTimes(2))
    expect(versionPreview).toHaveBeenLastCalledWith(
      versionId,
      {
        domain: 'pendulum',
        expectedVersionRevision: 3,
        input: { lengthM: 1.5, amplitudeDeg: 12 },
        sampleCount: 101,
      },
      csrfToken,
    )
    expect(await screen.findByText('Preview could not refresh')).toBeVisible()
    expect(
      screen.getByText('One full swing (the period) takes 2 seconds in the trusted model.'),
    ).toBeVisible()
    expect(length).toHaveValue(1.5)
    expect(amplitude).toHaveValue(12)
    expect(document.activeElement).toBe(amplitude)
  })
})
