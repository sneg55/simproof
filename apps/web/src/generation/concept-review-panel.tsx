import type { ConceptReviewDecision, ConceptSpec, GenerationStatus } from '@simproof/contracts'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type PendingReview = Extract<GenerationStatus['conceptReview'], { status: 'pending' }>

export function ConceptReviewPanel({
  busy,
  onDecision,
  review,
  runRevision,
}: {
  readonly busy: boolean
  readonly onDecision: (decision: ConceptReviewDecision) => void
  readonly review: PendingReview
  readonly runRevision: number
}) {
  const concept = review.conceptSpec
  const parameters = parameterRows(concept)
  const decide = (decision: ConceptReviewDecision['decision']) =>
    onDecision({
      expectedRunRevision: runRevision,
      expectedReviewRevision: review.reviewRevision,
      conceptSpecHash: review.conceptSpecHash,
      decision,
    })

  return (
    <Card aria-labelledby="concept-review-heading">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{domainLabel(concept.domain)}</Badge>
          <Badge variant="outline">Review required</Badge>
        </div>
        <CardTitle>
          <h2 id="concept-review-heading">{concept.title}</h2>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Code generation has not started. Accept only if this exact specification matches your
          learning goal.
        </p>
      </CardHeader>
      <CardContent className="grid gap-5">
        <Table scrollLabel="Scrollable concept parameters">
          <TableCaption>Exact parameters compiled from your prompt.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Parameter</TableHead>
              <TableHead scope="col">Default</TableHead>
              <TableHead scope="col">Unit</TableHead>
              <TableHead scope="col">Allowed range</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parameters.map((parameter) => (
              <TableRow key={parameter.name}>
                <TableCell className="font-medium">{parameterLabel(parameter.name)}</TableCell>
                <TableCell data-dynamic-number>{parameter.defaultValue}</TableCell>
                <TableCell>{parameter.unit}</TableCell>
                <TableCell data-dynamic-number>
                  {parameter.minimum} to {parameter.maximum}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div>
          <h3 className="font-medium">Controls in the simulation</h3>
          <p className="text-sm text-muted-foreground">
            {concept.requestedControls.map(parameterLabel).join(', ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy} onClick={() => decide('accept')}>
            {busy ? 'Saving decision…' : 'Accept concept and continue'}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={busy} variant="outline">
                Decline concept
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Decline this concept?</AlertDialogTitle>
                <AlertDialogDescription>
                  This ends the current run before code generation. You can start a new run with a
                  revised prompt.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
                <AlertDialogAction onClick={() => decide('decline')} variant="destructive">
                  Decline and end run
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  )
}

function domainLabel(domain: 'pendulum' | 'projectile'): string {
  return domain === 'pendulum' ? 'Pendulum' : 'Projectile motion'
}

function parameterLabel(value: string): string {
  return value.replace(/([A-Z])/gu, ' $1').replace(/^./u, (character) => character.toUpperCase())
}

interface ParameterRow {
  readonly name: string
  readonly defaultValue: number
  readonly unit: string
  readonly minimum: number
  readonly maximum: number
}

function parameterRows(concept: ConceptSpec): readonly ParameterRow[] {
  if (concept.domain === 'pendulum') {
    return [
      row('length', concept.parameters.length),
      row('amplitude', concept.parameters.amplitude),
    ]
  }
  return [
    row('initialSpeed', concept.parameters.initialSpeed),
    row('launchAngle', concept.parameters.launchAngle),
  ]
}

function row(
  name: string,
  parameter: {
    readonly defaultValue: number
    readonly unit: string
    readonly requestedRange: { readonly min: number; readonly max: number }
  },
): ParameterRow {
  return {
    name,
    defaultValue: parameter.defaultValue,
    unit: parameter.unit,
    minimum: parameter.requestedRange.min,
    maximum: parameter.requestedRange.max,
  }
}
