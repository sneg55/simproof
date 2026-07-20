import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { type TeacherPrivacyExport, teacherPrivacyExportSchema } from '@simproof/contracts'
import type {
  ArtifactStore,
  PersistenceDatabase,
  PrivacyRepository,
  PrivacySettings,
} from '@simproof/persistence'
import { MAX_TEACHER_PRIVACY_EXPORT_BYTES } from '@simproof/persistence'

export type PrivacyErrorCode =
  | 'confirmation-failed'
  | 'conflict'
  | 'invalid-input'
  | 'operation-failed'

export type PrivacyResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly error: { readonly code: PrivacyErrorCode; readonly message: string }
    }

const success = <T>(value: T): PrivacyResult<T> => ({ ok: true, value })
const OPERATION_FAILED = 'operation-failed' as const
const OPERATION_FAILED_MESSAGE = 'Privacy operation failed.'
const failure = (code: PrivacyErrorCode, message: string): PrivacyResult<never> => ({
  ok: false,
  error: { code, message },
})

interface PrivacyServiceOptions {
  readonly database: PersistenceDatabase
  readonly artifacts: ArtifactStore
  readonly privacy: PrivacyRepository
  readonly confirmPassword: (password: string) => Promise<boolean>
  readonly now?: () => number
  readonly telemetryEnabled: boolean
  readonly externalDiagnosticsAllowed: boolean
  readonly maxExportBytes?: number
}

export class PrivacyService {
  readonly #database: PersistenceDatabase
  readonly #artifacts: ArtifactStore
  readonly #privacy: PrivacyRepository
  readonly #confirmPassword: (password: string) => Promise<boolean>
  readonly #now: () => number
  readonly #telemetryEnabled: boolean
  readonly #externalDiagnosticsAllowed: boolean
  readonly #maxExportBytes: number

  constructor(options: PrivacyServiceOptions) {
    this.#database = options.database
    this.#artifacts = options.artifacts
    this.#privacy = options.privacy
    this.#confirmPassword = options.confirmPassword
    this.#now = options.now ?? Date.now
    this.#telemetryEnabled = options.telemetryEnabled
    this.#externalDiagnosticsAllowed = options.externalDiagnosticsAllowed
    this.#maxExportBytes = options.maxExportBytes ?? MAX_TEACHER_PRIVACY_EXPORT_BYTES
  }

  settings(): PrivacyResult<PrivacySettings & { readonly telemetryEnabled: boolean }> {
    const settings = this.#privacy.settings()
    return settings.ok
      ? success({ ...settings.value, telemetryEnabled: this.#telemetryEnabled })
      : failure(OPERATION_FAILED, OPERATION_FAILED_MESSAGE)
  }

  updateSettings(input: {
    readonly expectedRevision: number
    readonly promptRetentionEnabled: boolean
    readonly externalDiagnosticsEnabled: boolean
  }): PrivacyResult<PrivacySettings & { readonly telemetryEnabled: boolean }> {
    if (input.externalDiagnosticsEnabled && !this.#externalDiagnosticsAllowed) {
      return failure('invalid-input', 'External diagnostics are unavailable.')
    }
    const updated = this.#privacy.updateSettings({ ...input, updatedAt: this.#timestamp() })
    if (updated.ok) return success({ ...updated.value, telemetryEnabled: this.#telemetryEnabled })
    return updated.error.code === 'conflict'
      ? failure('conflict', 'Privacy settings changed.')
      : failure(OPERATION_FAILED, OPERATION_FAILED_MESSAGE)
  }

  retainPrompt(
    simulationId: string,
    prompt: string,
  ): PrivacyResult<{ readonly retained: boolean }> {
    return this.#retainPrompt(randomUUID(), simulationId, prompt)
  }

  retainGenerationPrompt(input: {
    readonly generationRunId: string
    readonly simulationVersionId: string
    readonly prompt: string
  }): PrivacyResult<{ readonly retained: boolean }> {
    const version = this.#database.getVersion(input.simulationVersionId)
    return version.ok
      ? this.#retainPrompt(input.generationRunId, version.value.simulationId, input.prompt)
      : failure(OPERATION_FAILED, OPERATION_FAILED_MESSAGE)
  }

  #retainPrompt(
    id: string,
    simulationId: string,
    prompt: string,
  ): PrivacyResult<{ readonly retained: boolean }> {
    const settings = this.#privacy.settings()
    if (!settings.ok) return failure(OPERATION_FAILED, OPERATION_FAILED_MESSAGE)
    if (!settings.value.promptRetentionEnabled) return success({ retained: false })
    const stored = this.#privacy.storePrompt({
      id,
      simulationId,
      prompt,
      createdAt: this.#timestamp(),
    })
    if (stored.ok) return success({ retained: true })
    return stored.error.code === 'conflict'
      ? failure('conflict', 'Retained prompt identity belongs to different content.')
      : failure(OPERATION_FAILED, OPERATION_FAILED_MESSAGE)
  }

  async exportAll(password: string): Promise<PrivacyResult<TeacherPrivacyExport>> {
    if (!(await this.#confirmed(password))) return this.#confirmationFailure()
    const snapshot = await this.#database.maintenance.exportTeacherPrivacySnapshot(
      this.#artifacts,
      this.#maxExportBytes,
    )
    if (!snapshot.ok) {
      return failure(OPERATION_FAILED, OPERATION_FAILED_MESSAGE)
    }
    const parsed = teacherPrivacyExportSchema.safeParse({
      schemaVersion: '1',
      exportedAt: this.#timestamp(),
      privacySettings: {
        ...snapshot.value.privacySettings,
        telemetryEnabled: this.#telemetryEnabled,
      },
      retainedPrompts: snapshot.value.retainedPrompts,
      simulations: snapshot.value.simulations,
    })
    if (
      !parsed.success ||
      Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > this.#maxExportBytes
    ) {
      return failure(OPERATION_FAILED, OPERATION_FAILED_MESSAGE)
    }
    return success(parsed.data)
  }

  async deleteSimulation(
    simulationId: string,
    password: string,
  ): Promise<
    PrivacyResult<{
      readonly deletedArtifacts: readonly string[]
      readonly deferredArtifacts: readonly string[]
    }>
  > {
    if (!(await this.#confirmed(password))) return this.#confirmationFailure()
    const deleted = await this.#database.maintenance.deleteSimulation(simulationId, this.#artifacts)
    return deleted.ok
      ? success({
          deletedArtifacts: deleted.value.deletedArtifacts,
          deferredArtifacts: deleted.value.deferredArtifacts,
        })
      : failure(OPERATION_FAILED, OPERATION_FAILED_MESSAGE)
  }

  async #confirmed(password: string): Promise<boolean> {
    if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 1_024) return false
    try {
      return await this.#confirmPassword(password)
    } catch {
      return false
    }
  }

  #confirmationFailure(): PrivacyResult<never> {
    return failure('confirmation-failed', 'Password confirmation failed.')
  }

  #timestamp(): string {
    return new Date(this.#now()).toISOString()
  }
}

export function createDiagnosticsDispatcher(
  settings: { readonly telemetryEnabled: boolean; readonly externalDiagnosticsEnabled: boolean },
  factory: () => (event: { readonly event: string }) => Promise<void>,
): (event: { readonly event: string }) => Promise<void> {
  if (!settings.telemetryEnabled && !settings.externalDiagnosticsEnabled) {
    return () => Promise.resolve()
  }
  const dispatch = factory()
  return async (event) => await dispatch({ event: event.event })
}
