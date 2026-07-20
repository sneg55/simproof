import type { VerificationReportDisplay } from '@simproof/contracts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const UNIT_TOKENS = new Set(['m', 'deg', 'mps', 's', 'kg', 'n', 'j', 'rad', 'pa'])

export function humanizeQuantity(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/\s+/u)
    .filter((word) => word.length > 0)
  const last = words.at(-1)
  const trimmed =
    words.length > 1 && last !== undefined && UNIT_TOKENS.has(last.toLowerCase())
      ? words.slice(0, -1)
      : words
  const phrase = trimmed.join(' ').toLowerCase()
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

export function ReportSummary({ display }: { readonly display: VerificationReportDisplay }) {
  const { report } = display
  const total = report.checks.length
  const passed = report.checks.filter((check) => check.outcome === 'passed').length
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>What this report checked</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p data-dynamic-number>
          SimProof ran {total} independent scientific {total === 1 ? 'check' : 'checks'} against the
          trusted {report.domainPack.id} model.{' '}
          {passed === total ? 'Every check passed.' : `${total - passed} of ${total} did not pass.`}
        </p>
        {report.testedScope.parameters.length > 0 ? (
          <div>
            <p className="text-muted-foreground">It tested these ranges:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {report.testedScope.parameters.map((parameter) => (
                <li key={parameter.parameter} data-dynamic-number>
                  {humanizeQuantity(parameter.parameter)}: {parameter.min} to {parameter.max}{' '}
                  {parameter.unit}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-muted-foreground">
          Each result had to match the trusted physics within the tolerances listed below. The
          assumptions and limitations show where the model stops applying.
        </p>
      </CardContent>
    </Card>
  )
}
