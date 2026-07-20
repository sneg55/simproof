import type {
  EducatorRuntimeConfig,
  LibraryPage,
  LibraryQuery,
  SeedMetadata,
} from '@simproof/contracts'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import type { EducatorApi } from '@/api/educator-api'
import { DocumentTitle } from '@/app/document-title'
import { useEducatorSession } from '@/auth/session-context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { RuntimeDisclosure } from '@/diagnostics/runtime-disclosure'
import { LibraryFilters } from '@/library/library-filters'
import { LibraryResults } from '@/library/library-results'
import {
  type LibraryRouteNotice,
  libraryRouteNoticeMessage,
  parseLibraryRouteNotice,
} from '@/library/library-route-notice'
import { PendulumFigure } from '@/library/pendulum-figure'
import { SeedResults } from '@/library/seed-results'
import { VerifiedExplainer } from '@/library/verified-explainer'

const INITIAL_QUERY: LibraryQuery = {
  search: '',
  domains: [],
  states: [],
  sources: [],
  limit: 50,
}

type ResourceState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | {
      readonly status: 'ready'
      readonly runtime: EducatorRuntimeConfig
      readonly seeds: readonly SeedMetadata[]
    }

type LibraryState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly previous?: LibraryPage }
  | { readonly status: 'ready'; readonly page: LibraryPage }

export function LibraryPage() {
  const { api, expireSession } = useEducatorSession()
  const location = useLocation()
  const navigate = useNavigate()
  const [{ cleanUrl, notice }] = useState(() => ({
    cleanUrl: `${location.pathname}${location.search}${location.hash}`,
    notice: parseLibraryRouteNotice(location.state),
  }))
  useEffect(() => {
    if (notice !== null) void navigate(cleanUrl, { replace: true, state: null })
  }, [cleanUrl, navigate, notice])
  return <LibraryPageView api={api} notice={notice} onAuthenticationFailure={expireSession} />
}

