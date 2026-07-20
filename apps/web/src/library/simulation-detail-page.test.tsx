import type { EducatorRuntimeConfig, SimulationDetail } from '@simproof/contracts'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { EducatorApi } from '@/api/educator-api'

import { SimulationDetailPageView } from '@/library/simulation-detail-page'

const detail: SimulationDetail = {
  simulation: {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Teacher pendulum lab',
    source: { kind: 'teacher' },
    currentVersion: {
      id: '22222222-2222-4222-8222-222222222222',
      versionNumber: 1,
      state: 'draft',
      revision: 0,
      domain: 'pendulum',
      verification: { status: 'none' },
      updatedAt: '2026-07-16T12:00:00.000Z',
    },
    createdAt: '2026-07-16T12:00:00.000Z',
    updatedAt: '2026-07-16T12:00:00.000Z',
  },
  selectedVersion: {
    summary: {
      id: '22222222-2222-4222-8222-222222222222',
      versionNumber: 1,
      state: 'draft',
      revision: 0,
      domain: 'pendulum',
      verification: { status: 'none' },
      updatedAt: '2026-07-16T12:00:00.000Z',
    },
    conceptSpec: null,
    exportLicense: null,
    generationProvenance: null,
    lineage: null,
    availableActions: ['start-generation'],
    createdAt: '2026-07-16T12:00:00.000Z',
  },
}

const runtime: EducatorRuntimeConfig = {
  runtime: {
    deploymentMode: 'loopback',
    providerConfigured: true,
    maxRequestBytes: 65_536,
    maxPromptCharacters: 16_384,
    promptRetentionDefault: 'discard',
    telemetryEnabled: false,
    externalDiagnosticsEnabled: false,
  },
  generation: { available: true },
  seedLibraryReady: true,
  supportedDomains: ['pendulum', 'projectile'],
}

function api(overrides: Partial<EducatorApi> = {}): EducatorApi {
  return {
    bootstrapCapability: vi.fn(),
    session: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    bootstrap: vi.fn(),
    runtimeConfig: vi.fn(() => Promise.resolve({ ok: true as const, value: runtime })),
    listSeeds: vi.fn(),
    listSimulations: vi.fn(),
    simulationDetail: vi.fn(() => Promise.resolve({ ok: true as const, value: detail })),
    seedDetail: vi.fn(),
    ...overrides,
  }
}

describe('simulation detail', () => {
  it('keeps loading and unavailable detail states titled, headed, and non-disruptive to focus', async () => {
    let resolveDetail:
      | ((result: Awaited<ReturnType<EducatorApi['simulationDetail']>>) => void)
      | undefined
    const pendingDetail = new Promise<Awaited<ReturnType<EducatorApi['simulationDetail']>>>(
      (resolve) => {
        resolveDetail = resolve
      },
    )
    const currentApi = api()
    render(
      <MemoryRouter>
        <button type="button">Existing focus target</button>
        <SimulationDetailPageView
          api={{
            ...currentApi,
            simulationDetail: vi
              .fn<EducatorApi['simulationDetail']>()
              .mockReturnValue(pendingDetail),
          }}
          simulationId={detail.simulation.id}
        />
      </MemoryRouter>,
    )
    const focusTarget = screen.getByRole('button', { name: 'Existing focus target' })
    focusTarget.focus()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Loading simulation detail' }),
    ).toBeVisible()
    expect(document.title).toBe('Loading simulation detail | SimProof')
    expect(focusTarget).toHaveFocus()

    resolveDetail?.({ ok: false, error: { kind: 'unavailable', id: 'fixture.unavailable' } })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Simulation unavailable' }),
    ).toBeVisible()
    expect(document.title).toBe('Simulation unavailable | SimProof')
    expect(focusTarget).toHaveFocus()
  })

  it('opens a selected simulation with version and lifecycle context', async () => {
    render(
      <MemoryRouter>
        <SimulationDetailPageView api={api()} simulationId={detail.simulation.id} />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: detail.simulation.title }),
    ).toBeInTheDocument()
    expect(screen.getByText('Version 1')).toBeInTheDocument()
    expect(screen.getByText('Domain: pendulum')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to library' })).toHaveAttribute('href', '/')
    expect(document.title).toBe('Teacher pendulum lab | SimProof')
  })

  it('replaces the generation link with configuration guidance when unavailable', async () => {
    render(
      <MemoryRouter>
        <SimulationDetailPageView
          api={api({
            runtimeConfig: vi.fn(() =>
              Promise.resolve({
                ok: true as const,
                value: {
                  ...runtime,
                  runtime: { ...runtime.runtime, providerConfigured: false },
                  generation: {
                    available: false as const,
                    reason: 'provider-not-configured' as const,
                  },
                },
              }),
            ),
          })}
          simulationId={detail.simulation.id}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: 'Generation unavailable' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Generate this draft' })).toBeNull()
    expect(screen.getByText(/provider credentials are not configured/i)).toBeVisible()
  })

  it('announces a bounded publication success and focuses the simulation heading', async () => {
    render(
      <MemoryRouter>
        <SimulationDetailPageView
          api={api()}
          simulationId={detail.simulation.id}
          publicationNotice={{ kind: 'publication-success', versionNumber: 1 }}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Version 1 is published')).toBeVisible()
    const heading = screen.getByRole('heading', { name: detail.simulation.title })
    await waitFor(() => expect(heading).toHaveFocus())
  })

  it('surfaces a publish path from the hub when the version is publishable', async () => {
    const publishable: SimulationDetail = {
      ...detail,
      selectedVersion: {
        ...detail.selectedVersion,
        availableActions: ['preview', 'view-report', 'publish', 'export'],
      },
    }
    render(
      <MemoryRouter>
        <SimulationDetailPageView
          api={api({
            simulationDetail: vi.fn(() =>
              Promise.resolve({ ok: true as const, value: publishable }),
            ),
          })}
          simulationId={detail.simulation.id}
        />
      </MemoryRouter>,
    )

    const versionId = detail.selectedVersion.summary.id
    expect(await screen.findByRole('link', { name: 'Review and publish' })).toHaveAttribute(
      'href',
      `/versions/${versionId}/report`,
    )
    // Publish already routes to the report, so the duplicate report link is dropped.
    expect(screen.queryByRole('link', { name: 'View verification report' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Open accessible preview' })).toHaveAttribute(
      'href',
      `/simulations/${detail.simulation.id}/preview`,
    )
  })
})
