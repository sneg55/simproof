import type { DatabaseSync } from 'node:sqlite'

import {
  conceptSpecSchema,
  persistenceEvidenceBindingsSchema,
  type ReportValidity,
  reportValiditySchema,
  type SimulationVersion,
  type StaleReason,
  type VerificationRun,
} from '@simproof/contracts'

import type { ArtifactStore } from './artifact-store.js'
import { err, type InstalledEvidenceResolver, ok, type Result } from './types.js'
import { validateReportContent } from './verification-report-validator.js'

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const INVALID_STATE = 'invalid-state'

export function evidenceFromRun(value: VerificationRun) {
  return persistenceEvidenceBindingsSchema.parse({
    conceptSpecId: value.conceptSpecId,
    conceptSpecArtifact: value.conceptSpecArtifact,
    generatedArtifactId: value.generatedArtifactId,
    artifactBundle: value.artifactBundle,
    policyReferenceId: value.policyReferenceId,
    domainPackReferenceId: value.domainPackReferenceId,
    policyContentHash: value.policyContentHash,
    domainPackContentHash: value.domainPackContentHash,
    runnerVersion: value.runnerVersion,
    runnerProtocolVersion: value.runnerProtocolVersion,
    dependencies: value.dependencies,
    observationHash: value.observationHash,
    report: value.report,
  })
}

export function compareEvidence(
  run: VerificationRun,
  currentInput: unknown,
): Result<ReportValidity> {
  const current = persistenceEvidenceBindingsSchema.safeParse(currentInput)
  if (!current.success) return err('invalid-input', 'Current verification evidence is invalid.')
  const recorded = evidenceFromRun(run)
  const reasons: StaleReason[] = []
  addReason(
    reasons,
    recorded.conceptSpecId !== current.data.conceptSpecId ||
      !same(recorded.conceptSpecArtifact, current.data.conceptSpecArtifact),
    'concept-changed',
  )
  addReason(
    reasons,
    recorded.generatedArtifactId !== current.data.generatedArtifactId ||
      !same(recorded.artifactBundle, current.data.artifactBundle) ||
      !same(recorded.report, current.data.report),
    'artifact-changed',
  )
  addReason(
    reasons,
    recorded.observationHash !== current.data.observationHash,
    'observations-changed',
  )
  addReason(
    reasons,
    recorded.policyReferenceId !== current.data.policyReferenceId ||
      recorded.policyContentHash !== current.data.policyContentHash,
    'policy-changed',
  )
  addReason(
    reasons,
    recorded.domainPackReferenceId !== current.data.domainPackReferenceId ||
      recorded.domainPackContentHash !== current.data.domainPackContentHash,
    'domain-pack-changed',
  )
  addReason(
    reasons,
    recorded.runnerVersion !== current.data.runnerVersion ||
      String(recorded.runnerProtocolVersion) !== String(current.data.runnerProtocolVersion),
    'runner-changed',
  )
  addReason(
    reasons,
    !same(recorded.dependencies, current.data.dependencies),
    'dependencies-changed',
  )
  return ok(
    reportValiditySchema.parse(
      reasons.length === 0 ? { status: 'current' } : { status: 'stale', reasons },
    ),
  )
}

export class VerificationValidity {
  readonly database: DatabaseSync
  readonly getVersion: (id: string) => Result<SimulationVersion>
  readonly getRun: (id: string) => Result<VerificationRun>
  readonly resolveInstalledEvidence: InstalledEvidenceResolver
  readonly canWrite: () => boolean

  constructor(options: {
    database: DatabaseSync
    getVersion: (id: string) => Result<SimulationVersion>
    getRun: (id: string) => Result<VerificationRun>
    resolveInstalledEvidence: InstalledEvidenceResolver
    canWrite: () => boolean
  }) {
    this.database = options.database
    this.getVersion = options.getVersion
    this.getRun = options.getRun
    this.resolveInstalledEvidence = options.resolveInstalledEvidence
    this.canWrite = options.canWrite
  }

  async current(id: string, store: ArtifactStore): Promise<Result<ReportValidity>> {
    const checked = await this.#check(id, store, true)
    if (!checked.ok) return checked
    const { run, version, validity } = checked.value
    if (
      validity.status !== 'current' ||
      run.verdict !== 'verified' ||
      (version.state !== 'verified' && version.state !== 'published')
    ) {
      return err(INVALID_STATE, 'Only current verified evidence is badge-eligible.')
    }
    return ok(validity)
  }

  async forFinalization(id: string, store: ArtifactStore): Promise<Result<ReportValidity>> {
    const checked = await this.#check(id, store, false)
    if (!checked.ok) return checked
    return checked.value.version.state === 'verifying'
      ? ok(checked.value.validity)
      : err(INVALID_STATE, 'Verification evidence is not awaiting finalization.')
  }