export function LibraryPageView({
  api,
  notice = null,
  onAuthenticationFailure,
}: {
  readonly api: EducatorApi
  readonly notice?: LibraryRouteNotice | null | undefined
  readonly onAuthenticationFailure?: () => void
}) {
  const [query, setQuery] = useState<LibraryQuery>(INITIAL_QUERY)
  const [resources, setResources] = useState<ResourceState>({ status: 'loading' })
  const [library, setLibrary] = useState<LibraryState>({ status: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (resources.status !== 'ready' || library.status !== 'ready') return
    const frame = requestAnimationFrame(() => headingRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [library.status, resources.status])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([api.runtimeConfig(controller.signal), api.listSeeds(controller.signal)]).then(
      ([runtime, seeds]) => {
        if (controller.signal.aborted) return
        if (
          (!runtime.ok && runtime.error.kind === 'authentication') ||
          (!seeds.ok && seeds.error.kind === 'authentication')
        ) {
          onAuthenticationFailure?.()
          return
        }
        setResources(
          runtime.ok && seeds.ok
            ? { status: 'ready', runtime: runtime.value, seeds: seeds.value }
            : { status: 'error' },
        )
      },
    )
    return () => controller.abort()
  }, [api, onAuthenticationFailure, reloadKey])

  useEffect(() => {
    const controller = new AbortController()
    void api.listSimulations(query, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (!result.ok && result.error.kind === 'authentication') {
        onAuthenticationFailure?.()
        return
      }
      setLoadingMore(false)
      setLibrary((current) =>
        result.ok
          ? {
              status: 'ready',
              page:
                query.cursor !== undefined && current.status === 'ready'
                  ? appendPage(current.page, result.value)
                  : result.value,
            }
          : {
              status: 'error',
              ...(current.status === 'ready'
                ? { previous: current.page }
                : current.status === 'error' && current.previous !== undefined
                  ? { previous: current.previous }
                  : {}),
            },
      )
    })
    return () => controller.abort()
  }, [api, onAuthenticationFailure, query, reloadKey])

  const displayedPage =
    library.status === 'ready'
      ? library.page
      : library.status === 'error'
        ? library.previous
        : undefined
  const recoverableFailure = library.status === 'error' && displayedPage !== undefined
  const failed =
    resources.status === 'error' || (library.status === 'error' && library.previous === undefined)
  const filtered =
    query.search !== '' ||
    query.domains.length > 0 ||
    query.states.length > 0 ||
    query.sources.length > 0
  const changeFilters = (next: LibraryQuery) => {
    const { cursor: _cursor, ...filters } = next
    setQuery(filters)
  }
  return (
    <>
      <DocumentTitle value="Simulation library | SimProof" />
      <div className="grid gap-8">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <header className="grid max-w-prose gap-3">
            <p className="font-medium text-primary">Educator workspace</p>
            <h1
              className="text-page-title font-heading font-semibold tracking-tight"
              ref={headingRef}
              tabIndex={-1}
            >
              Simulation library
            </h1>
            <p className="text-muted-foreground">
              SimProof turns a plain description of a lesson into an interactive STEM simulation,
              then independently checks the physics before you rely on it in class.
            </p>
            <p className="text-muted-foreground">
              Start with a verified bundled example or continue an educator-created simulation.
            </p>
            <div>
              <Button asChild>
                <Link to="/simulations/new">Create a simulation</Link>
              </Button>
            </div>
          </header>
          <PendulumFigure />
        </div>
        <LibraryOperationNotice notice={notice} />
        {failed ? (
          <LibraryError onRetry={() => setReloadKey((key) => key + 1)} />
        ) : resources.status === 'ready' && displayedPage !== undefined ? (
          <>
            <RuntimeDisclosure runtime={resources.runtime} seeds={resources.seeds} />
            <VerifiedExplainer />
            <SeedResults query={query} seeds={resources.seeds} />
            <section aria-labelledby="library-results-heading" className="grid gap-4">
              <h2 className="sr-only" id="library-results-heading">
                Educator-created simulations
              </h2>
              {recoverableFailure ? (
                <LibraryError onRetry={() => setReloadKey((key) => key + 1)} />
              ) : null}
              <LibraryFilters onChange={changeFilters} query={query} />
              <LibraryResults
                filtered={filtered}
                items={displayedPage.items}
                loadingMore={loadingMore}
                nextCursor={displayedPage.nextCursor}
                onClearFilters={() => setQuery(INITIAL_QUERY)}
                onLoadMore={() => {
                  if (displayedPage.nextCursor === null || loadingMore) return
                  setLoadingMore(true)
                  setQuery({ ...query, cursor: displayedPage.nextCursor })
                }}
              />
            </section>
          </>
        ) : (
          <LibraryLoading />
        )}
      </div>
    </>
  )
}

function LibraryOperationNotice({ notice }: { readonly notice: LibraryRouteNotice | null }) {
  if (notice === null) return null
  return (
    <Alert role="status">
      <AlertTitle>{libraryRouteNoticeMessage(notice)}</AlertTitle>
      <AlertDescription>
        {notice.operation === 'archive'
          ? 'The retained version remains available through the Archived filter.'
          : 'The simulation and its unreferenced artifacts were removed.'}
      </AlertDescription>
    </Alert>
  )
}

function appendPage(previous: LibraryPage, next: LibraryPage): LibraryPage {
  const byId = new Map(previous.items.map((item) => [item.id, item]))
  for (const item of next.items) byId.set(item.id, item)
  return { items: [...byId.values()], nextCursor: next.nextCursor }
}

function LibraryLoading() {
  return (
    <div className="grid gap-4" role="status">
      <span className="sr-only">Loading simulation library</span>
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  )
}

function LibraryError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="grid max-w-prose gap-4">
      <Alert variant="destructive">
        <AlertTitle>The simulation library could not be loaded</AlertTitle>
        <AlertDescription>Your saved simulations were not changed.</AlertDescription>
      </Alert>
      <div>
        <Button onClick={onRetry} variant="outline">
          Try again
        </Button>
      </div>
    </div>
  )
}
