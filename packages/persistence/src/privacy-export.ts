import { Buffer } from 'node:buffer'
import type { DatabaseSync } from 'node:sqlite'

import type { ArtifactStore } from './artifact-store.js'
import type { PrivacySettings, RetainedPrompt } from './privacy-repository.js'
import { type ExportedSimulation, err, ok, type Result } from './types.js'

export const MAX_TEACHER_PRIVACY_EXPORT_BYTES = 67_108_864

export interface TeacherPrivacySnapshot {
  readonly privacySettings: PrivacySettings
  readonly retainedPrompts: readonly RetainedPrompt[]
  readonly simulations: readonly ExportedSimulation[]
}

interface SettingsRow {
  prompt_retention_enabled: number
  external_diagnostics_enabled: number
  revision: number
  updated_at: string
}

interface PromptRow {
  id: string
  simulation_id: string
  prompt_text: string
  created_at: string
}

const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8')

export class ExportByteBudget {
  #used = 1_024

  constructor(readonly limit: number) {}

  get remaining(): number {
    return this.limit - this.#used
  }

  consumeJson(value: unknown): Result<true> {
    const bytes = jsonBytes(value) + 1
    if (bytes > this.remaining) {
      return err('invalid-input', 'Teacher privacy export exceeds its aggregate byte limit.')
    }
    this.#used += bytes
    return ok(true)
  }
}

