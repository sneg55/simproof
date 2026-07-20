import type { EducatorRuntimeConfig, SeedMetadata } from '@simproof/contracts'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function RuntimeDisclosure({
  runtime,
  seeds,
}: {
  readonly runtime: EducatorRuntimeConfig
  readonly seeds: readonly SeedMetadata[]
}) {
  const generationAvailable = runtime.generation.available
  return (
    <section aria-labelledby="configuration-heading" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-xl font-semibold" id="configuration-heading">
          Configuration and privacy
        </h2>
        <Badge variant={generationAvailable ? 'secondary' : 'outline'}>
          {generationAvailable ? 'Generation ready' : 'Generation unavailable'}
        </Badge>
      </div>
      {!generationAvailable ? (
        <Alert>
          <AlertTitle>Generation is unavailable</AlertTitle>
          <AlertDescription>
            Bundled examples still work without model credentials. A server administrator can
            configure generation separately.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Bundled examples</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1">
            <p>
              <span data-dynamic-number>{seeds.length}</span> locally bundled examples are
              available.
            </p>
            <p className="text-muted-foreground">
              Opening and running them does not contact a model provider.
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Before generation</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1">
            <p>Only the prompt and reviewed concept request are sent to the configured provider.</p>
            <p className="text-muted-foreground">
              Prompt retention defaults to {runtime.runtime.promptRetentionDefault}; telemetry is{' '}
              {runtime.runtime.telemetryEnabled ? 'enabled' : 'disabled'}.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
