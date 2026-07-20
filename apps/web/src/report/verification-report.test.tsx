import type { SimulationDetail, VerificationReportDisplay } from '@simproof/contracts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReportPreviewApi } from '@/api/report-preview-api'
import { VerificationReportPageView } from '@/report/report-page'
import { VerificationReportPanel } from '@/report/verification-report'

const versionId = '123e4567-e89b-42d3-a456-426614174000'
const reportId = '223e4567-e89b-42d3-a456-426614174000'
const verificationRunId = '323e4567-e89b-42d3-a456-426614174000'
const hashA = `sha256:${'a'.repeat(64)}`
const hashB = `sha256:${'b'.repeat(64)}`
const hashC = `sha256:${'c'.repeat(64)}`
const simulationId = '423e4567-e89b-42d3-a456-426614174000'

function display(overrides: Partial<VerificationReportDisplay> = {}): VerificationReportDisplay {
  const assumptions = ['Uniform gravity acts downward.']
  const limitations = ['Small-angle approximation only.']
  return {
    simulationVersionId: versionId,
    verificationRunId,
    reportArtifactHash: hashC,
    versionRevision: 4,
    conceptSpec: {
      schemaVersion: '1',
      domain: 'pendulum',
      title: 'Pendulum period explorer',
      parameters: {
        length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
        amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 1, max: 15 } },
      },
      requestedControls: ['length', 'amplitude'],
    },
    report: {
      schemaVersion: '1',
      reportId,
      createdAt: '2026-07-16T12:00:00.000Z',
      conceptSpecHash: hashA,
      artifact: { hash: hashB },
      policy: { id: 'pendulum.small-angle', version: '1.0.0', contentHash: hashA },
      domainPack: { id: 'pendulum', version: '1.0.0', contentHash: hashB },
      runner: { version: '1.2.0', protocolVersion: '1' },
      observationHash: hashA,
      verdict: 'verified',
      checks: [{ id: 'pendulum.period', outcome: 'passed', sampleCount: 3 }],
      findings: [],
      testedScope: {
        parameters: [
          { parameter: 'lengthM', unit: 'm', min: 0.5, max: 2, sampledValues: [0.5, 1, 2] },
          { parameter: 'amplitudeDeg', unit: 'deg', min: 1, max: 15 },
        ],
        sampleCount: 3,
        samplingGridHash: hashB,
      },
      assumptions,
      limitations,
    },
    validity: { status: 'current' },
    policy: {
      schemaVersion: '1',
      id: 'pendulum.small-angle',
      version: '1.0.0',
      domain: 'pendulum',
      checks: ['pendulum.period'],
      applicability: {
        lengthM: { min: 0.5, max: 2 },
        amplitudeDeg: { minExclusive: 0, max: 15 },
        gravityMps2: 9.81,
        model: 'small-angle',
      },
      sampling: { cases: [{ lengthM: 0.5, amplitudeDeg: 5 }] },
      tolerances: { periodS: { mode: 'relative', relative: 0.01 } },
      assumptions,
      limitations,
    },
    publication: { published: false },
    badgeActive: true,
    publishable: true,
    ...overrides,
  }
}

