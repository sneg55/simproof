import type {
  EducatorRuntimeConfig,
  LibraryPage,
  LibraryQuery,
  SeedMetadata,
} from '@simproof/contracts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { EducatorApi } from '@/api/educator-api'
import { LibraryPageView } from '@/library/library-page'

const runtime: EducatorRuntimeConfig = {
  runtime: {
    deploymentMode: 'loopback',
    providerConfigured: false,
    maxRequestBytes: 65_536,
    maxPromptCharacters: 16_384,
    promptRetentionDefault: 'discard',
    telemetryEnabled: false,
    externalDiagnosticsEnabled: false,
  },
  generation: { available: false, reason: 'provider-not-configured' },
  seedLibraryReady: true,
  supportedDomains: ['pendulum', 'projectile'],
}
const seed: SeedMetadata = {
  seedId: 'projectile-basics',
  bundledVersion: '1.0.0',
  contentHash: 'a'.repeat(64),
  domain: 'projectile',
  title: 'Projectile motion basics',
  description: 'Explore launch angle and initial speed.',
  contentLicense: 'CC-BY-4.0',
  attribution: 'SimProof contributors',
}
const library: LibraryPage = {
  items: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Teacher pendulum lab',
      source: { kind: 'teacher' },
      currentVersion: {
        id: '22222222-2222-4222-8222-222222222222',
        versionNumber: 1,
        state: 'verified',
        revision: 0,
        domain: 'pendulum',
        verification: {
          status: 'current',
          verdict: 'verified',
          verificationRunId: '33333333-3333-4333-8333-333333333333',
          artifactHash: 'b'.repeat(64),
          reportHash: 'c'.repeat(64),
        },
        updatedAt: '2026-07-16T12:00:00.000Z',
      },
      createdAt: '2026-07-16T12:00:00.000Z',
      updatedAt: '2026-07-16T12:00:00.000Z',
    },
  ],
  nextCursor: null,
}

function fakeApi(overrides: Partial<EducatorApi> = {}): EducatorApi {
  return {
    bootstrapCapability: vi.fn(),
    session: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    bootstrap: vi.fn(),
    runtimeConfig: vi.fn(() => Promise.resolve({ ok: true as const, value: runtime })),
    listSeeds: vi.fn(() => Promise.resolve({ ok: true as const, value: [seed] })),
    listSimulations: vi.fn(() => Promise.resolve({ ok: true as const, value: library })),
    simulationDetail: vi.fn(),
    seedDetail: vi.fn(),
    ...overrides,
  }
}

function renderLibrary(api: EducatorApi) {
  const router = createMemoryRouter([{ path: '/', element: <LibraryPageView api={api} /> }], {
    initialEntries: ['/'],
  })
  render(<RouterProvider router={router} />)
}

describe('educator seed library', () => {
  it('shows bounded archive and deletion destination notices', async () => {
    const { rerender } = render(
      <MemoryRouter>
        <LibraryPageView
          api={fakeApi()}
          notice={{ kind: 'library-operation', operation: 'archive', title: 'Pendulum lesson' }}
        />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Archived Pendulum lesson')).toBeVisible()
    rerender(
      <MemoryRouter>
        <LibraryPageView
          api={fakeApi()}
          notice={{ kind: 'library-operation', operation: 'delete', title: 'Pendulum lesson' }}
        />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Deleted Pendulum lesson')).toBeVisible()
  })

  it('shows loading before the credential-free seed flow and provider disclosure', async () => {
    let resolveLibrary: ((result: { ok: true; value: LibraryPage }) => void) | undefined
    const api = fakeApi({
      listSimulations: vi.fn(
        () =>
          new Promise<{ ok: true; value: LibraryPage }>((resolve) => {
            resolveLibrary = resolve
          }),
      ),
    })

    renderLibrary(api)
    expect(screen.getByRole('status')).toHaveTextContent('Loading simulation library')
    resolveLibrary?.({ ok: true, value: library })

    expect(await screen.findByRole('heading', { name: seed.title })).toBeInTheDocument()
    expect(screen.getByText('Generation is unavailable')).toBeInTheDocument()
    expect(screen.getByText(/bundled examples still work without model credentials/i)).toBeVisible()
    expect(screen.getByText('1 educator simulation shown.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument()
  })

  it('renders a helpful empty state and a recoverable API error', async () => {
    const { rerender } = render(
      <MemoryRouter>
        <LibraryPageView
          api={fakeApi({
            listSeeds: vi.fn(() => Promise.resolve({ ok: true as const, value: [] })),
            listSimulations: vi.fn(() =>
              Promise.resolve({ ok: true as const, value: { items: [], nextCursor: null } }),
            ),
          })}
        />
      </MemoryRouter>,
    )
    expect(await screen.findByText('No simulations match these filters')).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <LibraryPageView
          api={fakeApi({
            listSimulations: vi.fn(() =>
              Promise.resolve({
                ok: false as const,
                error: { kind: 'unavailable' as const, id: 'http.educator-unavailable' },
              }),
            ),
          })}
        />
      </MemoryRouter>,
    )
    expect(
      await screen.findByText('The simulation library could not be loaded'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('sends search, domain, and lifecycle filters to the real API port', async () => {
    const listSimulations = vi.fn((_query: LibraryQuery) =>
      Promise.resolve({ ok: true as const, value: library }),
    )
    renderLibrary(fakeApi({ listSimulations }))
    await screen.findByRole('heading', { name: seed.title })

    fireEvent.change(screen.getByRole('searchbox', { name: /Search simulations/ }), {
      target: { value: 'launch' },
    })
    fireEvent.click(screen.getByRole('combobox', { name: 'Domain' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Projectile' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Lifecycle state' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Verified' }))

    await waitFor(() =>
      expect(listSimulations).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: 'launch',
          domains: ['projectile'],
          states: ['verified'],
        }),
        expect.any(AbortSignal),
      ),
    )
  })

  it('appends cursor pages and clears an empty filtered result back to the base query', async () => {
    const first = library.items[0]
    if (first === undefined) throw new Error('library fixture is empty')
    const second: LibraryPage['items'][number] = {
      ...first,
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Second teacher lab',
      currentVersion: {
        ...first.currentVersion,
        id: '55555555-5555-4555-8555-555555555555',
      },
    }
    const listSimulations = vi.fn((query: LibraryQuery) => {
      if (query.search === 'missing') {
        return Promise.resolve({ ok: true as const, value: { items: [], nextCursor: null } })
      }
      if (query.cursor === 'page-two') {
        return Promise.resolve({ ok: true as const, value: { items: [second], nextCursor: null } })
      }
      return Promise.resolve({
        ok: true as const,
        value: { ...library, nextCursor: 'page-two' },
      })
    })
    renderLibrary(fakeApi({ listSimulations }))

    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Load more simulations' }))
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(screen.getByRole('heading', { name: first.title })).toBeVisible()
    expect(listSimulations).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'page-two' }),
      expect.any(AbortSignal),
    )

    fireEvent.change(screen.getByRole('searchbox', { name: /Search simulations/ }), {
      target: { value: 'missing' },
    })
    expect(await screen.findByText('No simulations match these filters')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    expect(screen.getByRole('searchbox', { name: /Search simulations/ })).toHaveValue('')
    expect(listSimulations).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: '', domains: [], states: [], sources: [] }),
      expect.any(AbortSignal),
    )
  })
})
