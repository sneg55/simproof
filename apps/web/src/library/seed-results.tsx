import type { LibraryQuery, SeedMetadata } from '@simproof/contracts'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { VerificationBadge } from '@/components/ui/verification-badge'
import { DomainGlyph } from '@/preview/domain-glyph'

export function SeedResults({
  query,
  seeds,
}: {
  readonly query: LibraryQuery
  readonly seeds: readonly SeedMetadata[]
}) {
  const visibleSeeds = seeds.filter((seed) => seedMatches(seed, query))
  if (visibleSeeds.length === 0) return null
  return (
    <section aria-labelledby="bundled-examples-heading" className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="font-heading text-xl font-semibold" id="bundled-examples-heading">
          Bundled verified examples
        </h2>
        <p className="text-muted-foreground">Open these without configuring a model provider.</p>
      </div>
      <ul className="grid list-none gap-4 p-0 sm:grid-cols-2">
        {visibleSeeds.map((seed) => (
          <li key={seed.seedId}>
            <Card className="h-full shadow-surface transition-[box-shadow] hover:shadow-surface-hover">
              <CardHeader>
                <DomainGlyph domain={seed.domain} />
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">Bundled example</Badge>
                  <VerificationBadge state="verified" />
                </div>
                <CardTitle>
                  <h3>{seed.title}</h3>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid flex-1 gap-2">
                <p>{seed.description}</p>
                <p className="text-muted-foreground">
                  {seed.domain} · {seed.contentLicense}
                </p>
              </CardContent>
              <CardFooter>
                <Button asChild className="w-full" variant="outline">
                  <Link to={`/seeds/${seed.seedId}/preview`}>Open bundled example</Link>
                </Button>
              </CardFooter>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  )
}

function seedMatches(seed: SeedMetadata, query: LibraryQuery): boolean {
  const search = query.search.toLocaleLowerCase()
  const matchesSearch =
    search === '' ||
    seed.title.toLocaleLowerCase().includes(search) ||
    seed.description.toLocaleLowerCase().includes(search)
  const matchesDomain = query.domains.length === 0 || query.domains.includes(seed.domain)
  const matchesState = query.states.length === 0 || query.states.includes('verified')
  return matchesSearch && matchesDomain && matchesState
}
