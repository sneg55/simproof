import type {
  ComparisonField,
  ComparisonValue,
  EducatorVersionDetail,
  VersionComparison,
} from '@simproof/contracts'

import type { ComparisonEvidence } from './report-projection.js'

const ORDER: ComparisonField[] = [
  'state',
  'artifact',
  'concept',
  'policy',
  'domain-pack',
  'runner',
  'verdict',
  'findings',
  'assumptions',
  'limitations',
  'publication',
  'export-license',
]

export function comparisonRowsFor(
  left: EducatorVersionDetail,
  right: EducatorVersionDetail,
  leftEvidence: ComparisonEvidence | null,
  rightEvidence: ComparisonEvidence | null,
): VersionComparison['rows'] {
  const leftVerification = left.summary.verification
  const rightVerification = right.summary.verification
  const leftValue: Partial<ComparisonEvidence> = leftEvidence ?? {}
  const rightValue: Partial<ComparisonEvidence> = rightEvidence ?? {}
  const pairs = new Map<
    ComparisonField,
    readonly [unknown, unknown, ComparisonValue, ComparisonValue]
  >([
    [
      'state',
      [
        left.summary.state,
        right.summary.state,
        scalar(left.summary.state),
        scalar(right.summary.state),
      ],
    ],
    [
      'artifact',
      [
        artifactHash(leftVerification),
        artifactHash(rightVerification),
        scalar(artifactHash(leftVerification)),
        scalar(artifactHash(rightVerification)),
      ],
    ],
    ['concept', [left.conceptSpec, right.conceptSpec, conceptValue(left), conceptValue(right)]],
    [
      'policy',
      [
        leftValue.policy,
        rightValue.policy,
        bindingValue(leftValue.policy),
        bindingValue(rightValue.policy),
      ],
    ],
    [
      'domain-pack',
      [
        leftValue.domainPack,
        rightValue.domainPack,
        bindingValue(leftValue.domainPack),
        bindingValue(rightValue.domainPack),
      ],
    ],
    [
      'runner',
      [
        leftValue.runner,
        rightValue.runner,
        runnerValue(leftValue.runner),
        runnerValue(rightValue.runner),
      ],
    ],
    [
      'verdict',
      [
        verdict(leftVerification),
        verdict(rightVerification),
        scalar(verdict(leftVerification)),
        scalar(verdict(rightVerification)),
      ],
    ],
    [
      'findings',
      [
        leftValue.findings,
        rightValue.findings,
        findingsValue(leftValue.findings),
        findingsValue(rightValue.findings),
      ],
    ],
    [
      'assumptions',
      [
        leftValue.assumptions,
        rightValue.assumptions,
        listValue(leftValue.assumptions),
        listValue(rightValue.assumptions),
      ],
    ],
    [
      'limitations',
      [
        leftValue.limitations,
        rightValue.limitations,
        listValue(leftValue.limitations),
        listValue(rightValue.limitations),
      ],
    ],
    [
      'publication',
      [
        leftValue.publication,
        rightValue.publication,
        publicationValue(leftValue.publication),
        publicationValue(rightValue.publication),
      ],
    ],
    [
      'export-license',
      [
        left.exportLicense,
        right.exportLicense,
        licenseValue(left.exportLicense),
        licenseValue(right.exportLicense),
      ],
    ],
  ])
  return ORDER.map((field) => {
    const pair = pairs.get(field)
    if (pair === undefined) throw new TypeError(`Missing comparison projection for ${field}.`)
    const [leftRaw, rightRaw, leftDisplay, rightDisplay] = pair
    return { field, changed: !same(leftRaw, rightRaw), left: leftDisplay, right: rightDisplay }
  })
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const artifactHash = (value: EducatorVersionDetail['summary']['verification']): string | null =>
  value.status === 'none' ? null : value.artifactHash
const verdict = (value: EducatorVersionDetail['summary']['verification']): string | null =>
  value.status === 'none' ? null : value.verdict
const clipped = (value: string): string => value.slice(0, 500)
const scalar = (value: string | null | undefined): ComparisonValue => ({
  summary: value ?? 'No recorded evidence',
  details: [],
  totalDetailCount: 0,
  truncated: false,
})
const detailsValue = (
  summary: string,
  details: readonly { readonly label: string; readonly value: string }[],
): ComparisonValue => ({
  summary: clipped(summary),
  details: details
    .slice(0, 100)
    .map(({ label, value }) => ({ label: label.slice(0, 120), value: clipped(value) })),
  totalDetailCount: details.length,
  truncated: details.length > 100,
})
const bindingValue = (binding: { id: string; version: string; contentHash: string } | undefined) =>
  binding === undefined
    ? scalar(undefined)
    : detailsValue(`${binding.id} @ ${binding.version}`, [
        { label: 'Content hash', value: binding.contentHash },
      ])
const runnerValue = (runner: ComparisonEvidence['runner'] | undefined) =>
  runner === undefined
    ? scalar(undefined)
    : detailsValue(`Runner ${runner.version}`, [
        { label: 'Protocol', value: runner.protocolVersion },
      ])
const conceptValue = (detail: EducatorVersionDetail): ComparisonValue => {
  const concept = detail.conceptSpec
  if (concept === null) return scalar(undefined)
  const parameters =
    concept.domain === 'projectile'
      ? [
          parameterDetail('initialSpeed', concept.parameters.initialSpeed),
          parameterDetail('launchAngle', concept.parameters.launchAngle),
        ]
      : [
          parameterDetail('length', concept.parameters.length),
          parameterDetail('amplitude', concept.parameters.amplitude),
        ]
  return detailsValue(`${concept.title} (${concept.domain})`, parameters)
}
const parameterDetail = (
  label: string,
  parameter: {
    readonly defaultValue: number
    readonly requestedRange: { readonly min: number; readonly max: number }
    readonly unit: string
  },
) => ({
  label,
  value: `${parameter.defaultValue} ${parameter.unit}; range ${parameter.requestedRange.min}–${parameter.requestedRange.max} ${parameter.unit}`,
})
const findingsValue = (findings: ComparisonEvidence['findings'] | undefined): ComparisonValue =>
  findings === undefined
    ? scalar(undefined)
    : detailsValue(
        `${findings.length} finding${findings.length === 1 ? '' : 's'}`,
        findings.map((finding) => ({
          label: finding.id,
          value: `${finding.severity}; ${finding.category}; check ${finding.checkId}`,
        })),
      )
const listValue = (values: readonly string[] | undefined): ComparisonValue =>
  values === undefined
    ? scalar(undefined)
    : detailsValue(
        `${values.length} recorded`,
        values.map((value, index) => ({ label: `${index + 1}`, value })),
      )
const publicationValue = (publication: ComparisonEvidence['publication'] | undefined) =>
  publication === undefined || !publication.published
    ? scalar('Not published')
    : detailsValue(`Published ${publication.publishedAt}`, [
        { label: 'License', value: licenseText(publication.exportLicense) },
      ])
const licenseValue = (license: EducatorVersionDetail['exportLicense']) =>
  scalar(licenseText(license))
const licenseText = (license: EducatorVersionDetail['exportLicense']): string => {
  if (license === null || license.kind === 'none') return 'No export license'
  if (license.kind === 'spdx') return license.id
  return license.referenceUrl === null ? license.label : `${license.label}: ${license.referenceUrl}`
}
