import type { EducatorSession } from '@simproof/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EducatorApi } from '@/api/educator-api'
import { SESSION_EXPIRED_EVENT } from '@/api/http-client'
import { DocumentTitle } from '@/app/document-title'

import { SessionBoundary } from '@/auth/session-boundary'

const session: EducatorSession = {
  authenticated: true,
  expiresAt: '2026-07-17T12:00:00.000Z',
  csrfToken: 'c'.repeat(43),
}

function fakeApi(overrides: Partial<EducatorApi>): EducatorApi {
  return {
    bootstrapCapability: vi.fn(() =>
      Promise.resolve({ ok: true as const, value: { bootstrapAvailable: false } }),
    ),
    session: vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: { kind: 'authentication' as const, id: 'http.session-required' },
      }),
    ),
    login: vi.fn(),
    logout: vi.fn(),
    bootstrap: vi.fn(),
    runtimeConfig: vi.fn(),
    listSeeds: vi.fn(),
    listSimulations: vi.fn(),
    simulationDetail: vi.fn(),
    seedDetail: vi.fn(),
    ...overrides,
  }
}

describe('session boundary', () => {
  it('titles and heads session restoration and persistent startup failure states', async () => {
    let resolveCapability:
      | ((result: Awaited<ReturnType<EducatorApi['bootstrapCapability']>>) => void)
      | undefined
    const pendingCapability = new Promise<Awaited<ReturnType<EducatorApi['bootstrapCapability']>>>(
      (resolve) => {
        resolveCapability = resolve
      },
    )
    render(
      <SessionBoundary
        api={fakeApi({
          bootstrapCapability: vi
            .fn<EducatorApi['bootstrapCapability']>()
            .mockReturnValue(pendingCapability),
        })}
      >
        <p>Authenticated workspace</p>
      </SessionBoundary>,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: 'Restoring your educator session' }),
    ).toBeVisible()
    expect(document.title).toBe('Restoring educator session | SimProof')

    resolveCapability?.({
      ok: false,
      error: { kind: 'unavailable', id: 'fixture.startup-unavailable' },
    })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'SimProof could not start' }),
    ).toBeVisible()
    expect(document.title).toBe('SimProof could not start | SimProof')
  })

  it('sets a descriptive title while signed out', async () => {
    render(
      <SessionBoundary api={fakeApi({})}>
        <p>Authenticated workspace</p>
      </SessionBoundary>,
    )

    expect(await screen.findByLabelText('Administrator password')).toBeInTheDocument()
    expect(document.title).toBe('Sign in | SimProof')
  })

  it('recovers an existing session without showing a password field', async () => {
    render(
      <SessionBoundary
        api={fakeApi({
          session: vi.fn(() => Promise.resolve({ ok: true as const, value: session })),
        })}
      >
        <p>Authenticated workspace</p>
      </SessionBoundary>,
    )

    expect(await screen.findByText('Authenticated workspace')).toBeInTheDocument()
    expect(screen.queryByLabelText('Administrator password')).not.toBeInTheDocument()
  })

  it('returns every route to sign-in when the shared client reports session expiry', async () => {
    render(
      <SessionBoundary
        api={fakeApi({
          session: vi.fn(() => Promise.resolve({ ok: true as const, value: session })),
        })}
      >
        <p>Authenticated detail route</p>
      </SessionBoundary>,
    )
    expect(await screen.findByText('Authenticated detail route')).toBeInTheDocument()

    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))

    expect(await screen.findByLabelText('Administrator password')).toBeInTheDocument()
    expect(document.title).toBe('Sign in | SimProof')
  })

  it('signs in after an expired session and keeps provider credentials out of onboarding', async () => {
    const login = vi.fn(() => Promise.resolve({ ok: true as const, value: session }))
    render(
      <SessionBoundary api={fakeApi({ login })}>
        <DocumentTitle value="Simulation library | SimProof" />
        <p>Authenticated workspace</p>
      </SessionBoundary>,
    )

    const password = await screen.findByLabelText('Administrator password')
    fireEvent.change(password, { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Authenticated workspace')).toBeInTheDocument()
    expect(document.title).toBe('Simulation library | SimProof')
    expect(login).toHaveBeenCalledWith('correct horse battery staple')
    expect(screen.queryByLabelText(/provider|api key/i)).not.toBeInTheDocument()
  })

  it('clears a denied password and moves focus to the error summary', async () => {
    render(
      <SessionBoundary
        api={fakeApi({
          login: vi.fn(() =>
            Promise.resolve({
              ok: false as const,
              error: { kind: 'authentication' as const, id: 'http.login-denied' },
            }),
          ),
        })}
      >
        <p>Authenticated workspace</p>
      </SessionBoundary>,
    )

    const password = await screen.findByLabelText('Administrator password')
    fireEvent.change(password, { target: { value: 'not the password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(password).toHaveValue('')
    expect(alert).toHaveFocus()
  })

  it('offers first-run administrator bootstrap and announces a denied attempt', async () => {
    const bootstrap = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { kind: 'permission' as const, id: 'denied' } }),
    )
    render(
      <SessionBoundary
        api={fakeApi({
          bootstrapCapability: vi.fn(() =>
            Promise.resolve({ ok: true as const, value: { bootstrapAvailable: true } }),
          ),
          bootstrap,
        })}
      >
        <p>Authenticated workspace</p>
      </SessionBoundary>,
    )

    const bootstrapSecret = await screen.findByLabelText('Bootstrap secret')
    expect(document.title).toBe('Set up administrator | SimProof')

    fireEvent.change(bootstrapSecret, {
      target: { value: 'b'.repeat(32) },
    })
    fireEvent.change(screen.getByLabelText('New administrator password'), {
      target: { value: 'correct horse battery staple' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create administrator' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be created')
    expect(screen.getByLabelText('Bootstrap secret')).toHaveValue('')
    expect(screen.getByLabelText('New administrator password')).toHaveValue('')
    expect(screen.getByRole('alert')).toHaveFocus()
  })
})
