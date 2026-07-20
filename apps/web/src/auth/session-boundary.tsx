import type { EducatorSession } from '@simproof/contracts'
import { type ReactNode, useCallback, useEffect, useState } from 'react'

import type { EducatorApi } from '@/api/educator-api'
import { browserEducatorApi } from '@/api/educator-api'
import { SESSION_EXPIRED_EVENT } from '@/api/http-client'
import { PageStateHeading } from '@/app/page-state-heading'
import { AuthScreen } from '@/auth/auth-screen'
import { SessionProvider } from '@/auth/session-context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

type BoundaryState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'signed-out'; readonly bootstrapAvailable: boolean }
  | { readonly status: 'authenticated'; readonly session: EducatorSession }

export function SessionBoundary({
  api = browserEducatorApi,
  children,
}: {
  readonly api?: EducatorApi
  readonly children: ReactNode
}) {
  const [state, setState] = useState<BoundaryState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      api.bootstrapCapability(controller.signal),
      api.session(controller.signal),
    ]).then(([capability, session]) => {
      if (controller.signal.aborted) return
      if (!capability.ok) {
        setState({ status: 'error' })
      } else if (session.ok) {
        setState({ status: 'authenticated', session: session.value })
      } else if (session.error.kind === 'authentication') {
        setState({ status: 'signed-out', bootstrapAvailable: capability.value.bootstrapAvailable })
      } else {
        setState({ status: 'error' })
      }
    })
    return () => controller.abort()
  }, [api, reloadKey])

  const expireSession = useCallback(() => {
    setState({ status: 'signed-out', bootstrapAvailable: false })
  }, [])

  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, expireSession)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expireSession)
  }, [expireSession])

  if (state.status === 'loading') return <SessionLoading />
  if (state.status === 'error') {
    return (
      <main className="mx-auto grid min-h-svh max-w-prose place-content-center gap-4 px-page py-section">
        <PageStateHeading documentTitle="SimProof could not start">
          SimProof could not start
        </PageStateHeading>
        <Alert variant="destructive">
          <AlertTitle>SimProof could not start</AlertTitle>
          <AlertDescription>
            The local service did not return a valid session response.
          </AlertDescription>
        </Alert>
        <Button onClick={() => setReloadKey((key) => key + 1)}>Try again</Button>
      </main>
    )
  }
  if (state.status === 'signed-out') {
    return (
      <AuthScreen
        api={api}
        bootstrapAvailable={state.bootstrapAvailable}
        onAuthenticated={(session) => setState({ status: 'authenticated', session })}
        onBootstrapCompleted={() => setState({ status: 'signed-out', bootstrapAvailable: false })}
      />
    )
  }
  return (
    <SessionProvider value={{ api, session: state.session, expireSession }}>
      {children}
    </SessionProvider>
  )
}

function SessionLoading() {
  return (
    <main className="mx-auto grid min-h-svh max-w-prose place-content-center gap-3 px-page py-section">
      <PageStateHeading documentTitle="Restoring educator session">
        Restoring your educator session
      </PageStateHeading>
      <p className="text-muted-foreground" role="status">
        Restoring your educator session…
      </p>
      <p className="text-muted-foreground">Your saved simulations remain on this server.</p>
    </main>
  )
}
