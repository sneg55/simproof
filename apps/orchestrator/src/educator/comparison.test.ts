import type { EducatorVersionDetail, VerificationReportDisplay } from '@simproof/contracts'
import { describe, expect, it } from 'vitest'

import { createBundledSeedCatalog } from '../seeds/bundled-seed-catalog.js'
import { comparisonRowsFor } from './comparison-projection.js'
import type { ComparisonEvidence } from './report-projection.js'

describe('educator version comparison', () => {
  it('reports every public evidence field in deterministic contract order', () => {
    const catalog = createBundledSeedCatalog()
    const detail = catalog.detail('projectile.introduction')
    const displayed = catalog.report('projectile.introduction')
    if (!detail.ok || !displayed.ok) throw new Error('bundled evidence is unavailable')
    const left = detail.value.selectedVersion
    const right = {
      ...structuredClone(left),
      summary: {
        ...left.summary,
        state: 'archived',
        verification: { status: 'none' },
      },
      conceptSpec: null,
      exportLicense: null,
    } as EducatorVersionDetail
    const leftEvidence = evidence(displayed.value)
    const rightEvidence = {
      ...structuredClone(leftEvidence),
      policy: { ...leftEvidence.policy, version: '9.9.9' },
      domainPack: { ...leftEvidence.domainPack, contentHash: `sha256:${'2'.repeat(64)}` },
      runner: { version: '9.9.9', protocolVersion: '1' },
      findings: [
        {
          id: 'comparison.changed',
          severity: 'warning',
          category: 'mismatch',
          checkId: 'comparison.check',
          quantity: 'range',
          inputs: { speed: { value: 1, unit: 'm/s' } },
          expected: { value: 1, unit: 'm' },
          actual: { value: 2, unit: 'm' },
          tolerance: {
            mode: 'property',
            expected: { value: 1, unit: 'm' },
            allowedError: { value: 0.1, unit: 'm' },
          },
          error: { mode: 'absolute', value: 1, unit: 'm' },
          explanation: 'Comparison evidence changed.',
        },
      ],
      assumptions: ['Changed assumption.'],
      limitations: ['Changed limitation.'],
      publication: {
        published: true,
        publishedAt: '2026-07-16T12:00:00.000Z',
        exportLicense: { kind: 'spdx', id: 'MIT' },
      },
    } satisfies ComparisonEvidence

    const rows = comparisonRowsFor(left, right, leftEvidence, rightEvidence)
    expect(rows.filter(({ changed }) => changed).map(({ field }) => field)).toEqual([
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
    ])
    expect(rows.map(({ field }) => field)).toEqual([
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
    ])
    expect(rows.every(({ left: value, right: other }) => value.summary && other.summary)).toBe(true)
    expect(rows.find(({ field }) => field === 'policy')?.right.summary).toBe(
      `${rightEvidence.policy.id} @ ${rightEvidence.policy.version}`,
    )
  })
})

function evidence(display: VerificationReportDisplay): ComparisonEvidence {
  return {
    policy: display.report.policy,
    domainPack: display.report.domainPack,
    runner: display.report.runner,
    findings: display.report.findings,
    assumptions: display.report.assumptions,
    limitations: display.report.limitations,
    publication: display.publication,
  }
}
