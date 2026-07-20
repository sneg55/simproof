import type {
  ArtifactBundle,
  ConceptSpec,
  Sha256,
  StoredArtifactRole,
  VerificationDependencyBinding,
  VerificationReport,
} from '@simproof/contracts'
import type { ArtifactStore, PersistenceDatabase } from '@simproof/persistence'

import type { GeneratedArtifactSet } from './pipeline-types.js'

export class GenerationArtifactWriteError extends TypeError {
  readonly code: string

  constructor(code: string) {
    super(`Generation artifact persistence failed (${code}).`)
    this.name = 'GenerationArtifactWriteError'
    this.code = code
  }
}

interface GenerationArtifactWriterOptions {
  readonly database: PersistenceDatabase
  readonly store: ArtifactStore
  readonly id: () => string
}

const unwrap = <T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string } },
): T => {
  if (result.ok) return result.value
  throw new GenerationArtifactWriteError(result.error.code)
}

export class GenerationArtifactWriter {
  readonly #database: PersistenceDatabase
  readonly #store: ArtifactStore
  readonly #id: () => string
  readonly #concepts = new Map<
    string,
    {
      readonly id: string
      readonly artifact: {
        readonly artifactId: string
        readonly role: 'concept-spec'
        readonly contentHash: Sha256
      }
    }
  >()

  constructor(options: GenerationArtifactWriterOptions) {
    this.#database = options.database
    this.#store = options.store
    this.#id = options.id
  }

  get store(): ArtifactStore {
    return this.#store
  }

