import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { createPersistence } from '@simproof/persistence'
import { describe, expect, it } from 'vitest'

const plan004Fields = {
  schema_migrations: ['version', 'name', 'checksum', 'applied_at'],
  simulations: ['id', 'title', 'created_at', 'updated_at'],
  stored_artifacts: [
    'id',
    'role',
    'content_hash',
    'media_type',
    'byte_length',
    'normalization_version',
    'created_at',
  ],
  simulation_versions: [
    'id',
    'simulation_id',
    'version_number',
    'state',
    'revision',
    'active_concept_spec_id',
    'active_generated_artifact_id',
    'active_artifact_bundle_json',
    'active_verification_run_id',
    'created_at',
    'updated_at',
  ],
  generation_runs: [
    'id',
    'simulation_version_id',
    'status',
    'max_attempts',
    'codex_session_id',
    'created_at',
    'completed_at',
  ],
  generation_attempts: [
    'id',
    'generation_run_id',
    'attempt_number',
    'outcome',
    'generated_artifact_id',
    'stable_error_id',
    'created_at',
    'completed_at',
  ],
  concept_specs: [
    'id',
    'simulation_version_id',
    'generation_run_id',
    'schema_version',
    'domain',
    'artifact_id',
    'artifact_hash',
    'created_at',
  ],
  generated_artifacts: [
    'id',
    'generation_attempt_id',
    'artifact_bundle_json',
    'core_artifact_id',
    'renderer_artifact_id',
    'manifest_artifact_id',
    'export_license_json',
    'created_at',
  ],
  verification_policy_references: ['id', 'policy_id', 'version', 'content_hash', 'created_at'],
  domain_pack_references: ['id', 'domain_pack_id', 'version', 'content_hash', 'created_at'],
  verification_runs: [
    'id',
    'simulation_version_id',
    'concept_spec_id',
    'generated_artifact_id',
    'evidence_json',
    'concept_artifact_json',
    'artifact_bundle_json',
    'policy_reference_id',
    'domain_pack_reference_id',
    'policy_content_hash',
    'domain_pack_content_hash',
    'runner_version',
    'runner_protocol_version',
    'dependencies_json',
    'dependencies_hash',
    'observation_hash',
    'report_artifact_id',
    'report_hash',
    'verdict',
    'created_at',
  ],
  verification_findings: ['id', 'verification_run_id', 'ordinal', 'finding_json', 'created_at'],
  published_artifacts: [
    'id',
    'simulation_version_id',
    'generated_artifact_id',
    'artifact_bundle_json',
    'verification_run_id',
    'verification_report_artifact_id',
    'verification_report_hash',
    'export_license_json',
    'published_at',
  ],
} as const

const plan005PrivacyFields = {
  auth_bootstrap: ['singleton', 'completed_at'],
  local_administrator: [
    'singleton',
    'password_hash',
    'password_salt',
    'password_hash_version',
    'scrypt_cost',
    'scrypt_block_size',
    'scrypt_parallelization',
    'scrypt_key_length',
    'credential_version',
    'created_at',
    'updated_at',
  ],
  administrator_sessions: [
    'id',
    'administrator_id',
    'token_hash',
    'csrf_hash',
    'credential_version',
    'created_at',
    'last_activity_at',
    'expires_at',
    'rotated_from_id',
    'revoked_at',
  ],
  privacy_settings: [
    'singleton',
    'prompt_retention_enabled',
    'external_diagnostics_enabled',
    'revision',
    'updated_at',
  ],
  retained_prompts: ['id', 'simulation_id', 'prompt_text', 'created_at'],
} as const