export class TeacherPrivacyExporter {
  readonly #database: DatabaseSync
  readonly #exclusive: <T>(operation: () => Promise<Result<T>>) => Promise<Result<T>>
  readonly #exportSimulation: (
    id: string,
    store: ArtifactStore,
    budget: ExportByteBudget,
  ) => Promise<Result<ExportedSimulation>>

  constructor(options: {
    database: DatabaseSync
    exclusive: <T>(operation: () => Promise<Result<T>>) => Promise<Result<T>>
    exportSimulation: (
      id: string,
      store: ArtifactStore,
      budget: ExportByteBudget,
    ) => Promise<Result<ExportedSimulation>>
  }) {
    this.#database = options.database
    this.#exclusive = options.exclusive
    this.#exportSimulation = options.exportSimulation
  }

  async export(store: ArtifactStore, maxBytes: number): Promise<Result<TeacherPrivacySnapshot>> {
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > MAX_TEACHER_PRIVACY_EXPORT_BYTES
    ) {
      return err('invalid-input', 'Teacher privacy export byte limit is invalid.')
    }
    return await this.#exclusive(async () => await this.#exportSnapshot(store, maxBytes))
  }

  async #exportSnapshot(
    store: ArtifactStore,
    maxBytes: number,
  ): Promise<Result<TeacherPrivacySnapshot>> {
    try {
      if (this.#preflightLowerBound() > maxBytes) return this.#tooLarge()
      const promptSize = this.#database
        .prepare(`SELECT COUNT(*) AS count,
          COALESCE(SUM(length(CAST(prompt_text AS BLOB))),0) AS bytes FROM retained_prompts`)
        .get() as { count: number; bytes: number }
      const simulationCount = this.#database
        .prepare('SELECT COUNT(*) AS count FROM simulations')
        .get() as { count: number }
      if (
        promptSize.count > 100_000 ||
        simulationCount.count > 100_000 ||
        promptSize.bytes > maxBytes
      ) {
        return err('invalid-input', 'Teacher privacy export exceeds its aggregate byte limit.')
      }

      const budget = new ExportByteBudget(maxBytes)
      const settings = this.#settings()
      const settingsBudget = budget.consumeJson(settings)
      if (!settingsBudget.ok) return settingsBudget
      const retainedPrompts = this.#prompts(budget)
      if (!retainedPrompts.ok) return retainedPrompts
      const simulationIds = this.#simulationIds(budget)
      if (!simulationIds.ok) return simulationIds
      const simulations: ExportedSimulation[] = []

      for (const simulationId of simulationIds.value) {
        const exported = await this.#exportSimulation(simulationId, store, budget)
        if (!exported.ok) return exported
        simulations.push(exported.value)
      }
      const snapshot = {
        privacySettings: settings,
        retainedPrompts: retainedPrompts.value,
        simulations,
      }
      return jsonBytes(snapshot) <= maxBytes ? ok(snapshot) : this.#tooLarge()
    } catch {
      return err('database-error', 'Teacher privacy export failed.')
    }
  }

  #settings(): PrivacySettings {
    const row = this.#database
      .prepare('SELECT * FROM privacy_settings WHERE singleton=1')
      .get() as unknown as SettingsRow
    return {
      promptRetentionEnabled: row.prompt_retention_enabled === 1,
      externalDiagnosticsEnabled: row.external_diagnostics_enabled === 1,
      revision: row.revision,
      updatedAt: row.updated_at,
    }
  }

  #prompts(budget: ExportByteBudget): Result<readonly RetainedPrompt[]> {
    const rows = this.#database
      .prepare('SELECT * FROM retained_prompts ORDER BY created_at ASC,id ASC')
      .iterate() as unknown as Iterable<PromptRow>
    const prompts: RetainedPrompt[] = []
    for (const row of rows) {
      const prompt = {
        id: row.id,
        simulationId: row.simulation_id,
        prompt: row.prompt_text,
        createdAt: row.created_at,
      }
      const consumed = budget.consumeJson(prompt)
      if (!consumed.ok) return consumed
      prompts.push(prompt)
    }
    return ok(prompts)
  }

  #simulationIds(budget: ExportByteBudget): Result<readonly string[]> {
    const rows = this.#database
      .prepare('SELECT id FROM simulations ORDER BY created_at ASC,id ASC')
      .iterate() as unknown as Iterable<{ id: string }>
    const ids: string[] = []
    for (const { id } of rows) {
      const consumed = budget.consumeJson(id)
      if (!consumed.ok) return consumed
      ids.push(id)
    }
    return ok(ids)
  }

  #preflightLowerBound(): number {
    const row = this.#database
      .prepare(`SELECT
        (SELECT COALESCE(SUM(byte_length + 2),0) FROM stored_artifacts s WHERE
          EXISTS(SELECT 1 FROM concept_specs c WHERE c.artifact_id=s.id) OR
          EXISTS(SELECT 1 FROM generated_artifacts g WHERE s.id IN(g.core_artifact_id,g.renderer_artifact_id,g.manifest_artifact_id)) OR
          EXISTS(SELECT 1 FROM verification_runs v WHERE v.report_artifact_id=s.id))
        + (SELECT COALESCE(SUM(length(CAST(prompt_text AS BLOB)) + 2),0) FROM retained_prompts)
        + (SELECT COALESCE(SUM(length(CAST(title AS BLOB)) + 2),0) FROM simulations)
        + (SELECT COALESCE(SUM(length(CAST(COALESCE(active_artifact_bundle_json,'') AS BLOB)) + 2),0) FROM simulation_versions)
        + (SELECT COALESCE(SUM(length(CAST(COALESCE(codex_session_id,'') AS BLOB)) + 2),0) FROM generation_runs)
        + (SELECT COUNT(*) * 2 FROM generation_attempts)
        + (SELECT COUNT(*) * 2 FROM concept_specs)
        + (SELECT COALESCE(SUM(length(CAST(artifact_bundle_json AS BLOB)) + length(CAST(export_license_json AS BLOB)) + 2),0) FROM generated_artifacts)
        + (SELECT COUNT(*) * 2 FROM verification_policy_references p
           WHERE EXISTS(SELECT 1 FROM verification_runs v WHERE v.policy_reference_id=p.id))
        + (SELECT COUNT(*) * 2 FROM domain_pack_references d
           WHERE EXISTS(SELECT 1 FROM verification_runs v WHERE v.domain_pack_reference_id=d.id))
        + (SELECT COALESCE(SUM(length(CAST(evidence_json AS BLOB)) + 2),0) FROM verification_runs)
        + (SELECT COALESCE(SUM(length(CAST(finding_json AS BLOB)) + 2),0) FROM verification_findings)
        + (SELECT COALESCE(SUM(length(CAST(artifact_bundle_json AS BLOB)) + length(CAST(export_license_json AS BLOB)) + 2),0) FROM published_artifacts)
        AS bytes`)
      .get() as { bytes: number }
    return row.bytes
  }

  #tooLarge(): Result<never> {
    return err('invalid-input', 'Teacher privacy export exceeds its aggregate byte limit.')
  }
}