  async #stored(
    role: StoredArtifactRole,
    content: unknown,
    createdAt: string,
  ): Promise<{
    readonly id: string
    readonly role: StoredArtifactRole
    readonly contentHash: Sha256
  }> {
    const isSource = role === 'core-source' || role === 'renderer-source'
    if (isSource && typeof content !== 'string') {
      throw new GenerationArtifactWriteError('source-content-invalid')
    }
    const stored = isSource
      ? await this.#store.putSource(content as string, { normalizationVersion: 1 })
      : await this.#store.putJson(content, { normalizationVersion: 1 })
    const object = unwrap(stored)
    const id = this.#id()
    unwrap(
      await this.#database.records.insertStoredArtifact(
        {
          id,
          role,
          contentHash: object.hash,
          mediaType: isSource ? 'text/javascript' : 'application/json',
          byteLength: object.byteLength,
          normalizationVersion: 1,
          createdAt,
        },
        this.#store,
      ),
    )
    return { id, role, contentHash: object.hash }
  }

  async recordConcept(input: {
    readonly runId: string
    readonly simulationVersionId: string
    readonly conceptSpec: ConceptSpec
    readonly createdAt: string
  }): Promise<{ readonly id: string; readonly hash: `sha256:${string}` }> {
    const artifact = await this.#stored(
      'concept-spec',
      JSON.stringify(input.conceptSpec),
      input.createdAt,
    )
    const id = this.#id()
    const binding = {
      artifactId: artifact.id,
      role: 'concept-spec' as const,
      contentHash: artifact.contentHash,
    }
    unwrap(
      this.#database.records.insertConceptSpec({
        id,
        simulationVersionId: input.simulationVersionId,
        generationRunId: input.runId,
        schemaVersion: input.conceptSpec.schemaVersion,
        domain: input.conceptSpec.domain,
        artifact: binding,
        createdAt: input.createdAt,
      }),
    )
    this.#concepts.set(input.runId, { id, artifact: binding })
    return { id, hash: artifact.contentHash as `sha256:${string}` }
  }

  restoreConcept(input: {
    readonly runId: string
    readonly conceptSpecId: string
    readonly artifactId: string
    readonly hash: Sha256
  }): void {
    this.#concepts.set(input.runId, {
      id: input.conceptSpecId,
      artifact: { artifactId: input.artifactId, role: 'concept-spec', contentHash: input.hash },
    })
  }

  async recordCandidate(input: {
    readonly runId: string
    readonly simulationVersionId: string
    readonly attemptId: string
    readonly artifacts: GeneratedArtifactSet
    readonly createdAt: string
  }): Promise<{ readonly generatedArtifactId: string; readonly bundle: ArtifactBundle }> {
    const [core, renderer, manifest] = await Promise.all([
      this.#stored('core-source', input.artifacts.core.content, input.createdAt),
      this.#stored('renderer-data', input.artifacts.renderer.content, input.createdAt),
      this.#stored('manifest', input.artifacts.manifest.content, input.createdAt),
    ])
    const bundle: ArtifactBundle = {
      core: { artifactId: core.id, role: 'core-source', contentHash: core.contentHash },
      renderer: {
        artifactId: renderer.id,
        role: 'renderer-data',
        contentHash: renderer.contentHash,
      },
      manifest: {
        artifactId: manifest.id,
        role: 'manifest',
        contentHash: manifest.contentHash,
      },
    }
    const generatedArtifactId = this.#id()
    unwrap(
      this.#database.records.insertGeneratedArtifact({
        id: generatedArtifactId,
        generationAttemptId: input.attemptId,
        artifactBundle: bundle,
        exportLicense: { kind: 'none' },
        createdAt: input.createdAt,
      }),
    )
    const concept = this.#concepts.get(input.runId)
    if (concept === undefined) throw new GenerationArtifactWriteError('concept-not-recorded')
    const version = unwrap(this.#database.getVersion(input.simulationVersionId))
    unwrap(
      this.#database.bindCandidate({
        id: version.id,
        expectedRevision: version.revision,
        conceptSpecId: concept.id,
        generatedArtifactId,
        artifactBundle: bundle,
        updatedAt: input.createdAt,
      }),
    )
    return { generatedArtifactId, bundle }
  }

  async recordVerification(input: {
    readonly runId: string
    readonly simulationVersionId: string
    readonly report: VerificationReport
    readonly dependencies: VerificationDependencyBinding
    readonly createdAt: string
  }): Promise<{ readonly verificationRunId: string; readonly findingsReference: string }> {
    const concept = this.#concepts.get(input.runId)
    const version = unwrap(this.#database.getVersion(input.simulationVersionId))
    if (
      concept === undefined ||
      version.activeGeneratedArtifactId === null ||
      version.activeArtifactBundle === null
    ) {
      throw new GenerationArtifactWriteError('candidate-not-bound')
    }
    const policy = unwrap(
      this.#database.records.ensurePolicyReference({
        id: this.#id(),
        policyId: input.report.policy.id,
        version: input.report.policy.version,
        contentHash: input.report.policy.contentHash,
        createdAt: input.createdAt,
      }),
    )
    const domainPack = unwrap(
      this.#database.records.ensureDomainPackReference({
        id: this.#id(),
        domainPackId: input.report.domainPack.id,
        version: input.report.domainPack.version,
        contentHash: input.report.domainPack.contentHash,
        createdAt: input.createdAt,
      }),
    )
    if (input.report.conceptSpecHash !== concept.artifact.contentHash) {
      throw new GenerationArtifactWriteError('concept-report-hash-mismatch')
    }
    if (input.report.artifact.hash !== version.activeArtifactBundle.core.contentHash) {
      throw new GenerationArtifactWriteError('core-report-hash-mismatch')
    }
    if (
      input.report.policy.id !== policy.policyId ||
      input.report.policy.version !== policy.version ||
      input.report.policy.contentHash !== policy.contentHash
    ) {
      throw new GenerationArtifactWriteError('policy-report-binding-mismatch')
    }
    if (
      input.report.domainPack.id !== domainPack.domainPackId ||
      input.report.domainPack.version !== domainPack.version ||
      input.report.domainPack.contentHash !== domainPack.contentHash
    ) {
      throw new GenerationArtifactWriteError('domain-report-binding-mismatch')
    }
    const report = await this.#stored('verification-report', input.report, input.createdAt)
    const verificationRunId = this.#id()
    unwrap(
      await this.#database.verification.insert(
        {
          id: verificationRunId,
          simulationVersionId: version.id,
          conceptSpecId: concept.id,
          conceptSpecArtifact: concept.artifact,
          generatedArtifactId: version.activeGeneratedArtifactId,
          artifactBundle: version.activeArtifactBundle,
          policyReferenceId: policy.id,
          domainPackReferenceId: domainPack.id,
          policyContentHash: policy.contentHash,
          domainPackContentHash: domainPack.contentHash,
          runnerVersion: input.report.runner.version,
          runnerProtocolVersion: input.report.runner.protocolVersion,
          dependencies: input.dependencies,
          observationHash: input.report.observationHash,
          report: {
            artifactId: report.id,
            role: 'verification-report',
            contentHash: report.contentHash,
          },
          verdict: input.report.verdict,
          createdAt: input.createdAt,
        },
        input.report.findings.map((finding, ordinal) => ({
          id: this.#id(),
          verificationRunId,
          ordinal,
          finding,
          createdAt: input.createdAt,
        })),
        this.#store,
      ),
    )
    return { verificationRunId, findingsReference: report.contentHash }
  }
}
