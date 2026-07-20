import {
  type ConceptSpec,
  conceptSpecSchema,
  type EducatorVersionDetail,
  type FindingExplanation,
  type PortableSimulationExport,
  type ReportValidity,
  type SimulationVersion,
  type VerificationReport,
  type VerificationReportDisplay,
  verificationReportDisplaySchema,
  verificationReportSchema,
} from '@simproof/contracts'
import type {
  ArtifactStore,
  InstalledEvidenceResolver,
  PersistenceDatabase,
  VerificationRun,
} from '@simproof/persistence'
import type { FindingExplainer } from '@simproof/providers'
import { getDomainPack, hashCanonicalJson, isPublishable } from '@simproof/verifier'

import type { HttpOperationResult } from '../http/types.js'
import { generationProvenanceFor } from './generation-provenance.js'
import {
  actionsFor,
  type LibraryVersionSummary,
  narrationFor,
  type ReportContent,
  summaryFor,
  type VersionEvidence,
} from './report-projection-support.js'
import { failed, fromPersistence, succeeded } from './results.js'

const OPERATION_FAILED = 'operation-failed' as const

export type ComparisonEvidence = Pick<VerificationReportDisplay, 'publication'> &
  Pick<
    VerificationReport,
    'assumptions' | 'domainPack' | 'findings' | 'limitations' | 'policy' | 'runner'
  >

export class EducatorReportProjection {
  readonly #narrationCache = new Map<string, FindingExplanation>()

  constructor(
    readonly database: PersistenceDatabase,
    readonly artifacts: ArtifactStore,
    readonly resolveInstalledEvidence: InstalledEvidenceResolver | undefined,
    readonly explainer?: FindingExplainer,
  ) {}

  async display(versionId: string): Promise<HttpOperationResult<VerificationReportDisplay>> {
    const stored = this.database.getVersion(versionId)
    if (!stored.ok) return fromPersistence(stored)
    const refreshed = await this.#refreshValidity(stored.value)
    if (!refreshed.ok) return refreshed
    const version = refreshed.value
    const runId = version.activeVerificationRunId
    if (runId === null) return failed('not-found', 'This version has no verification report.')
    const run = this.database.verification.get(runId)
    if (!run.ok) return fromPersistence(run)
    if (run.value.simulationVersionId !== version.id) {
      return failed(OPERATION_FAILED, 'Verification evidence crosses version ownership.')
    }
    const exported = await this.database.maintenance.exportSimulation(
      version.simulationId,
      this.artifacts,
    )
    if (!exported.ok) return fromPersistence(exported)
    return await this.#assemble(version, run.value, exported.value)
  }

  async versionDetail(
    version: SimulationVersion,
  ): Promise<HttpOperationResult<EducatorVersionDetail>> {
    const refreshed = await this.#refreshValidity(version)
    if (!refreshed.ok) return refreshed
    const current = refreshed.value
    const exported = await this.database.maintenance.exportSimulation(
      current.simulationId,
      this.artifacts,
    )
    if (!exported.ok) return fromPersistence(exported)
    const evidence = await this.#versionEvidence(current, exported.value)
    if (!evidence.ok) return evidence
    const provenance = generationProvenanceFor(this.database, current, exported.value)
    if (!provenance.ok) return provenance
    const lineage = this.database.educator.duplicateLineage(current.id)
    if (!lineage.ok) return fromPersistence(lineage)
    return succeeded({
      summary: evidence.value.summary,
      conceptSpec: evidence.value.conceptSpec,
      exportLicense: evidence.value.exportLicense,
      generationProvenance: provenance.value,
      lineage:
        lineage.value === null
          ? null
          : {
              kind: 'duplicate',
              sourceSimulationId: lineage.value.sourceSimulationId,
              sourceVersionId: lineage.value.sourceVersionId,
              sourceVersionNumber: lineage.value.sourceVersionNumber,
              sourceRevision: lineage.value.sourceRevision,
              duplicatedAt: lineage.value.createdAt,
            },
      availableActions: actionsFor(current, evidence.value.summary.verification.status),
      createdAt: current.createdAt,
    })
  }

  async comparisonEvidence(
    versionId: string,
  ): Promise<HttpOperationResult<ComparisonEvidence | null>> {
    const version = this.database.getVersion(versionId)
    if (!version.ok) return fromPersistence(version)
    if (version.value.activeVerificationRunId === null) return succeeded(null)
    const display = await this.display(versionId)
    return display.ok
      ? succeeded({
          policy: display.value.report.policy,
          domainPack: display.value.report.domainPack,
          runner: display.value.report.runner,
          findings: display.value.report.findings,
          assumptions: display.value.report.assumptions,
          limitations: display.value.report.limitations,
          publication: display.value.publication,
        })
      : display
  }

