import type { DatabaseSync } from 'node:sqlite'

import {
  type PublishedArtifact,
  publishedArtifactSchema,
  type ReportValidity,
  type SimulationVersion,
  simulationVersionSchema,
  type VerificationRun,
  verificationFindingRecordSchema,
  verificationRunSchema,
} from '@simproof/contracts'

import type { ArtifactStore } from './artifact-store.js'
import { asCount, sqliteFailure, transaction } from './sqlite.js'
import { err, type InstalledEvidenceResolver, ok, type Result } from './types.js'
import { finalizationMatches, publicationMatches } from './verification-matches.js'
import { validateReportArtifact } from './verification-report-validator.js'
import { compareEvidence, evidenceFromRun, VerificationValidity } from './verification-validity.js'

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const INVALID_INPUT = 'invalid-input'
const INVALID_STATE = 'invalid-state'
const MAINTENANCE_ACTIVE = 'Persistence maintenance is active.'
const publicationCommandSchema = publishedArtifactSchema
  .pick({ id: true, simulationVersionId: true, exportLicense: true, publishedAt: true })
  .strict()

function lifecycleForVerdict(verdict: VerificationRun['verdict']): SimulationVersion['state'] {
  switch (verdict) {
    case 'verified':
      return 'verified'
    case 'rejected':
      return 'rejected'
    case 'inapplicable':
      return 'stale'
  }
}

export class VerificationRepository {
  readonly #database: DatabaseSync
  readonly #getVersion: (id: string) => Result<SimulationVersion>
  readonly #canWrite: () => boolean
  readonly #validity: VerificationValidity
  readonly #serialize: <T>(operation: () => Promise<T>) => Promise<T>

