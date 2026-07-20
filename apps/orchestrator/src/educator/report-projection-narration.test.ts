import type { ArtifactStore, PersistenceDatabase } from '@simproof/persistence'
import { createScriptedFakeProvider, fakeProviderScenarios } from '@simproof/providers'
import { getDomainPack } from '@simproof/verifier'
import { describe, expect, it } from 'vitest'

import { createBundledSeedCatalog } from '../seeds/bundled-seed-catalog.js'
import { EducatorReportProjection } from './report-projection.js'
import { portableExport, runFor, versionFor } from './report-projection.test-support.js'

describe('teacher report narration', () => {
  it('attaches model-authored narration to a rejected report only when an explainer is present', async () => {
    const bundled = createBundledSeedCatalog().report('projectile.introduction')
    if (!bundled.ok) throw new Error('bundled report unavailable')
    const source = bundled.value
    const pack = getDomainPack('projectile')
    const rejectedReport = {
      ...source.report,
      verdict: 'rejected' as const,
      checks: [
        ...source.report.checks,
        { id: 'energy-drift', outcome: 'failed' as const, sampleCount: 1 },
      ],
      findings: [
        {
          id: 'finding.energy-drift',
          category: 'invariant' as const,
          severity: 'error' as const,
          checkId: 'energy-drift',
          quantity: 'energyJ',
          inputs: { speedMps: { value: 20, unit: 'm/s' } },
          expected: { value: 200, unit: 'J' },
          actual: { value: 236, unit: 'J' },
          tolerance: { mode: 'relative' as const, relative: 0.01 },
          error: { mode: 'relative' as const, value: 0.18 },
          explanation: 'Total energy drifts upward by 18 percent.',
        },
      ],
    }
    const rejectedSource = { ...source, report: rejectedReport }
    const version = versionFor({
      versionId: source.simulationVersionId,
      runId: source.report.reportId,
      coreHash: source.report.artifact.hash as `sha256:${string}`,
      state: 'draft',
      revision: 3,
    })
    const run = runFor(version, rejectedSource, pack.contentHash as `sha256:${string}`)
    const database = {
      getVersion: () => ({ ok: true as const, value: version }),
      verification: {
        get: () => ({ ok: true as const, value: run }),
        validity: () => ({ ok: true as const, value: { status: 'current' as const } }),
      },
      maintenance: {
        exportSimulation: () =>
          Promise.resolve({ ok: true as const, value: portableExport(source.simulationVersionId) }),
      },
    } as unknown as PersistenceDatabase
    const artifacts = {
      get: (hash: string) =>
        Promise.resolve({
          ok: true as const,
          value: Buffer.from(
            JSON.stringify(hash === run.report.contentHash ? rejectedReport : source.conceptSpec),
            'utf8',
          ),
        }),
    } as unknown as ArtifactStore
    const installed = () => ({
      ok: true as const,
      value: {
        policyReferenceId: run.policyReferenceId,
        policyContentHash: run.policyContentHash,
        domainPackReferenceId: run.domainPackReferenceId,
        domainPackContentHash: run.domainPackContentHash,
        runnerVersion: run.runnerVersion,
        runnerProtocolVersion: run.runnerProtocolVersion,
        dependencies: run.dependencies,
      },
    })

    const explained = await new EducatorReportProjection(
      database,
      artifacts,
      installed,
      createScriptedFakeProvider(fakeProviderScenarios.correct),
    ).display(version.id)
    expect(explained.ok).toBe(true)
    if (!explained.ok) return
    expect(explained.value.report.verdict).toBe('rejected')
    expect(explained.value.narration).toMatchObject({ source: 'model-commentary' })
    expect(explained.value.narration?.narration).toContain('energyJ')

    const plain = await new EducatorReportProjection(database, artifacts, installed).display(
      version.id,
    )
    expect(plain.ok && plain.value.narration).toBeUndefined()
  })
})