  recheckAuthority(run: VerificationRun, version: SimulationVersion): Result<true> {
    const installed = this.resolveInstalledEvidence(run)
    if (!installed.ok) return installed
    const comparison = compareEvidence(run, { ...evidenceFromRun(run), ...installed.value })
    if (!comparison.ok) return comparison
    if (comparison.value.status === 'current') return ok(true)
    const persisted = this.#markStale(version)
    return persisted.ok
      ? err(INVALID_STATE, 'Installed verification authority changed during validation.')
      : persisted
  }

  async #check(
    id: string,
    store: ArtifactStore,
    requireSelectedRun: boolean,
  ): Promise<
    Result<{ run: VerificationRun; version: SimulationVersion; validity: ReportValidity }>
  > {
    const run = this.getRun(id)
    if (!run.ok) return run
    const version = this.getVersion(run.value.simulationVersionId)
    if (!version.ok) return version
    if (requireSelectedRun && version.value.activeVerificationRunId !== run.value.id) {
      return err(INVALID_STATE, 'Verification run is not the version selected for current use.')
    }
    const installed = this.resolveInstalledEvidence(run.value)
    if (!installed.ok) return installed
    const current = persistenceEvidenceBindingsSchema.safeParse({
      ...evidenceFromRun(run.value),
      conceptSpecId: version.value.activeConceptSpecId,
      generatedArtifactId: version.value.activeGeneratedArtifactId,
      artifactBundle: version.value.activeArtifactBundle,
      ...installed.value,
    })
    if (!current.success) return err('invalid-input', 'Installed verification evidence is invalid.')
    const comparison = compareEvidence(run.value, current.data)
    if (!comparison.ok) return comparison
    if (comparison.value.status === 'stale') {
      const persisted = this.#markStale(version.value)
      if (!persisted.ok) return persisted
      return ok({ run: run.value, version: version.value, validity: comparison.value })
    }
    const artifactCheck = await this.#validateArtifacts(run.value, store)
    if (!artifactCheck.ok) {
      const persisted = this.#markStale(version.value)
      if (!persisted.ok) return persisted
      return artifactCheck
    }
    return ok({ run: run.value, version: version.value, validity: comparison.value })
  }

  async #validateArtifacts(run: VerificationRun, store: ArtifactStore): Promise<Result<true>> {
    const bindings = [
      run.conceptSpecArtifact,
      run.artifactBundle.core,
      run.artifactBundle.renderer,
      run.artifactBundle.manifest,
      run.report,
    ]
    for (const binding of bindings) {
      const object = await store.get(binding.contentHash)
      if (!object.ok) return object
      if (binding.role === 'concept-spec' && !validConcept(object.value)) {
        return err('corrupt-artifact', 'Concept specification artifact is invalid.')
      }
      if (binding.role === 'verification-report' && !this.#validReport(run, object.value)) {
        return err('corrupt-artifact', 'Verification report bindings are invalid.')
      }
    }
    return ok(true)
  }

  #validReport(run: VerificationRun, content: Buffer): boolean {
    const findingRows = this.database
      .prepare(
        'SELECT finding_json FROM verification_findings WHERE verification_run_id=? ORDER BY ordinal',
      )
      .all(run.id) as unknown as Array<{ finding_json: string }>
    const findings = findingRows.map(({ finding_json }) => JSON.parse(finding_json) as never)
    return validateReportContent(this.database, run, findings, content)
  }

  #markStale(version: SimulationVersion): Result<true> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    if (!['verifying', 'verified', 'published'].includes(version.state)) {
      return err(INVALID_STATE, 'Version cannot be durably marked stale from its current state.')
    }
    try {
      const changed = this.database
        .prepare(`UPDATE simulation_versions SET state='stale',revision=revision+1,updated_at=?
          WHERE id=? AND revision=? AND state IN ('verifying','verified','published')`)
        .run(new Date().toISOString(), version.id, version.revision)
      if (Number(changed.changes) === 1) return ok(true)
      this.getVersion(version.id)
      return err('conflict', 'Version changed while verification evidence was invalidated.')
    } catch {
      return err('database-error', 'Failed to persist verification invalidation.')
    }
  }
}

function validConcept(content: Buffer): boolean {
  try {
    conceptSpecSchema.parse(JSON.parse(content.toString('utf8')))
    return true
  } catch {
    return false
  }
}

function addReason(reasons: StaleReason[], changed: boolean, reason: StaleReason): void {
  if (changed) reasons.push(reason)
}