  constructor(options: {
    database: DatabaseSync
    getVersion: (id: string) => Result<SimulationVersion>
    canWrite: () => boolean
    resolveInstalledEvidence: InstalledEvidenceResolver
    serialize: <T>(operation: () => Promise<T>) => Promise<T>
  }) {
    const { database, getVersion, canWrite, resolveInstalledEvidence, serialize } = options
    this.#database = database
    this.#getVersion = getVersion
    this.#canWrite = canWrite
    this.#serialize = serialize
    this.#validity = new VerificationValidity({
      database,
      getVersion,
      getRun: (id) => this.get(id),
      resolveInstalledEvidence,
      canWrite,
    })
  }

  async insert(
    input: unknown,
    findingInputs: readonly unknown[] = [],
    store: ArtifactStore,
  ): Promise<Result<VerificationRun>> {
    if (!this.#canWrite()) return err('conflict', MAINTENANCE_ACTIVE)
    const parsed = verificationRunSchema.safeParse(input)
    const findings = findingInputs.map((finding) =>
      verificationFindingRecordSchema.safeParse(finding),
    )
    if (!parsed.success || findings.some((finding) => !finding.success)) {
      return err(INVALID_INPUT, 'Verification run or findings are invalid.')
    }
    const value = parsed.data
    if (
      findings.some((finding) => finding.success && finding.data.verificationRunId !== value.id)
    ) {
      return err(INVALID_INPUT, 'Verification findings must belong to the inserted run.')
    }
    if (!this.#bindingsExist(value)) {
      return err(INVALID_INPUT, 'Verification evidence does not match persisted provenance.')
    }
    const report = await validateReportArtifact(
      this.#database,
      value,
      findings.flatMap((finding) => (finding.success ? [finding.data.finding] : [])),
      store,
    )
    if (!report.ok) return report
    if (!this.#canWrite()) return err('conflict', MAINTENANCE_ACTIVE)
    return transaction(this.#database, () => {
      this.#database
        .prepare(`INSERT INTO verification_runs(
        id,simulation_version_id,concept_spec_id,generated_artifact_id,evidence_json,
        concept_artifact_json,artifact_bundle_json,policy_reference_id,domain_pack_reference_id,
        policy_content_hash,domain_pack_content_hash,runner_version,runner_protocol_version,
        dependencies_json,dependencies_hash,observation_hash,report_artifact_id,report_hash,verdict,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          value.id,
          value.simulationVersionId,
          value.conceptSpecId,
          value.generatedArtifactId,
          JSON.stringify(evidenceFromRun(value)),
          JSON.stringify(value.conceptSpecArtifact),
          JSON.stringify(value.artifactBundle),
          value.policyReferenceId,
          value.domainPackReferenceId,
          value.policyContentHash,
          value.domainPackContentHash,
          value.runnerVersion,
          value.runnerProtocolVersion,
          JSON.stringify(value.dependencies),
          value.dependencies.contentHash,
          value.observationHash,
          value.report.artifactId,
          value.report.contentHash,
          value.verdict,
          value.createdAt,
        )
      for (const finding of findings) {
        if (!finding.success) continue
        const record = finding.data
        this.#database
          .prepare(`INSERT INTO verification_findings(
          id,verification_run_id,ordinal,finding_json,created_at
        ) VALUES (?,?,?,?,?)`)
          .run(
            record.id,
            record.verificationRunId,
            record.ordinal,
            JSON.stringify(record.finding),
            record.createdAt,
          )
      }
      return ok(value)
    })
  }

  bindToVersion(input: {
    versionId: string
    expectedRevision: number
    verificationRunId: string
    updatedAt: string
  }): Result<SimulationVersion> {
    if (!this.#canWrite()) return err('conflict', MAINTENANCE_ACTIVE)
    const current = this.#getVersion(input.versionId)
    const run = this.get(input.verificationRunId)
    if (!current.ok) return current
    if (!run.ok) return run
    const authority = this.#validity.recheckAuthority(run.value, current.value)
    if (!authority.ok) return authority
    if (
      current.value.state !== 'verifying' ||
      current.value.revision !== input.expectedRevision ||
      run.value.simulationVersionId !== input.versionId ||
      run.value.conceptSpecId !== current.value.activeConceptSpecId ||
      run.value.generatedArtifactId !== current.value.activeGeneratedArtifactId ||
      !same(run.value.artifactBundle, current.value.activeArtifactBundle)
    ) {
      return err('conflict', 'Verification run does not match the current version revision.')
    }
    const next = simulationVersionSchema.safeParse({
      ...current.value,
      activeVerificationRunId: run.value.id,
      revision: input.expectedRevision + 1,
      updatedAt: input.updatedAt,
    })
    if (!next.success) return err(INVALID_STATE, 'Verification binding is invalid.')
    try {
      const changed = this.#database
        .prepare(`UPDATE simulation_versions SET
        active_verification_run_id=?,revision=?,updated_at=? WHERE id=? AND revision=? AND state='verifying'
      `)
        .run(
          run.value.id,
          next.data.revision,
          next.data.updatedAt,
          next.data.id,
          input.expectedRevision,
        )
      return asCount(changed.changes) === 1
        ? ok(next.data)
        : err('conflict', 'Simulation version revision changed concurrently.')
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  async finalizeVersion(
    input: {
      versionId: string
      expectedRevision: number
      verificationRunId: string
      updatedAt: string
    },
    store: ArtifactStore,
  ): Promise<Result<SimulationVersion>> {
    return await this.#serialize(() => this.#finalizeVersion(input, store))
  }

  async #finalizeVersion(
    input: {
      versionId: string
      expectedRevision: number
      verificationRunId: string
      updatedAt: string
    },
    store: ArtifactStore,
  ): Promise<Result<SimulationVersion>> {
    if (!this.#canWrite()) return err('conflict', MAINTENANCE_ACTIVE)
    const secureValidity = await this.#validity.forFinalization(input.verificationRunId, store)
    if (!secureValidity.ok) return secureValidity
    if (secureValidity.value.status !== 'current') {
      return err(INVALID_STATE, 'Verification evidence is stale or corrupt.')
    }
    if (!this.#canWrite()) return err('conflict', MAINTENANCE_ACTIVE)
    const current = this.#getVersion(input.versionId)
    const run = this.get(input.verificationRunId)
    if (!current.ok) return current
    if (!run.ok) return run
    if (!finalizationMatches(current.value, run.value, input))
      return err('conflict', 'Verification run does not match the current version revision.')
    const state = lifecycleForVerdict(run.value.verdict)
    const next = simulationVersionSchema.safeParse({
      ...current.value,
      state,
      activeVerificationRunId: run.value.id,
      revision: input.expectedRevision + 1,
      updatedAt: input.updatedAt,
    })
    if (!next.success) return err(INVALID_STATE, 'Verification result binding is invalid.')
    try {
      const changed = this.#database
        .prepare(`UPDATE simulation_versions SET
        state=?,active_verification_run_id=?,revision=?,updated_at=?
        WHERE id=? AND revision=? AND state='verifying'`)
        .run(
          next.data.state,
          run.value.id,
          next.data.revision,
          next.data.updatedAt,
          next.data.id,
          input.expectedRevision,
        )
      return asCount(changed.changes) === 1
        ? ok(next.data)
        : err('conflict', 'Simulation version revision changed concurrently.')
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  get(id: string): Result<VerificationRun> {
    const row = this.#database
      .prepare(
        'SELECT evidence_json,simulation_version_id,verdict,created_at FROM verification_runs WHERE id=?',
      )
      .get(id) as
      | {
          evidence_json: string
          simulation_version_id: string
          verdict: string
          created_at: string
        }
      | undefined
    if (row === undefined) return err('not-found', 'Verification run was not found.')
    try {
      const parsed = verificationRunSchema.safeParse({
        id,
        simulationVersionId: row.simulation_version_id,
        ...JSON.parse(row.evidence_json),
        verdict: row.verdict,
        createdAt: row.created_at,
      })
      return parsed.success
        ? ok(parsed.data)
        : err('database-error', 'Stored verification run is invalid.')
    } catch {
      return err('database-error', 'Stored verification evidence is malformed.')
    }
  }

  validity(id: string, currentInput: unknown): Result<ReportValidity> {
    const run = this.get(id)
    if (!run.ok) return run
    return compareEvidence(run.value, currentInput)
  }

  async currentValidity(id: string, store: ArtifactStore): Promise<Result<ReportValidity>> {
    return await this.#serialize(() => this.#validity.current(id, store))
  }

  async publish(
    input: unknown,
    expectedRevision: number,
    store: ArtifactStore,
  ): Promise<Result<PublishedArtifact>> {
    return await this.#serialize(() => this.#publish(input, expectedRevision, store))
  }

  async #publish(
    input: unknown,
    expectedRevision: number,
    store: ArtifactStore,
  ): Promise<Result<PublishedArtifact>> {
    if (!this.#canWrite()) return err('conflict', MAINTENANCE_ACTIVE)
    const command = publicationCommandSchema.safeParse(input)
    if (!command.success) return err(INVALID_INPUT, 'Publication input is invalid.')
    const version = this.#getVersion(command.data.simulationVersionId)
    if (!version.ok) return version
    if (version.value.activeVerificationRunId === null) {
      return err(INVALID_STATE, 'Verified version has no active verification run.')
    }
    const run = this.get(version.value.activeVerificationRunId)
    if (!run.ok) return run
    const publication = publishedArtifactSchema.safeParse({
      ...command.data,
      generatedArtifactId: version.value.activeGeneratedArtifactId,
      artifactBundle: version.value.activeArtifactBundle,
      verificationRunId: version.value.activeVerificationRunId,
      verificationReport: run.value.report,
    })
    if (!publication.success)
      return err(INVALID_STATE, 'Active publication evidence is incomplete.')
    const validity = await this.#validity.current(run.value.id, store)
    if (!validity.ok) return validity
    const authority = this.#validity.recheckAuthority(run.value, version.value)
    if (!authority.ok) return authority
    if (!this.#canWrite()) return err('conflict', MAINTENANCE_ACTIVE)
    if (
      !publicationMatches({
        publication: publication.data,
        version: version.value,
        run: run.value,
        expectedRevision,
        validity: validity.value,
      })
    )
      return err(INVALID_STATE, 'Publishing requires current verified evidence.')
    const next = simulationVersionSchema.parse({
      ...version.value,
      state: 'published',
      revision: expectedRevision + 1,
      updatedAt: publication.data.publishedAt,
    })
    return transaction(this.#database, () => {
      this.#database
        .prepare(`INSERT INTO published_artifacts(
        id,simulation_version_id,generated_artifact_id,artifact_bundle_json,verification_run_id,
        verification_report_artifact_id,verification_report_hash,export_license_json,published_at
      ) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(
          publication.data.id,
          publication.data.simulationVersionId,
          publication.data.generatedArtifactId,
          JSON.stringify(publication.data.artifactBundle),
          publication.data.verificationRunId,
          publication.data.verificationReport.artifactId,
          publication.data.verificationReport.contentHash,
          JSON.stringify(publication.data.exportLicense),
          publication.data.publishedAt,
        )
      const changed = this.#database
        .prepare(`UPDATE simulation_versions SET state='published',revision=?,updated_at=?
        WHERE id=? AND state='verified' AND revision=?`)
        .run(next.revision, next.updatedAt, next.id, expectedRevision)
      return asCount(changed.changes) === 1
        ? ok(publication.data)
        : err('conflict', 'Version changed during publication.')
    })
  }

  #bindingsExist(value: VerificationRun): boolean {
    const count = this.#database
      .prepare(`SELECT COUNT(*) AS count FROM concept_specs c
      JOIN generated_artifacts g ON g.id=? JOIN generation_attempts a ON a.id=g.generation_attempt_id
      JOIN generation_runs gr ON gr.id=a.generation_run_id JOIN verification_policy_references p ON p.id=?
      JOIN domain_pack_references d ON d.id=? JOIN stored_artifacts r ON r.id=?
      WHERE c.id=? AND c.simulation_version_id=? AND c.artifact_id=? AND c.artifact_hash=?
        AND c.generation_run_id=gr.id AND gr.simulation_version_id=?
        AND g.artifact_bundle_json=? AND p.content_hash=? AND d.content_hash=?
        AND r.role='verification-report' AND r.content_hash=?`)
      .get(
        value.generatedArtifactId,
        value.policyReferenceId,
        value.domainPackReferenceId,
        value.report.artifactId,
        value.conceptSpecId,
        value.simulationVersionId,
        value.conceptSpecArtifact.artifactId,
        value.conceptSpecArtifact.contentHash,
        value.simulationVersionId,
        JSON.stringify(value.artifactBundle),
        value.policyContentHash,
        value.domainPackContentHash,
        value.report.contentHash,
      ) as { count: number }
    return count.count === 1
  }
}
