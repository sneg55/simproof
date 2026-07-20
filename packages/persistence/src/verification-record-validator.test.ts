import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { rejectedFixture } from './verified-fixture.test-support.js'

const FINDING = {
  id: 'pendulum.period.mismatch',
  category: 'mismatch' as const,
  severity: 'error' as const,
  checkId: 'period.matches',
  quantity: 'periodS',
  inputs: { length: { value: 1, unit: 'm' } },
  expected: { value: 2, unit: 's' },
  actual: { value: 3, unit: 's' },
  tolerance: { mode: 'absolute' as const, absolute: 0.01, unit: 's' },
  error: { mode: 'absolute' as const, value: 1, unit: 's' },
  explanation: 'The candidate period drifts outside the trusted tolerance.',
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortDeep(item)]),
    )
  }
  return value
}

describe('verification record validation for rejected runs', () => {
  // Regression: validateReport Zod-parses the report artifact (schema key order) but reads the
  // persisted finding_json raw (its stored key order). A raw JSON.stringify comparison then fails
  // whenever the two serializations differ only in key order, as they do for records written
  // under an earlier field order or re-canonicalized bytes. Because exportSimulation runs this
  // whole-database validation, one such rejected run made every educator report/detail/comparison
  // view fail closed. The comparison must be canonical, like validateReportContent already is.
  it('exports a rejected simulation whose stored findings differ from the report only in key order', async () => {
    const context = await rejectedFixture('rejected-findings', [FINDING])
    try {
      const tamper = new DatabaseSync(context.database.path)
      tamper.exec('DROP TRIGGER immutable_finding')
      tamper
        .prepare('UPDATE verification_findings SET finding_json=? WHERE verification_run_id=?')
        .run(JSON.stringify(sortDeep(FINDING)), context.verificationRun.id)
      tamper.close()

      const exported = await context.database.maintenance.exportSimulation(
        context.simulationId,
        context.store,
      )
      expect(exported).toMatchObject({ ok: true })
    } finally {
      await context.cleanup()
    }
  })
})
