import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function VerifiedExplainer() {
  return (
    <Card size="sm" className="max-w-prose">
      <CardHeader>
        <CardTitle>What the Verified badge means</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 text-muted-foreground">
        <p>
          A simulation marked Verified passed independent scientific checks against a trusted
          physics model, within stated ranges and tolerances.
        </p>
        <p>
          Open a simulation and choose View verification report to see exactly what was checked, and
          where the model stops applying.
        </p>
      </CardContent>
    </Card>
  )
}