  async #versionEvidence(
    version: SimulationVersion,
    exported: PortableSimulationExport,
  ): Promise<HttpOperationResult<VersionEvidence>> {
    const conceptRecord = exported.records.conceptSpecs.find(
      ({ id }) => id === version.activeConceptSpecId,
    )
    const generated = exported.records.generatedArtifacts.find(
      ({ id }) => id === version.activeGeneratedArtifactId,
    )
    if (version.activeVerificationRunId === null) {
      const concept = await this.#unverifiedConcept(conceptRecord)
      if (!concept.ok) return concept
      return succeeded({
        summary: summaryFor(version, concept.value?.domain ?? null, { status: 'none' }),
        conceptSpec: concept.value,
        exportLicense: generated?.exportLicense ?? null,
      })
    }
    const run = this.database.verification.get(version.activeVerificationRunId)
    if (!run.ok) return fromPersistence(run)
    const content = await this.#content(run.value)
    if (!content.ok) return content
    const validity = this.#validity(version, run.value)
    if (!validity.ok) return validity
    const common = {
      verificationRunId: run.value.id,
      verdict: run.value.verdict,
      artifactHash: run.value.artifactBundle.core.contentHash,
      reportHash: run.value.report.contentHash,
    }
    const verification: LibraryVersionSummary['verification'] =
      validity.value.status === 'stale'
        ? { status: 'stale', ...common, reasons: validity.value.reasons }
        : { status: 'current', ...common }
    return succeeded({
      summary: summaryFor(version, content.value.conceptSpec.domain, verification),
      conceptSpec: content.value.conceptSpec,
      exportLicense: generated?.exportLicense ?? null,
    })
  }

  async #unverifiedConcept(
    record: PortableSimulationExport['records']['conceptSpecs'][number] | undefined,
  ): Promise<HttpOperationResult<ConceptSpec | null>> {
    if (record === undefined) return succeeded(null)
    const artifact = await this.artifacts.get(record.artifact.contentHash)
    if (!artifact.ok) return fromPersistence(artifact)
    try {
      return succeeded(conceptSpecSchema.parse(JSON.parse(artifact.value.toString('utf8'))))
    } catch {
      return failed(OPERATION_FAILED, 'Editable concept content is invalid.')
    }
  }

  async #assemble(
    version: SimulationVersion,
    run: VerificationRun,
    exported: PortableSimulationExport,
  ): Promise<HttpOperationResult<VerificationReportDisplay>> {
    const content = await this.#content(run)
    if (!content.ok) return content
    const validity = this.#validity(version, run)
    if (!validity.ok) return validity
    const publicationRecord = exported.records.publications.find(
      ({ simulationVersionId, verificationRunId }) =>
        simulationVersionId === version.id && verificationRunId === run.id,
    )
    const publication = validity.value.status === 'current' ? publicationRecord : undefined
    const currentVerified = isPublishable(run, validity.value)
    const narration = await narrationFor({
      explainer: this.explainer,
      cache: this.#narrationCache,
      run,
      conceptSpec: content.value.conceptSpec,
      report: content.value.report,
    })
    const display = verificationReportDisplaySchema.safeParse({
      simulationVersionId: version.id,
      verificationRunId: run.id,
      reportArtifactHash: run.report.contentHash,
      versionRevision: version.revision,
      conceptSpec: content.value.conceptSpec,
      report: content.value.report,
      validity: validity.value,
      policy: content.value.policy,
      publication:
        publication === undefined
          ? { published: false }
          : {
              published: true,
              publishedAt: publication.publishedAt,
              exportLicense: publication.exportLicense,
            },
      badgeActive: currentVerified,
      publishable: currentVerified && version.state === 'verified' && publication === undefined,
      ...(narration === undefined ? {} : { narration }),
    })
    return display.success
      ? succeeded(display.data)
      : failed(OPERATION_FAILED, 'Verification display bindings are invalid.')
  }

  async #content(run: VerificationRun): Promise<HttpOperationResult<ReportContent>> {
    const [conceptObject, reportObject] = await Promise.all([
      this.artifacts.get(run.conceptSpecArtifact.contentHash),
      this.artifacts.get(run.report.contentHash),
    ])
    if (!conceptObject.ok) return fromPersistence(conceptObject)
    if (!reportObject.ok) return fromPersistence(reportObject)
    try {
      const conceptSpec = conceptSpecSchema.parse(JSON.parse(conceptObject.value.toString('utf8')))
      const report = verificationReportSchema.parse(JSON.parse(reportObject.value.toString('utf8')))
      const pack = getDomainPack(conceptSpec.domain)
      if (
        pack === undefined ||
        hashCanonicalJson(pack.policy) !== run.policyContentHash ||
        pack.contentHash !== run.domainPackContentHash ||
        report.conceptSpecHash !== run.conceptSpecArtifact.contentHash ||
        report.artifact.hash !== run.artifactBundle.core.contentHash
      ) {
        return failed(OPERATION_FAILED, 'Installed verification bindings differ.')
      }
      return succeeded({ conceptSpec, report, policy: pack.policy })
    } catch {
      return failed(OPERATION_FAILED, 'Verification artifacts are invalid.')
    }
  }

  #validity(version: SimulationVersion, run: VerificationRun): HttpOperationResult<ReportValidity> {
    const installed = this.resolveInstalledEvidence?.(run)
    if (installed === undefined || !installed.ok) {
      return failed(OPERATION_FAILED, 'Installed verification authority is unavailable.')
    }
    return fromPersistence(
      this.database.verification.validity(run.id, {
        conceptSpecId: version.activeConceptSpecId,
        conceptSpecArtifact: run.conceptSpecArtifact,
        generatedArtifactId: version.activeGeneratedArtifactId,
        artifactBundle: version.activeArtifactBundle,
        observationHash: run.observationHash,
        report: run.report,
        ...installed.value,
      }),
    )
  }

  async #refreshValidity(
    version: SimulationVersion,
  ): Promise<HttpOperationResult<SimulationVersion>> {
    if (
      version.activeVerificationRunId === null ||
      !['published', 'verified'].includes(version.state)
    ) {
      return succeeded(version)
    }
    const checked = await this.database.verification.currentValidity(
      version.activeVerificationRunId,
      this.artifacts,
    )
    if (checked.ok) return succeeded(version)
    const refreshed = this.database.getVersion(version.id)
    if (!refreshed.ok) return fromPersistence(refreshed)
    return refreshed.value.state === 'stale' ? succeeded(refreshed.value) : fromPersistence(checked)
  }
}
