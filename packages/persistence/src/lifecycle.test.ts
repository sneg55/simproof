import { writeFile } from 'node:fs/promises'
import type { PersistenceEvidenceBindings, SimulationLifecycleState } from '@simproof/contracts'
import { describe, expect, it } from 'vitest'

import { allowedTransitions } from './lifecycle.js'
import { expectOk, id, NOW, sha } from './test-helpers.js'
import { verifiedFixture } from './verified-fixture.test-support.js'

describe('durable lifecycle and verification validity', () => {
  it('defines the complete 8x8 transition matrix', () => {
    const expected = new Map<SimulationLifecycleState, readonly SimulationLifecycleState[]>([
      ['draft', ['generating', 'archived']],
      ['generating', ['verifying', 'draft', 'archived']],
      ['verifying', ['verified', 'rejected', 'stale', 'archived']],
      ['rejected', ['generating', 'archived']],
      ['verified', ['published', 'stale', 'archived']],
      ['published', ['stale', 'archived']],
      ['stale', ['generating', 'verifying', 'archived']],
      ['archived', []],
    ])
    for (const [from, transitions] of expected) {
      expect(allowedTransitions(from)).toEqual(transitions)
      for (const to of expected.keys()) {
        expect(allowedTransitions(from).includes(to)).toBe(transitions.includes(to))
      }
    }
  })

  it('binds immutable passing evidence before entering verified', async () => {
    const context = await verifiedFixture('finalize')
    try {
      expect(context.database.getVersion(context.versionId)).toMatchObject({
        ok: true,
        value: {
          state: 'verified',
          revision: 4,
          activeVerificationRunId: context.verificationRun.id,
        },
      })
      expect(
        context.database.transitionVersion({
          id: context.versionId,
          expectedRevision: 4,
          to: 'rejected',
          updatedAt: NOW,
        }),
      ).toMatchObject({ ok: false, error: { code: 'invalid-transition' } })
      expect(
        context.database.records.updateGenerationAttempt({
          id: context.attemptId,
          outcome: 'rejected',
          generatedArtifactId: context.generatedArtifactId,
          stableErrorId: null,
          completedAt: NOW,
        }),
      ).toMatchObject({ ok: false, error: { code: 'immutable-record' } })
      expect(
        await context.database.verification.insert(context.verificationRun, [], context.store),
      ).toMatchObject({
        ok: false,
        error: { code: 'conflict' },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('reports every stale binding reason, including exact bundles, reports, and dependencies', async () => {
    const context = await verifiedFixture('stale')
    try {
      expect(
        context.database.verification.validity(context.verificationRun.id, context.evidence),
      ).toEqual({
        ok: true,
        value: { status: 'current' },
      })
      const cases: [Partial<PersistenceEvidenceBindings>, string][] = [
        [
          {
            conceptSpecArtifact: {
              ...context.evidence.conceptSpecArtifact,
              contentHash: sha('concept-2'),
            },
          },
          'concept-changed',
        ],
        [
          {
            artifactBundle: {
              ...context.evidence.artifactBundle,
              core: { ...context.evidence.artifactBundle.core, contentHash: sha('core-2') },
            },
          },
          'artifact-changed',
        ],
        [
          { report: { ...context.evidence.report, contentHash: sha('report-2') } },
          'artifact-changed',
        ],
        [{ observationHash: sha('observations-2') }, 'observations-changed'],
        [{ policyContentHash: sha('policy-2') }, 'policy-changed'],
        [{ domainPackContentHash: sha('pack-2') }, 'domain-pack-changed'],
        [{ runnerVersion: '1.1.0' }, 'runner-changed'],
        [
          {
            dependencies: {
              schemaVersion: '1',
              entries: [{ id: 'runtime', version: '1.0.0', contentHash: sha('runtime') }],
              contentHash: sha('deps-2'),
            },
          },
          'dependencies-changed',
        ],
      ]
      for (const [changed, reason] of cases) {
        expect(
          context.database.verification.validity(context.verificationRun.id, {
            ...context.evidence,
            ...changed,
          }),
        ).toMatchObject({
          ok: true,
          value: { status: 'stale', reasons: [reason] },
        })
      }
    } finally {
      await context.cleanup()
    }
  })

  it('publishes only the exact current artifact/report snapshot', async () => {
    const context = await verifiedFixture('publish')
    try {
      const publication = {
        id: id(),
        simulationVersionId: context.versionId,
        exportLicense: { kind: 'custom' as const, label: 'Teacher owned', referenceUrl: null },
        publishedAt: NOW,
      }
      expect(
        await context.database.verification.publish(
          {
            ...publication,
            id: id(),
            generatedArtifactId: id(),
          },
          4,
          context.store,
        ),
      ).toMatchObject({ ok: false })
      expect(context.database.getVersion(context.versionId)).toMatchObject({
        ok: true,
        value: { state: 'verified', revision: 4 },
      })
      expect(
        await context.database.verification.publish(
          {
            ...publication,
            id: id(),
            verificationRunId: id(),
          },
          4,
          context.store,
        ),
      ).toMatchObject({ ok: false })
      expectOk(await context.database.verification.publish(publication, 4, context.store))
      expect(context.database.getVersion(context.versionId)).toMatchObject({
        ok: true,
        value: { state: 'published', revision: 5 },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('fails closed when current CAS evidence is corrupt', async () => {
    const context = await verifiedFixture('publish-corrupt')
    try {
      await writeFile(
        context.store.pathForHash(context.evidence.report.contentHash),
        '{"tampered":true}',
      )
      const publication = {
        id: id(),
        simulationVersionId: context.versionId,
        exportLicense: { kind: 'none' as const },
        publishedAt: NOW,
      }
      expect(
        await context.database.verification.publish(publication, 4, context.store),
      ).toMatchObject({ ok: false, error: { code: 'corrupt-artifact' } })
      expect(context.database.getVersion(context.versionId)).toMatchObject({
        ok: true,
        value: { state: 'stale', revision: 5 },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('cannot replay recorded bindings after installed evidence changes and durably marks stale', async () => {
    const context = await verifiedFixture('installed-evidence-change')
    try {
      context.setInstalledEnvironment({
        ...context.environment,
        policyContentHash: sha('replacement-installed-policy'),
      })
      expect(
        await context.database.verification.currentValidity(
          context.verificationRun.id,
          context.store,
        ),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
      expect(context.database.getVersion(context.versionId)).toMatchObject({
        ok: true,
        value: { state: 'stale', revision: 5 },
      })
    } finally {
      await context.cleanup()
    }
  })

  it('never reports rejected lifecycle state as current badge evidence', async () => {
    const context = await verifiedFixture('rejected-badge')
    try {
      const mutate = new (await import('node:sqlite')).DatabaseSync(context.database.path)
      mutate
        .prepare("UPDATE simulation_versions SET state='rejected' WHERE id=?")
        .run(context.versionId)
      mutate.close()
      expect(
        await context.database.verification.currentValidity(
          context.verificationRun.id,
          context.store,
        ),
      ).toMatchObject({ ok: false, error: { code: 'invalid-state' } })
    } finally {
      await context.cleanup()
    }
  })
})
