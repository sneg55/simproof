import type { PortableSimulationExport, SimulationVersion } from '@simproof/contracts'
import type { ArtifactStore, PersistenceDatabase } from '@simproof/persistence'
import { getDomainPack } from '@simproof/verifier'
import { describe, expect, it } from 'vitest'

import { createBundledSeedCatalog } from '../seeds/bundled-seed-catalog.js'
import { EducatorReportProjection } from './report-projection.js'
import { portableExport, runFor, UUIDS, versionFor } from './report-projection.test-support.js'

describe('teacher verification report projection', () => {
  it('keeps administrator-confirmed deletion available after archival', async () => {
    const version: SimulationVersion = {
      id: UUIDS[1],
      simulationId: UUIDS[0],
      versionNumber: 1,
      state: 'archived',
      revision: 1,
      activeConceptSpecId: null,
      activeGeneratedArtifactId: null,
      activeArtifactBundle: null,
      activeVerificationRunId: null,
      createdAt: '2026-07-16T12:00:00.000Z',
      updatedAt: '2026-07-16T12:01:00.000Z',
    }
    const exported = {
      records: { conceptSpecs: [], generatedArtifacts: [], publications: [] },
    } as unknown as PortableSimulationExport
    const database = {
      educator: { duplicateLineage: () => ({ ok: true as const, value: null }) },
      maintenance: {
        exportSimulation: () => Promise.resolve({ ok: true as const, value: exported }),
      },
    } as unknown as PersistenceDatabase
    const projection = new EducatorReportProjection(database, {} as ArtifactStore, undefined)

    await expect(projection.versionDetail(version)).resolves.toMatchObject({
      ok: true,
      value: { availableActions: ['duplicate', 'export', 'delete'] },
    })
  })

  it('persists installed-authority staleness and suppresses badge and publication authority', async () => {
    const bundled = createBundledSeedCatalog().report('projectile.introduction')
    if (!bundled.ok) throw new Error('bundled report unavailable')
    const source = bundled.value
    const pack = getDomainPack('projectile')
    let version = versionFor({
      versionId: source.simulationVersionId,
      runId: source.report.reportId,
      coreHash: source.report.artifact.hash as `sha256:${string}`,
      state: 'verified',
      revision: 4,
    })
    const run = runFor(version, source, pack.contentHash as `sha256:${string}`)
    const database = {
      getVersion: () => ({ ok: true as const, value: version }),
      verification: {
        get: () => ({ ok: true as const, value: run }),
        currentValidity: () => {
          version = versionFor({
            versionId: source.simulationVersionId,
            runId: source.report.reportId,
            coreHash: source.report.artifact.hash as `sha256:${string}`,
            state: 'stale',
            revision: 5,
          })
          return Promise.resolve({
            ok: false as const,
            error: { code: 'invalid-state' as const, message: 'authority changed' },
          })
        },
        validity: () => ({
          ok: true as const,
          value: { status: 'stale' as const, reasons: ['policy-changed' as const] },
        }),
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
            JSON.stringify(hash === run.report.contentHash ? source.report : source.conceptSpec),
            'utf8',
          ),
        }),
    } as unknown as ArtifactStore
    const projection = new EducatorReportProjection(database, artifacts, () => ({
      ok: true,
      value: {
        policyReferenceId: run.policyReferenceId,
        policyContentHash: run.policyContentHash,
        domainPackReferenceId: run.domainPackReferenceId,
        domainPackContentHash: run.domainPackContentHash,
        runnerVersion: run.runnerVersion,
        runnerProtocolVersion: run.runnerProtocolVersion,
        dependencies: run.dependencies,
      },
    }))

    expect(await projection.display(version.id)).toMatchObject({
      ok: true,
      value: {
        versionRevision: 5,
        validity: { status: 'stale', reasons: ['policy-changed'] },
        badgeActive: false,
        publishable: false,
        publication: { published: false },
      },
    })
  })
})
