import { describe, expect, it } from 'vitest'

import { createPersistence } from './database.js'
import { expectOk, fixture, id, NOW, sha } from './test-helpers.js'
import { err, ok } from './types.js'
import { verifiedFixture } from './verified-fixture.test-support.js'

describe('durable verification authority references', () => {
  it('ensures policy and domain-pack triples idempotently across database reopen', async () => {
    const context = await fixture('authority-reference-replay')
    const policy = {
      id: id(),
      policyId: 'pendulum.small-angle',
      version: '1.0.0',
      contentHash: sha('policy-reference'),
      createdAt: NOW,
    }
    const domainPack = {
      id: id(),
      domainPackId: 'pendulum',
      version: '1.0.0',
      contentHash: sha('domain-pack-reference'),
      createdAt: NOW,
    }
    try {
      expect(expectOk(context.database.records.ensurePolicyReference(policy))).toEqual(policy)
      expect(expectOk(context.database.records.ensureDomainPackReference(domainPack))).toEqual(
        domainPack,
      )
      const reopened = createPersistence(context.database.path)
      try {
        expectOk(reopened.migrate())
        expect(
          expectOk(
            reopened.records.ensurePolicyReference({
              ...policy,
              id: id(),
              createdAt: '2027-01-01T00:00:00.000Z',
            }),
          ),
        ).toEqual(policy)
        expect(
          expectOk(
            reopened.records.ensureDomainPackReference({
              ...domainPack,
              id: id(),
              createdAt: '2027-01-01T00:00:00.000Z',
            }),
          ),
        ).toEqual(domainPack)
        expect(
          reopened.records.ensurePolicyReference({ ...policy, contentHash: sha('different') }),
        ).toMatchObject({ ok: false, error: { code: 'conflict' } })
      } finally {
        reopened.close()
      }
    } finally {
      await context.cleanup()
    }
  })

  it('selects installed authority from the candidate verification run bindings', async () => {
    const context = await verifiedFixture('run-aware-authority')
    const seen: string[] = []
    const reopened = createPersistence(context.database.path, (run) => {
      seen.push(run.id)
      const key = `${run.policyReferenceId}:${run.domainPackReferenceId}`
      const expected = `${context.environment.policyReferenceId}:${context.environment.domainPackReferenceId}`
      return key === expected
        ? ok(context.environment)
        : err('invalid-state', 'No installed authority matches this verification run.')
    })
    try {
      expectOk(reopened.migrate())
      await expect(
        reopened.verification.currentValidity(context.verificationRun.id, context.store),
      ).resolves.toMatchObject({
        ok: true,
        value: { status: 'current' },
      })
      expect(seen).toEqual([context.verificationRun.id])
    } finally {
      reopened.close()
      await context.cleanup()
    }
  })
})
