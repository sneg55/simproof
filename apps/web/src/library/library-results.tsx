import type { LibraryPage } from '@simproof/contracts'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { LifecycleBadge } from '@/library/lifecycle-badge'
import { DomainGlyph } from '@/preview/domain-glyph'

type LibrarySimulationSummary = LibraryPage['items'][number]

export function LibraryResults({
  filtered,
  items,
  loadingMore,
  nextCursor,
  onClearFilters,
  onLoadMore,
}: {
  readonly filtered: boolean
  readonly items: readonly LibrarySimulationSummary[]
  readonly loadingMore: boolean
  readonly nextCursor: string | null
  readonly onClearFilters: () => void
  readonly onLoadMore: () => void
}) {
  if (items.length === 0) {
    return (
      <div className="grid min-h-48 place-content-center gap-2 rounded-xl bg-muted/40 p-6 text-center">
        <h2 className="font-heading text-lg font-semibold">No simulations match these filters</h2>
        <p className="text-muted-foreground">Change the search or filters to see more results.</p>
        {filtered ? (
          <Button className="mx-auto mt-2" onClick={onClearFilters} variant="outline">
            Clear filters
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <p aria-live="polite" className="sr-only" role="status">
        {items.length} educator {items.length === 1 ? 'simulation' : 'simulations'} shown.
      </p>
      <ul
        aria-label="Simulations"
        className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3"
      >
        {items.map((item) => (
          <li key={item.id}>
            <Card className="h-full shadow-surface transition-[box-shadow] hover:shadow-surface-hover">
              <CardHeader>
                <DomainGlyph domain={item.currentVersion.domain} />
                <div className="flex flex-wrap gap-2">
                  <Badge variant={item.source.kind === 'seed' ? 'secondary' : 'outline'}>
                    {item.source.kind === 'seed' ? 'Bundled example' : 'Educator-created'}
                  </Badge>
                  <LifecycleBadge state={item.currentVersion.state} />
                </div>
                <CardTitle>
                  <h2>{item.title}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid flex-1 gap-2 text-muted-foreground">
                <p>
                  {item.source.kind === 'seed' ? item.source.seed.description : 'Local simulation'}
                </p>
                {item.currentVersion.domain === null ? null : (
                  <p>Domain: {item.currentVersion.domain}</p>
                )}
              </CardContent>
              <CardFooter>
                <Button asChild className="w-full" variant="outline">
                  <Link to={`/simulations/${item.id}`}>Open simulation</Link>
                </Button>
              </CardFooter>
            </Card>
          </li>
        ))}
      </ul>
      {nextCursor === null ? null : (
        <div className="flex justify-center">
          <Button disabled={loadingMore} onClick={onLoadMore} variant="outline">
            {loadingMore ? 'Loading more…' : 'Load more simulations'}
          </Button>
        </div>
      )}
    </>
  )
}