describe('verification report', () => {
  it('keeps loading and unavailable report states titled, headed, and non-disruptive to focus', async () => {
    let resolveReport:
      | ((result: Awaited<ReturnType<ReportPreviewApi['versionReport']>>) => void)
      | undefined
    const pendingReport = new Promise<Awaited<ReturnType<ReportPreviewApi['versionReport']>>>(
      (resolve) => {
        resolveReport = resolve
      },
    )
    const currentApi = {
      versionReport: vi.fn<ReportPreviewApi['versionReport']>().mockReturnValue(pendingReport),
      publishVersion: vi.fn(),
      seedReport: vi.fn(),
      versionPreview: vi.fn(),
      seedPreview: vi.fn(),
      reverifyVersion: vi.fn(),
    } as ReportPreviewApi
    render(
      <>
        <button type="button">Existing focus target</button>
        <VerificationReportPageView
          api={currentApi}
          csrfToken={'c'.repeat(43)}
          target={{ kind: 'version', versionId }}
        />
      </>,
    )
    const focusTarget = screen.getByRole('button', { name: 'Existing focus target' })
    focusTarget.focus()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Loading verification report' }),
    ).toBeVisible()
    expect(document.title).toBe('Loading verification report | SimProof')
    expect(focusTarget).toHaveFocus()

    resolveReport?.({ ok: false, error: { kind: 'unavailable', id: 'fixture.unavailable' } })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Verification report unavailable' }),
    ).toBeVisible()
    expect(document.title).toBe('Verification report unavailable | SimProof')
    expect(focusTarget).toHaveFocus()
  })

  it('shows complete current evidence and requires an explicit license before publish', () => {
    const onPublish = vi.fn()
    const current = display()
    render(<VerificationReportPanel report={current} onPublish={onPublish} onReverify={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Verified for the tested scope' })).toBeVisible()
    expect(screen.getByText('Active verification')).toBeVisible()
    expect(screen.getByText('pendulum.small-angle')).toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
    expect(screen.getAllByText(hashA).length).toBeGreaterThan(0)
    expect(screen.getByRole('cell', { name: 'Length' })).toBeVisible()
    expect(screen.getByRole('cell', { name: '0.5 to 2' })).toBeVisible()
    expect(screen.getByRole('cell', { name: 'm' })).toBeVisible()
    expect(screen.getByText('Relative: 1%')).toBeVisible()
    expect(screen.getByText('Uniform gravity acts downward.')).toBeVisible()
    expect(screen.getByText('Small-angle approximation only.')).toBeVisible()
    expect(screen.getAllByText(hashB).length).toBeGreaterThan(0)
    expect(screen.getByText(verificationRunId)).toBeInTheDocument()
    expect(screen.getByText(reportId)).toBeInTheDocument()
    expect(screen.getByText(hashC)).toBeInTheDocument()
    expect(screen.getAllByText(current.report.conceptSpecHash).length).toBeGreaterThan(0)
    expect(screen.getAllByText(current.report.observationHash).length).toBeGreaterThan(0)
    const checks = screen.getByRole('table', { name: 'Verification checks' })
    expect(within(checks).getByRole('cell', { name: 'pendulum.period' })).toBeVisible()
    expect(within(checks).getByRole('cell', { name: 'passed' })).toBeVisible()
    expect(within(checks).getByRole('cell', { name: '3' })).toBeVisible()
    for (const table of screen.getAllByRole('table')) {
      expect(table.querySelector('caption')).not.toBeNull()
    }

    const publish = screen.getByRole('button', { name: 'Publish verified version' })
    expect(publish).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Creative Commons Attribution 4.0' }))
    expect(publish).toBeEnabled()
    fireEvent.click(publish)
    expect(onPublish).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(versionId)).toBeVisible()
    expect(within(dialog).getByText('Revision 4')).toBeVisible()
    expect(within(dialog).getByText(verificationRunId)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm exact version publication' }))
    expect(onPublish).toHaveBeenCalledWith({ kind: 'spdx', id: 'CC-BY-4.0' })
  })

  it('explains stale evidence, removes the active badge, and cannot publish', () => {
    const onReverify = vi.fn()
    render(
      <VerificationReportPanel
        report={display({
          validity: { status: 'stale', reasons: ['policy-changed', 'runner-changed'] },
          badgeActive: false,
          publishable: false,
        })}
        onPublish={vi.fn()}
        onReverify={onReverify}
      />,
    )

    expect(screen.queryByText('Active verification')).not.toBeInTheDocument()
    expect(screen.getByText('Evidence is stale')).toBeVisible()
    expect(screen.getByText('Verification policy changed')).toBeVisible()
    expect(screen.getByText('Runner changed')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Publish verified version' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run verification again' }))
    expect(onReverify).toHaveBeenCalledOnce()
  })

  it('shows rejection findings with quantity, values, units, tolerance, and explanation', () => {
    const rejected = display({
      badgeActive: false,
      publishable: false,
      report: {
        ...display().report,
        verdict: 'rejected',
        checks: [{ id: 'pendulum.period', outcome: 'failed', sampleCount: 3 }],
        findings: [
          {
            id: 'pendulum.period.mismatch',
            category: 'mismatch',
            severity: 'error',
            checkId: 'pendulum.period',
            quantity: 'periodS',
            inputs: { lengthM: { value: 1, unit: 'm' } },
            expected: { value: 2.006, unit: 's' },
            actual: { value: 3, unit: 's' },
            tolerance: { mode: 'relative', relative: 0.01 },
            error: { mode: 'absolute', value: 0.994, unit: 's' },
            explanation: 'The simulated period exceeds the trusted small-angle result.',
          },
        ],
      },
    })
    render(<VerificationReportPanel report={rejected} onPublish={vi.fn()} onReverify={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Rejected by scientific checks' })).toBeVisible()
    expect(screen.getByText('periodS')).toBeVisible()
    expect(screen.getByText('2.006 s')).toBeVisible()
    expect(screen.getByText('3 s')).toBeVisible()
    expect(screen.getByText('Inputs: lengthM: 1 m')).toBeVisible()
    expect(screen.getAllByText('Relative: 1%').length).toBeGreaterThan(0)
    expect(
      screen.getByText('The simulated period exceeds the trusted small-angle result.'),
    ).toBeVisible()
  })

  it('publishes against the exact run and revision and refreshes after a server conflict', async () => {
    const current = display()
    const changed = display({
      versionRevision: 5,
      validity: { status: 'stale', reasons: ['artifact-changed'] },
      badgeActive: false,
      publishable: false,
    })
    const publishVersion = vi.fn<ReportPreviewApi['publishVersion']>().mockResolvedValue({
      ok: false,
      error: { kind: 'conflict', id: 'educator.version-conflict' },
    })
    const versionReport = vi
      .fn<ReportPreviewApi['versionReport']>()
      .mockResolvedValueOnce({ ok: true, value: current })
      .mockResolvedValueOnce({ ok: true, value: changed })
    const api = {
      versionReport,
      publishVersion,
      seedReport: vi.fn(),
      versionPreview: vi.fn(),
      seedPreview: vi.fn(),
      reverifyVersion: vi.fn(),
    } as ReportPreviewApi

    render(
      <VerificationReportPageView
        api={api}
        csrfToken={'c'.repeat(43)}
        target={{ kind: 'version', versionId }}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'No export license' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish verified version' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm exact version publication' }))

    await waitFor(() =>
      expect(publishVersion).toHaveBeenCalledWith(
        versionId,
        {
          expectedRevision: 4,
          verificationRunId,
          exportLicense: { kind: 'none' },
        },
        'c'.repeat(43),
      ),
    )
    expect(await screen.findByText('The version changed')).toBeVisible()
    expect(screen.getByText('Evidence is stale')).toBeVisible()
    expect(versionReport).toHaveBeenCalledTimes(2)
  })

  it('hands successful publication to the simulation destination without refreshing the report', async () => {
    const current = display()
    const published = publishedDetail()
    const onPublished = vi.fn()
    const publishVersion = vi
      .fn<ReportPreviewApi['publishVersion']>()
      .mockResolvedValue({ ok: true, value: published })
    const versionReport = vi
      .fn<ReportPreviewApi['versionReport']>()
      .mockResolvedValue({ ok: true, value: current })
    const api = {
      versionReport,
      publishVersion,
      seedReport: vi.fn(),
      versionPreview: vi.fn(),
      seedPreview: vi.fn(),
      reverifyVersion: vi.fn(),
    } as ReportPreviewApi

    render(
      <VerificationReportPageView
        api={api}
        csrfToken={'c'.repeat(43)}
        target={{ kind: 'version', versionId }}
        onPublished={onPublished}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'No export license' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish verified version' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm exact version publication' }))

    await waitFor(() =>
      expect(onPublished).toHaveBeenCalledWith({ simulationId, versionNumber: 1 }),
    )
    expect(versionReport).toHaveBeenCalledOnce()
  })

  it('loads bundled seed reports through the seed endpoint without mutation controls', async () => {
    const seedReport = vi.fn<ReportPreviewApi['seedReport']>().mockResolvedValue({
      ok: true,
      value: display({ publishable: false }),
    })
    const versionReport = vi.fn<ReportPreviewApi['versionReport']>()
    const publishVersion = vi.fn<ReportPreviewApi['publishVersion']>()
    const reverifyVersion = vi.fn<ReportPreviewApi['reverifyVersion']>()
    const api = {
      seedReport,
      versionReport,
      publishVersion,
      reverifyVersion,
      versionPreview: vi.fn(),
      seedPreview: vi.fn(),
    } as ReportPreviewApi

    render(
      <VerificationReportPageView
        api={api}
        csrfToken={'c'.repeat(43)}
        target={{ kind: 'seed', seedId: 'pendulum-period' }}
      />,
    )

    expect(await screen.findByText('Bundled reference evidence')).toBeVisible()
    expect(
      screen.getByText(
        'This installed example is read-only. Create a separate educator simulation to make editable versions.',
      ),
    ).toBeVisible()
    expect(seedReport).toHaveBeenCalledWith('pendulum-period', expect.any(AbortSignal))
    expect(versionReport).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: 'Publish verified version' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run verification again' })).not.toBeInTheDocument()
    expect(publishVersion).not.toHaveBeenCalled()
    expect(reverifyVersion).not.toHaveBeenCalled()
  })
})

function publishedDetail(): SimulationDetail {
  const summary: SimulationDetail['selectedVersion']['summary'] = {
    id: versionId,
    versionNumber: 1,
    state: 'published',
    revision: 5,
    domain: 'pendulum',
    verification: {
      status: 'current',
      verificationRunId,
      verdict: 'verified',
      artifactHash: hashB,
      reportHash: hashC,
    },
    updatedAt: '2026-07-16T12:00:00.000Z',
  }
  return {
    simulation: {
      id: simulationId,
      title: 'Published lesson',
      source: { kind: 'teacher' },
      currentVersion: summary,
      createdAt: '2026-07-16T12:00:00.000Z',
      updatedAt: '2026-07-16T12:00:00.000Z',
    },
    selectedVersion: {
      summary,
      conceptSpec: display().conceptSpec,
      exportLicense: { kind: 'none' },
      generationProvenance: null,
      lineage: null,
      availableActions: ['preview', 'view-report', 'export'],
      createdAt: '2026-07-16T12:00:00.000Z',
    },
  }
}
