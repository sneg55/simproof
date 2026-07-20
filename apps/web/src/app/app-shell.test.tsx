import type { EducatorSession } from '@simproof/contracts'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { EducatorApi } from '@/api/educator-api'
import { AppShell } from '@/app/app-shell'
import { DocumentTitle } from '@/app/document-title'
import { RouteErrorPage } from '@/app/route-error'
import { SessionProvider } from '@/auth/session-context'

const session: EducatorSession = {
  authenticated: true,
  csrfToken: 'c'.repeat(43),
  expiresAt: '2026-07-18T12:00:00.000Z',
}
const logout = vi.fn<EducatorApi['logout']>().mockResolvedValue({ ok: true, value: true as const })
const expireSession = vi.fn()
const api = { logout } as unknown as EducatorApi

function AuthenticatedShell() {
  return (
    <SessionProvider value={{ api, expireSession, session }}>
      <AppShell />
    </SessionProvider>
  )
}

function LocalBypassShell() {
  return (
    <SessionProvider
      value={{
        api,
        expireSession,
        session: { ...session, authenticationMode: 'local-bypass' },
      }}
    >
      <AppShell />
    </SessionProvider>
  )
}

describe('educator application scaffold', () => {
  it('provides a named application shell with skip navigation and one page heading', () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <AuthenticatedShell />,
          children: [
            {
              index: true,
              element: (
                <>
                  <DocumentTitle value="Simulation library | SimProof" />
                  <h1>Simulation library</h1>
                </>
              ),
            },
          ],
        },
      ],
      { initialEntries: ['/'] },
    )

    render(<RouterProvider router={router} />)

    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    )
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Simulation library' }),
    ).toBeInTheDocument()
    expect(document.title).toBe('Simulation library | SimProof')
  })

  it('revokes the authenticated session from the global header', async () => {
    logout.mockClear()
    expireSession.mockClear()
    const router = createMemoryRouter([
      {
        path: '/',
        element: <AuthenticatedShell />,
        children: [{ index: true, element: <h1>Simulation library</h1> }],
      },
    ])
    render(<RouterProvider router={router} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(logout).toHaveBeenCalledWith(session.csrfToken))
    expect(expireSession).toHaveBeenCalledOnce()
  })

  it('identifies local test access without offering a meaningless sign-out action', () => {
    const router = createMemoryRouter([
      {
        path: '/',
        element: <LocalBypassShell />,
        children: [{ index: true, element: <h1>Simulation library</h1> }],
      },
    ])
    render(<RouterProvider router={router} />)

    expect(screen.getByText('Local test access')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('renders a safe route error with a recovery action', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <p>Unreachable route</p>,
          hydrateFallbackElement: <p>Loading route</p>,
          loader: () => {
            throw new TypeError('Synthetic route failure')
          },
          errorElement: <RouteErrorPage />,
        },
      ],
      { initialEntries: ['/'] },
    )

    render(<RouterProvider router={router} />)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'This page could not be opened' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('kept your saved work unchanged')
    expect(screen.getByRole('navigation', { name: 'Recovery' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Return to simulation library' })).toHaveAttribute(
      'href',
      '/',
    )
    expect(document.title).toBe('Page unavailable | SimProof')
  })

  it('focuses the destination heading after client-side path navigation', async () => {
    const router = createMemoryRouter([
      {
        path: '/',
        element: <AuthenticatedShell />,
        children: [
          {
            index: true,
            element: (
              <>
                <DocumentTitle value="Library | SimProof" />
                <h1>Library</h1>
                <Link to="/detail">Open detail</Link>
              </>
            ),
          },
          {
            path: 'detail',
            element: (
              <>
                <DocumentTitle value="Simulation detail | SimProof" />
                <h1>Simulation detail</h1>
              </>
            ),
          },
        ],
      },
    ])
    render(<RouterProvider router={router} />)

    fireEvent.click(screen.getByRole('link', { name: 'Open detail' }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Simulation detail' })).toHaveFocus(),
    )
    expect(document.title).toBe('Simulation detail | SimProof')
  })

  it('follows a shell-focused heading through preview loading stages to the ready heading', async () => {
    let advancePreview: () => void = () => undefined
    function PreviewStages() {
      const [stage, setStage] = useState(0)
      useEffect(() => {
        advancePreview = () => setStage((current) => Math.min(current + 1, 2))
        return () => {
          advancePreview = () => undefined
        }
      }, [])
      const heading =
        stage === 0
          ? 'Loading preview configuration'
          : stage === 1
            ? 'Loading simulation preview'
            : 'Projectile trajectory'
      return <h1 key={heading}>{heading}</h1>
    }
    const router = createMemoryRouter([
      {
        path: '/',
        element: <AuthenticatedShell />,
        children: [
          {
            index: true,
            element: (
              <>
                <h1>Library</h1>
                <Link to="/preview">Open preview</Link>
              </>
            ),
          },
          { path: 'preview', element: <PreviewStages /> },
        ],
      },
    ])
    render(<RouterProvider router={router} />)

    fireEvent.click(screen.getByRole('link', { name: 'Open preview' }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Loading preview configuration' })).toHaveFocus(),
    )

    act(() => advancePreview())
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Loading simulation preview' })).toHaveFocus(),
    )

    act(() => advancePreview())
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Projectile trajectory' })).toHaveFocus(),
    )
  })

  it('does not steal focus when the user selects a connected control during route loading', async () => {
    let finishLoading: () => void = () => undefined
    function LoadingRoute() {
      const [ready, setReady] = useState(false)
      useEffect(() => {
        finishLoading = () => setReady(true)
        return () => {
          finishLoading = () => undefined
        }
      }, [])
      return (
        <>
          <button type="button">Keep my focus</button>
          <h1 key={ready ? 'ready' : 'loading'}>
            {ready ? 'Simulation ready' : 'Loading simulation'}
          </h1>
        </>
      )
    }
    const router = createMemoryRouter([
      {
        path: '/',
        element: <AuthenticatedShell />,
        children: [
          {
            index: true,
            element: (
              <>
                <h1>Library</h1>
                <Link to="/loading">Open simulation</Link>
              </>
            ),
          },
          { path: 'loading', element: <LoadingRoute /> },
        ],
      },
    ])
    render(<RouterProvider router={router} />)

    fireEvent.click(screen.getByRole('link', { name: 'Open simulation' }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Loading simulation' })).toHaveFocus(),
    )
    const control = screen.getByRole('button', { name: 'Keep my focus' })
    control.focus()

    act(() => finishLoading())
    expect(await screen.findByRole('heading', { name: 'Simulation ready' })).toBeVisible()
    expect(control).toHaveFocus()
  })
})
