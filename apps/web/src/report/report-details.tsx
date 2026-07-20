import type { Tolerance, VerificationFinding, VerificationReportDisplay } from '@simproof/contracts'

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
import { humanizeQuantity, ReportSummary } from '@/report/report-summary'

export function EvidenceDetails({ display }: { readonly display: VerificationReportDisplay }) {
  const { policy, report } = display
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ReportSummary display={display} />
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Technical provenance</CardTitle>
        </CardHeader>
        <CardContent>
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Show verification IDs and hashes
            </summary>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <EvidenceTerm label="Verification run ID" value={display.verificationRunId} mono />
              <EvidenceTerm label="Report ID" value={report.reportId} mono />
              <EvidenceTerm label="Report artifact hash" value={display.reportArtifactHash} mono />
              <EvidenceTerm
                label="Concept specification hash"
                value={report.conceptSpecHash}
                mono
              />
              <EvidenceTerm label="Observation hash" value={report.observationHash} mono />
              <EvidenceTerm label="Policy ID" value={policy.id} />
              <EvidenceTerm label="Policy version" value={policy.version} />
              <EvidenceTerm label="Policy hash" value={report.policy.contentHash} mono />
              <EvidenceTerm
                label="Domain pack"
                value={`${report.domainPack.id} ${report.domainPack.version}`}
              />
              <EvidenceTerm label="Domain pack hash" value={report.domainPack.contentHash} mono />
              <EvidenceTerm
                label="Runner"
                value={`${report.runner.version} · protocol ${report.runner.protocolVersion}`}
              />
              <EvidenceTerm label="Artifact hash" value={report.artifact.hash} mono />
            </dl>
          </details>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Trusted tolerances</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm">
            {toleranceEntries(policy.tolerances).map(({ label, value }) => (
              <EvidenceTerm key={label} label={humanize(label)} value={value} />
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Verification checks</CardTitle>
        </CardHeader>
        <CardContent>
          <Table aria-label="Verification checks" scrollLabel="Scrollable verification checks">
            <TableCaption>Individual trusted check outcomes recorded by this report.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Check ID</TableHead>
                <TableHead scope="col">Outcome</TableHead>
                <TableHead scope="col">Samples</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.checks.map((check) => (
                <TableRow key={check.id}>
                  <TableCell className="font-mono text-xs">{check.id}</TableCell>
                  <TableCell className="capitalize">{check.outcome}</TableCell>
                  <TableCell data-dynamic-number>{check.sampleCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Tested scope</CardTitle>
        </CardHeader>
        <CardContent>
          <Table scrollLabel="Scrollable tested parameter scope">
            <TableCaption>
              {report.testedScope.sampleCount} trusted samples · grid{' '}
              <span className="font-mono text-xs">{report.testedScope.samplingGridHash}</span>
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Quantity</TableHead>
                <TableHead scope="col">Tested range</TableHead>
                <TableHead scope="col">Unit</TableHead>
                <TableHead scope="col">Sampled values</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.testedScope.parameters.map((parameter) => (
                <TableRow key={parameter.parameter}>
                  <TableCell>{humanizeQuantity(parameter.parameter)}</TableCell>
                  <TableCell data-dynamic-number>
                    {parameter.min} to {parameter.max}
                  </TableCell>
                  <TableCell>{parameter.unit}</TableCell>
                  <TableCell data-dynamic-number>
                    {parameter.sampledValues?.join(', ') ?? 'Grid-defined'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Findings findings={report.findings} />
      <Assumptions assumptions={report.assumptions} limitations={report.limitations} />
    </div>
  )
}

function Findings({ findings }: { readonly findings: readonly VerificationFinding[] }) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Findings</CardTitle>
      </CardHeader>
      <CardContent>
        {findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No findings were recorded.</p>
        ) : (
          <div className="grid gap-4">
            {findings.map((finding) => (
              <article key={finding.id} className="grid gap-2 rounded-lg bg-muted p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{finding.quantity}</strong>
                  <span className="text-sm capitalize text-muted-foreground">
                    {finding.severity} · {finding.category}
                  </span>
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-3">
                  <EvidenceTerm label="Expected" value={measured(finding.expected)} />
                  <EvidenceTerm label="Actual" value={measured(finding.actual)} />
                  <EvidenceTerm label="Tolerance" value={formatTolerance(finding.tolerance)} />
                </dl>
                <p className="text-sm text-muted-foreground">
                  Inputs:{' '}
                  {Object.entries(finding.inputs)
                    .map(([name, value]) => `${name}: ${measured(value)}`)
                    .join('; ')}
                </p>
                <p>{finding.explanation}</p>
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Assumptions({
  assumptions,
  limitations,
}: {
  readonly assumptions: readonly string[]
  readonly limitations: readonly string[]
}) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Interpretation boundaries</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <TextList title="Assumptions" items={assumptions} />
        <TextList title="Limitations" items={limitations} />
      </CardContent>
    </Card>
  )
}

function TextList({ title, items }: { readonly title: string; readonly items: readonly string[] }) {
  return (
    <section aria-labelledby={`${title.toLowerCase()}-heading`}>
      <h3 id={`${title.toLowerCase()}-heading`} className="font-medium">
        {title}
      </h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  )
}

function EvidenceTerm({
  label,
  value,
  mono = false,
}: {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
}) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-xs' : ''}>{value}</dd>
    </div>
  )
}

function toleranceEntries(value: unknown, prefix = ''): { label: string; value: string }[] {
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  if (typeof record.mode === 'string')
    return [{ label: prefix, value: formatTolerance(record as Tolerance) }]
  if (
    typeof record.relativeTo === 'string' &&
    typeof record.relative === 'number' &&
    typeof record.absoluteFloorM === 'number'
  ) {
    return [
      {
        label: prefix,
        value: `Relative: ${record.relative * 100}% of ${record.relativeTo}; absolute floor: ${record.absoluteFloorM} m`,
      },
    ]
  }
  if (typeof record.expectedAngleDeg === 'number' && typeof record.relativeOrdering === 'number') {
    return [
      {
        label: prefix,
        value: `Expected angle: ${record.expectedAngleDeg} deg; relative ordering: ${record.relativeOrdering * 100}%`,
      },
    ]
  }
  return Object.entries(record).flatMap(([key, child]) =>
    toleranceEntries(child, prefix === '' ? key : `${prefix}.${key}`),
  )
}

export function formatTolerance(tolerance: VerificationFinding['tolerance']): string {
  if (tolerance.mode === 'relative') return `Relative: ${tolerance.relative * 100}%`
  if (tolerance.mode === 'absolute') return `Absolute: ${tolerance.absolute} ${tolerance.unit}`
  if (tolerance.mode === 'absolute-or-relative')
    return `Absolute ${tolerance.absolute} ${tolerance.unit} or relative ${tolerance.relative * 100}%`
  return `Expected ${measured(tolerance.expected)} ± ${measured(tolerance.allowedError)}`
}

function measured(value: { readonly value: number; readonly unit: string }): string {
  return `${value.value} ${value.unit}`
}

function humanize(value: string): string {
  return value.replaceAll('.', ' · ').replace(/([a-z])([A-Z])/g, '$1 $2')
}