const plan006GenerationFields = {
  generation_pipeline_runs: [
    'id',
    'simulation_version_id',
    'idempotency_key_hash',
    'state',
    'revision',
    'max_attempts',
    'max_provider_requests',
    'max_input_tokens',
    'max_output_tokens',
    'max_cost_microusd',
    'max_artifact_bytes',
    'used_provider_requests',
    'used_input_tokens',
    'used_output_tokens',
    'used_cost_microusd',
    'used_artifact_bytes',
    'cancellation_requested_at',
    'terminal_classification',
    'stable_error_id',
    'findings_reference',
    'created_at',
    'updated_at',
    'completed_at',
  ],
  generation_pipeline_transitions: [
    'run_id',
    'sequence',
    'from_state',
    'to_state',
    'transitioned_at',
  ],
  generation_pipeline_attempts: [
    'id',
    'run_id',
    'attempt_number',
    'outcome',
    'provider',
    'model_id',
    'template_version',
    'provider_request_id',
    'codex_thread_id',
    'artifact_hash',
    'verification_run_id',
    'findings_reference',
    'stable_error_id',
    'created_at',
    'completed_at',
  ],
  generation_external_calls: [
    'id',
    'run_id',
    'attempt_id',
    'operation',
    'provider',
    'model_id',
    'template_version',
    'provider_request_id',
    'codex_thread_id',
    'stable_error_id',
    'provider_requests',
    'input_tokens',
    'output_tokens',
    'cost_microusd',
    'artifact_bytes',
    'recorded_at',
  ],
  generation_provider_reservations: [
    'id',
    'run_id',
    'attempt_id',
    'operation',
    'provider',
    'model_id',
    'template_version',
    'reserved_provider_requests',
    'reserved_input_tokens',
    'reserved_output_tokens',
    'reserved_cost_microusd',
    'reserved_artifact_bytes',
    'status',
    'external_call_id',
    'created_at',
    'reconciled_at',
  ],
} as const

const documentedFields = {
  ...plan004Fields,
  ...plan005PrivacyFields,
  ...plan006GenerationFields,
}

async function readPrivacyDocument(): Promise<string> {
  return await readFile(resolve(process.cwd(), '../../docs/security/privacy.md'), 'utf8')
}

describe('privacy documentation inventory', () => {
  it('names every inventoried persisted field in its owning record row', async () => {
    const document = await readPrivacyDocument()
    for (const [record, fields] of Object.entries(documentedFields)) {
      const row = document.split('\n').find((line) => line.startsWith(`| \`${record}\``))
      expect(row, `missing privacy inventory row for ${record}`).toBeDefined()
      for (const field of fields) expect(row).toContain(`\`${field}\``)
    }
  })

  it('exhaustively matches the generation orchestration inventory to the migrated schema', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'simproof-privacy-inventory-'))
    const path = resolve(directory, 'inventory.sqlite')
    const persistence = createPersistence(path)
    let persistenceOpen = true
    try {
      expect(persistence.migrate()).toMatchObject({ ok: true })
      persistence.close()
      persistenceOpen = false
      const database = new DatabaseSync(path, { readOnly: true })
      try {
        for (const [table, expectedFields] of Object.entries(plan006GenerationFields)) {
          const rows = database
            .prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid')
            .all(table) as unknown as readonly {
            readonly name: string
          }[]
          expect(
            rows.map(({ name }) => name),
            `privacy inventory drifted from ${table}`,
          ).toEqual(expectedFields)
        }
      } finally {
        database.close()
      }
    } finally {
      if (persistenceOpen) persistence.close()
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('documents external provider disclosure, prompt retention, export, deletion, and sessions', async () => {
    const document = await readPrivacyDocument()
    expect(document).toMatch(/Prompt retention defaults to `discard`/u)
    expect(document).toMatch(/OpenAI\/Codex/u)
    expect(document).toMatch(/simulation export/iu)
    expect(document).toMatch(/Simulation deletion/u)
    expect(document).toMatch(/Restore never revives an existing session cookie/u)
    expect(document).toMatch(/raw reasoning/iu)
    expect(document).toMatch(/provider credentials/iu)
    expect(document).toMatch(/prompts are not persisted/iu)
    expect(document).toMatch(/immutable scientific evidence provenance/iu)
    expect(document).toMatch(/authenticationMode: local-bypass/u)
    expect(document).toMatch(/operational\s+orchestration control data[\s\S]*backup-only/iu)
  })
})
