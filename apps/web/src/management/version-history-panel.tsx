import type { VersionComparison, VersionHistory } from '@simproof/contracts'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const changeLabels = new Map<VersionComparison['rows'][number]['field'], string>([
  ['state', 'Lifecycle state'],
  ['artifact', 'Generated artifact'],
  ['concept', 'Concept specification'],
  ['policy', 'Verification policy'],
  ['domain-pack', 'Domain pack'],
  ['runner', 'Runner'],
  ['verdict', 'Verification verdict'],
  ['findings', 'Findings'],
  ['assumptions', 'Assumptions'],
  ['limitations', 'Limitations'],
  ['publication', 'Publication'],
  ['export-license', 'Export license'],
])

export function VersionHistoryPanel({
  history,
  onCompare,
}: {
  readonly history: VersionHistory
  readonly onCompare: (left: string, right: string) => Promise<VersionComparison | null>
}) {
  const versions = history.versions
  const [left, setLeft] = useState(versions.at(-2)?.summary.id ?? versions[0]?.summary.id ?? '')
  const [right, setRight] = useState(versions.at(-1)?.summary.id ?? '')
  const [comparison, setComparison] = useState<VersionComparison | null>(null)
  const [comparing, setComparing] = useState(false)
  const distinct = left !== '' && right !== '' && left !== right

  const compare = async () => {
    if (!distinct || comparing) return
    setComparing(true)
    setComparison(await onCompare(left, right))
    setComparing(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Version history</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        <Table scrollLabel="Scrollable version history">
          <TableCaption>
            The state and verification result of every version. Earlier versions are never changed.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Revision</TableHead>
              <TableHead>Verification</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map(({ summary }) => (
              <TableRow key={summary.id}>
                <TableCell className="font-medium">Version {summary.versionNumber}</TableCell>
                <TableCell>{summary.state}</TableCell>
                <TableCell className="tabular-nums">{summary.revision}</TableCell>
                <TableCell>{summary.verification.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {versions.length > 1 ? (
          <section aria-labelledby="compare-heading" className="grid gap-4">
            <h3 className="font-heading font-medium" id="compare-heading">
              Compare exact versions
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <VersionSelect
                label="Left version"
                onChange={setLeft}
                value={left}
                versions={versions}
              />
              <VersionSelect
                label="Right version"
                onChange={setRight}
                value={right}
                versions={versions}
              />
            </div>
            {!distinct ? (
              <p className="text-sm text-destructive" role="alert">
                Select two distinct versions.
              </p>
            ) : null}
            <Button
              className="w-fit"
              disabled={!distinct || comparing}
              onClick={() => void compare()}
              variant="outline"
            >
              {comparing ? 'Comparing…' : 'Compare versions'}
            </Button>
            {comparison !== null ? <ComparisonTable comparison={comparison} /> : null}
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">
            Create another version to compare changes.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ComparisonTable({ comparison }: { readonly comparison: VersionComparison }) {
  return (
    <div aria-live="polite" className="grid gap-3">
      <h4 className="font-medium">Auditable version comparison</h4>
      <p className="text-sm text-muted-foreground">
        Values come from the exact version records and their bound verification evidence.
      </p>
      <div className="grid gap-3 md:hidden">
        {comparison.rows.map((row) => (
          <section className="grid gap-3 rounded-lg border p-4" key={row.field}>
            <h5 className="font-medium">
              {changeLabels.get(row.field)} · {row.changed ? 'Changed' : 'Unchanged'}
            </h5>
            <ComparisonValue heading="Left version" value={row.left} />
            <ComparisonValue heading="Right version" value={row.right} />
          </section>
        ))}
      </div>
      <div className="hidden md:block">
        <Table scrollLabel="Scrollable version comparison">
          <TableCaption>
            Exact evidence values for the selected left and right versions.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Evidence</TableHead>
              <TableHead>Left version</TableHead>
              <TableHead>Right version</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison.rows.map((row) => (
              <TableRow key={row.field}>
                <TableCell className="align-top font-medium">
                  {changeLabels.get(row.field)}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {row.changed ? 'Changed' : 'Unchanged'}
                  </span>
                </TableCell>
                <TableCell className="whitespace-normal align-top">
                  <ComparisonValue value={row.left} />
                </TableCell>
                <TableCell className="whitespace-normal align-top">
                  <ComparisonValue value={row.right} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function ComparisonValue({
  heading,
  value,
}: {
  readonly heading?: string | undefined
  readonly value: VersionComparison['rows'][number]['left']
}) {
  return (
    <div className="grid gap-2">
      {heading === undefined ? null : <h6 className="text-xs font-medium uppercase">{heading}</h6>}
      <p className="text-sm">{value.summary}</p>
      {value.details.length === 0 ? null : (
        <dl className="grid gap-1 text-xs text-muted-foreground">
          {value.details.map((detail, index) => (
            <div className="grid gap-0.5" key={`${detail.label}:${index}`}>
              <dt className="font-medium text-foreground">{detail.label}</dt>
              <dd className="break-words">{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {value.truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing {value.details.length} of {value.totalDetailCount} details.
        </p>
      ) : null}
    </div>
  )
}

function VersionSelect({
  label,
  onChange,
  value,
  versions,
}: {
  readonly label: string
  readonly onChange: (value: string) => void
  readonly value: string
  readonly versions: VersionHistory['versions']
}) {
  const id = `comparison-${label.toLowerCase().replace(' ', '-')}`
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger className="w-full" id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {versions.map(({ summary }) => (
            <SelectItem key={summary.id} value={summary.id}>
              Version {summary.versionNumber} · revision {summary.revision}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
