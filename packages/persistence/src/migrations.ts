// LOC-EXEMPT: Numbered declarative SQL is kept intact so the applied schema is auditable.
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    version: 1,
    name: 'initial_persistence_schema',
    sql: `
CREATE TABLE simulations(id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;
CREATE TABLE stored_artifacts(
 id TEXT PRIMARY KEY,role TEXT NOT NULL CHECK(role IN ('core-source','renderer-source','renderer-data','manifest','concept-spec','verification-report')),
 content_hash TEXT NOT NULL,media_type TEXT NOT NULL CHECK(media_type IN ('text/javascript','application/json')),
 byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 16777216),normalization_version INTEGER NOT NULL CHECK(normalization_version > 0),created_at TEXT NOT NULL,
 UNIQUE(id,role,content_hash)
) STRICT;
CREATE TABLE simulation_versions(
 id TEXT PRIMARY KEY,simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,version_number INTEGER NOT NULL CHECK(version_number > 0),
 state TEXT NOT NULL CHECK(state IN ('draft','generating','verifying','rejected','verified','stale','published','archived')),revision INTEGER NOT NULL CHECK(revision >= 0),
 active_concept_spec_id TEXT REFERENCES concept_specs(id),active_generated_artifact_id TEXT REFERENCES generated_artifacts(id),active_artifact_bundle_json TEXT,active_verification_run_id TEXT REFERENCES verification_runs(id),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(simulation_id,version_number)
) STRICT;
CREATE TABLE generation_runs(
 id TEXT PRIMARY KEY,simulation_version_id TEXT NOT NULL REFERENCES simulation_versions(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('running','succeeded','rejected','operational-failure','cancelled','budget-exhausted')),
 max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 3),codex_session_id TEXT,created_at TEXT NOT NULL,completed_at TEXT
) STRICT;
CREATE TABLE generation_attempts(
 id TEXT PRIMARY KEY,generation_run_id TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 3),
 outcome TEXT NOT NULL CHECK(outcome IN ('pending','running','verified','rejected','provider-failed','runner-failed','invalid-output','cancelled')),
 generated_artifact_id TEXT REFERENCES generated_artifacts(id),stable_error_id TEXT,created_at TEXT NOT NULL,completed_at TEXT,UNIQUE(generation_run_id,attempt_number)
) STRICT;
CREATE TABLE concept_specs(
 id TEXT PRIMARY KEY,simulation_version_id TEXT NOT NULL REFERENCES simulation_versions(id) ON DELETE CASCADE,generation_run_id TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
 schema_version TEXT NOT NULL CHECK(schema_version='1'),domain TEXT NOT NULL CHECK(domain IN ('projectile','pendulum')),
 artifact_id TEXT NOT NULL REFERENCES stored_artifacts(id),artifact_hash TEXT NOT NULL,created_at TEXT NOT NULL
) STRICT;
CREATE TABLE generated_artifacts(
 id TEXT PRIMARY KEY,generation_attempt_id TEXT NOT NULL UNIQUE REFERENCES generation_attempts(id) ON DELETE CASCADE,
 artifact_bundle_json TEXT NOT NULL,core_artifact_id TEXT NOT NULL REFERENCES stored_artifacts(id),renderer_artifact_id TEXT NOT NULL REFERENCES stored_artifacts(id),manifest_artifact_id TEXT NOT NULL REFERENCES stored_artifacts(id),
 export_license_json TEXT NOT NULL,created_at TEXT NOT NULL
) STRICT;
CREATE TABLE verification_policy_references(
 id TEXT PRIMARY KEY,policy_id TEXT NOT NULL,version TEXT NOT NULL,content_hash TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(policy_id,version,content_hash)
) STRICT;
CREATE TABLE domain_pack_references(
 id TEXT PRIMARY KEY,domain_pack_id TEXT NOT NULL,version TEXT NOT NULL,content_hash TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(domain_pack_id,version,content_hash)
) STRICT;
CREATE TABLE verification_runs(
 id TEXT PRIMARY KEY,simulation_version_id TEXT NOT NULL REFERENCES simulation_versions(id) ON DELETE CASCADE,concept_spec_id TEXT NOT NULL REFERENCES concept_specs(id),generated_artifact_id TEXT NOT NULL REFERENCES generated_artifacts(id),
 evidence_json TEXT NOT NULL,concept_artifact_json TEXT NOT NULL,artifact_bundle_json TEXT NOT NULL,policy_reference_id TEXT NOT NULL REFERENCES verification_policy_references(id),domain_pack_reference_id TEXT NOT NULL REFERENCES domain_pack_references(id),
 policy_content_hash TEXT NOT NULL,domain_pack_content_hash TEXT NOT NULL,runner_version TEXT NOT NULL,runner_protocol_version TEXT NOT NULL CHECK(runner_protocol_version='1'),
 dependencies_json TEXT NOT NULL,dependencies_hash TEXT NOT NULL,observation_hash TEXT NOT NULL,report_artifact_id TEXT NOT NULL REFERENCES stored_artifacts(id),report_hash TEXT NOT NULL,
 verdict TEXT NOT NULL CHECK(verdict IN ('verified','rejected','inapplicable')),created_at TEXT NOT NULL
) STRICT;
CREATE TABLE verification_findings(
 id TEXT PRIMARY KEY,verification_run_id TEXT NOT NULL REFERENCES verification_runs(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 9999),
 finding_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(verification_run_id,ordinal)
) STRICT;
CREATE TABLE published_artifacts(
 id TEXT PRIMARY KEY,simulation_version_id TEXT NOT NULL REFERENCES simulation_versions(id) ON DELETE CASCADE,generated_artifact_id TEXT NOT NULL REFERENCES generated_artifacts(id),
 artifact_bundle_json TEXT NOT NULL,verification_run_id TEXT NOT NULL REFERENCES verification_runs(id),verification_report_artifact_id TEXT NOT NULL REFERENCES stored_artifacts(id),verification_report_hash TEXT NOT NULL,
 export_license_json TEXT NOT NULL,published_at TEXT NOT NULL,UNIQUE(simulation_version_id,verification_run_id)
) STRICT;
CREATE INDEX idx_versions_simulation ON simulation_versions(simulation_id);
CREATE INDEX idx_runs_version ON generation_runs(simulation_version_id);
CREATE INDEX idx_verification_version ON verification_runs(simulation_version_id,created_at);
CREATE TRIGGER immutable_stored_artifact BEFORE UPDATE ON stored_artifacts BEGIN SELECT RAISE(ABORT,'immutable stored artifact'); END;
CREATE TRIGGER immutable_concept_spec BEFORE UPDATE ON concept_specs BEGIN SELECT RAISE(ABORT,'immutable concept spec'); END;
CREATE TRIGGER immutable_generated_artifact BEFORE UPDATE ON generated_artifacts BEGIN SELECT RAISE(ABORT,'immutable generated artifact'); END;
CREATE TRIGGER immutable_policy_reference BEFORE UPDATE ON verification_policy_references BEGIN SELECT RAISE(ABORT,'immutable policy reference'); END;
CREATE TRIGGER immutable_domain_pack_reference BEFORE UPDATE ON domain_pack_references BEGIN SELECT RAISE(ABORT,'immutable domain-pack reference'); END;
CREATE TRIGGER immutable_verification_run BEFORE UPDATE ON verification_runs BEGIN SELECT RAISE(ABORT,'immutable verification run'); END;
CREATE TRIGGER immutable_finding BEFORE UPDATE ON verification_findings BEGIN SELECT RAISE(ABORT,'immutable finding'); END;
CREATE TRIGGER immutable_publication BEFORE UPDATE ON published_artifacts BEGIN SELECT RAISE(ABORT,'immutable publication'); END;
CREATE TRIGGER immutable_terminal_attempt BEFORE UPDATE ON generation_attempts
 WHEN OLD.outcome NOT IN ('pending','running') BEGIN SELECT RAISE(ABORT,'immutable terminal attempt'); END;
CREATE TRIGGER immutable_terminal_generation_run BEFORE UPDATE ON generation_runs
 WHEN OLD.status <> 'running' BEGIN SELECT RAISE(ABORT,'immutable terminal generation run'); END;
PRAGMA application_id=1397772870;
PRAGMA user_version=1;
    `,
  },
  {
    version: 2,
    name: 'teacher_authentication_and_privacy_controls',
    sql: `
CREATE TABLE auth_bootstrap(
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),completed_at TEXT NOT NULL
) STRICT;
CREATE TABLE local_administrator(
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 password_hash TEXT NOT NULL CHECK(length(password_hash)=64 AND password_hash NOT GLOB '*[^0-9a-f]*'),
 password_salt TEXT NOT NULL CHECK(length(password_salt) BETWEEN 16 AND 128),
 password_hash_version INTEGER NOT NULL CHECK(password_hash_version=1),
 scrypt_cost INTEGER NOT NULL CHECK(scrypt_cost=16384),
 scrypt_block_size INTEGER NOT NULL CHECK(scrypt_block_size=8),
 scrypt_parallelization INTEGER NOT NULL CHECK(scrypt_parallelization=1),
 scrypt_key_length INTEGER NOT NULL CHECK(scrypt_key_length=32),
 credential_version INTEGER NOT NULL CHECK(credential_version>0),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE administrator_sessions(
 id TEXT PRIMARY KEY,administrator_id INTEGER NOT NULL DEFAULT 1 REFERENCES local_administrator(singleton),
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
 csrf_hash TEXT NOT NULL CHECK(length(csrf_hash)=64 AND csrf_hash NOT GLOB '*[^0-9a-f]*'),
 credential_version INTEGER NOT NULL CHECK(credential_version>0),created_at TEXT NOT NULL,
 last_activity_at TEXT NOT NULL,expires_at TEXT NOT NULL CHECK(expires_at>created_at),
 rotated_from_id TEXT REFERENCES administrator_sessions(id),revoked_at TEXT,
 CHECK(last_activity_at>=created_at AND last_activity_at<expires_at),
 CHECK(revoked_at IS NULL OR revoked_at>=created_at)
) STRICT;
CREATE INDEX idx_administrator_sessions_expiry ON administrator_sessions(expires_at);
CREATE TRIGGER immutable_auth_bootstrap_update BEFORE UPDATE ON auth_bootstrap BEGIN SELECT RAISE(ABORT,'immutable auth bootstrap'); END;
CREATE TRIGGER immutable_auth_bootstrap_delete BEFORE DELETE ON auth_bootstrap BEGIN SELECT RAISE(ABORT,'immutable auth bootstrap'); END;
CREATE TRIGGER prevent_administrator_delete BEFORE DELETE ON local_administrator BEGIN SELECT RAISE(ABORT,'immutable local administrator'); END;
CREATE TRIGGER immutable_session_identity BEFORE UPDATE OF id,administrator_id,token_hash,csrf_hash,credential_version,created_at,expires_at ON administrator_sessions BEGIN SELECT RAISE(ABORT,'immutable session identity'); END;
CREATE TRIGGER restrict_session_rotation_update BEFORE UPDATE OF rotated_from_id ON administrator_sessions WHEN OLD.rotated_from_id IS NULL OR NEW.rotated_from_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable session rotation'); END;
CREATE TRIGGER monotonic_session_activity BEFORE UPDATE OF last_activity_at ON administrator_sessions WHEN NEW.last_activity_at<OLD.last_activity_at OR NEW.last_activity_at<NEW.created_at OR NEW.last_activity_at>=NEW.expires_at BEGIN SELECT RAISE(ABORT,'invalid session activity'); END;
CREATE TABLE privacy_settings(
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 prompt_retention_enabled INTEGER NOT NULL DEFAULT 0 CHECK(prompt_retention_enabled IN (0,1)),
 external_diagnostics_enabled INTEGER NOT NULL DEFAULT 0 CHECK(external_diagnostics_enabled IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),updated_at TEXT NOT NULL
) STRICT;
INSERT INTO privacy_settings(singleton,prompt_retention_enabled,external_diagnostics_enabled,revision,updated_at)
 VALUES (1,0,0,0,'1970-01-01T00:00:00.000Z');
CREATE TABLE retained_prompts(
 id TEXT PRIMARY KEY,simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
 prompt_text TEXT NOT NULL CHECK(length(CAST(prompt_text AS BLOB)) BETWEEN 1 AND 65536),created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_retained_prompts_simulation ON retained_prompts(simulation_id,created_at,id);
CREATE TRIGGER prevent_privacy_settings_delete BEFORE DELETE ON privacy_settings BEGIN SELECT RAISE(ABORT,'immutable privacy settings singleton'); END;
CREATE TRIGGER immutable_retained_prompt BEFORE UPDATE ON retained_prompts BEGIN SELECT RAISE(ABORT,'immutable retained prompt'); END;
PRAGMA user_version=2;
    `,
  },
  {
    version: 3,
    name: 'durable_generation_orchestration',
    sql: `
CREATE TABLE generation_pipeline_runs(
 id TEXT PRIMARY KEY REFERENCES generation_runs(id) ON DELETE CASCADE,
 simulation_version_id TEXT NOT NULL REFERENCES simulation_versions(id) ON DELETE CASCADE,
 idempotency_key_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_key_hash)=64 AND idempotency_key_hash NOT GLOB '*[^0-9a-f]*'),
 state TEXT NOT NULL CHECK(state IN ('queued','compiling','generating','executing','verifying','verified','repairing','rejected','cancelled','provider_failed','runner_failed','budget_exhausted','invariant_failed')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 3),
 max_provider_requests INTEGER NOT NULL CHECK(max_provider_requests>0),
 max_input_tokens INTEGER NOT NULL CHECK(max_input_tokens>0),
 max_output_tokens INTEGER NOT NULL CHECK(max_output_tokens>0),
 max_cost_microusd INTEGER NOT NULL CHECK(max_cost_microusd>0),
 max_artifact_bytes INTEGER NOT NULL CHECK(max_artifact_bytes>0),
 used_provider_requests INTEGER NOT NULL DEFAULT 0 CHECK(used_provider_requests>=0 AND used_provider_requests<=max_provider_requests),
 used_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK(used_input_tokens>=0 AND used_input_tokens<=max_input_tokens),
 used_output_tokens INTEGER NOT NULL DEFAULT 0 CHECK(used_output_tokens>=0 AND used_output_tokens<=max_output_tokens),
 used_cost_microusd INTEGER NOT NULL DEFAULT 0 CHECK(used_cost_microusd>=0 AND used_cost_microusd<=max_cost_microusd),
 used_artifact_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_artifact_bytes>=0 AND used_artifact_bytes<=max_artifact_bytes),
 cancellation_requested_at TEXT,
 terminal_classification TEXT CHECK(terminal_classification IN ('verified','scientific_rejection','provider_failure','runner_failure','cancelled','budget_exhaustion','invariant_failure')),
 stable_error_id TEXT CHECK(stable_error_id IS NULL OR length(stable_error_id) BETWEEN 1 AND 200),
 findings_reference TEXT CHECK(findings_reference IS NULL OR length(findings_reference) BETWEEN 1 AND 200),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,
 CHECK((state IN ('verified','rejected','cancelled','provider_failed','runner_failed','budget_exhausted','invariant_failed'))=(completed_at IS NOT NULL)),
 CHECK((completed_at IS NOT NULL)=(terminal_classification IS NOT NULL)),
 CHECK(cancellation_requested_at IS NULL OR cancellation_requested_at>=created_at)
) STRICT;
CREATE TABLE generation_pipeline_transitions(
 run_id TEXT NOT NULL REFERENCES generation_pipeline_runs(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL CHECK(sequence>=0),from_state TEXT,
 to_state TEXT NOT NULL CHECK(to_state IN ('queued','compiling','generating','executing','verifying','verified','repairing','rejected','cancelled','provider_failed','runner_failed','budget_exhausted','invariant_failed')),
 transitioned_at TEXT NOT NULL,PRIMARY KEY(run_id,sequence)
) STRICT;
CREATE TABLE generation_pipeline_attempts(
 id TEXT PRIMARY KEY REFERENCES generation_attempts(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL REFERENCES generation_pipeline_runs(id) ON DELETE CASCADE,
 attempt_number INTEGER NOT NULL CHECK(attempt_number BETWEEN 1 AND 3),
 outcome TEXT NOT NULL CHECK(outcome IN ('pending','verified','rejected','provider_failed','runner_failed','malformed_response','cancelled','budget_exhausted','invariant_failed')),
 provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 100),
 model_id TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 200),
 template_version TEXT NOT NULL CHECK(length(template_version) BETWEEN 1 AND 100),
 provider_request_id TEXT CHECK(provider_request_id IS NULL OR length(provider_request_id) BETWEEN 1 AND 200),
 codex_thread_id TEXT CHECK(codex_thread_id IS NULL OR length(codex_thread_id) BETWEEN 1 AND 200),
 artifact_hash TEXT CHECK(artifact_hash IS NULL OR (length(artifact_hash)=71 AND artifact_hash GLOB 'sha256:*' AND substr(artifact_hash,8) NOT GLOB '*[^0-9a-f]*')),
 verification_run_id TEXT REFERENCES verification_runs(id),
 findings_reference TEXT CHECK(findings_reference IS NULL OR length(findings_reference) BETWEEN 1 AND 200),
 stable_error_id TEXT CHECK(stable_error_id IS NULL OR length(stable_error_id) BETWEEN 1 AND 200),
 created_at TEXT NOT NULL,completed_at TEXT,UNIQUE(run_id,attempt_number),
 CHECK((outcome='pending')=(completed_at IS NULL))
) STRICT;
CREATE TABLE generation_external_calls(
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES generation_pipeline_runs(id) ON DELETE CASCADE,
 attempt_id TEXT REFERENCES generation_pipeline_attempts(id) ON DELETE CASCADE,
 operation TEXT NOT NULL CHECK(operation IN ('concept_compile','code_generate','code_repair')),
 provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 100),
 model_id TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 200),
 template_version TEXT NOT NULL CHECK(length(template_version) BETWEEN 1 AND 100),
 provider_request_id TEXT CHECK(provider_request_id IS NULL OR length(provider_request_id) BETWEEN 1 AND 200),
 codex_thread_id TEXT CHECK(codex_thread_id IS NULL OR length(codex_thread_id) BETWEEN 1 AND 200),
 stable_error_id TEXT CHECK(stable_error_id IS NULL OR length(stable_error_id) BETWEEN 1 AND 200),
 provider_requests INTEGER NOT NULL CHECK(provider_requests>0),
 input_tokens INTEGER NOT NULL CHECK(input_tokens>=0),
 output_tokens INTEGER NOT NULL CHECK(output_tokens>=0),
 cost_microusd INTEGER NOT NULL CHECK(cost_microusd>=0),
 artifact_bytes INTEGER NOT NULL CHECK(artifact_bytes>=0),recorded_at TEXT NOT NULL,
 UNIQUE(run_id,provider,provider_request_id)
) STRICT;
CREATE TABLE generation_provider_reservations(
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES generation_pipeline_runs(id) ON DELETE CASCADE,
 attempt_id TEXT REFERENCES generation_pipeline_attempts(id) ON DELETE CASCADE,
 operation TEXT NOT NULL CHECK(operation IN ('concept_compile','code_generate','code_repair')),
 provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 100),
 model_id TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 200),
 template_version TEXT NOT NULL CHECK(length(template_version) BETWEEN 1 AND 100),
 reserved_provider_requests INTEGER NOT NULL CHECK(reserved_provider_requests=1),
 reserved_input_tokens INTEGER NOT NULL CHECK(reserved_input_tokens>=0),
 reserved_output_tokens INTEGER NOT NULL CHECK(reserved_output_tokens>=0),
 reserved_cost_microusd INTEGER NOT NULL CHECK(reserved_cost_microusd>=0),
 reserved_artifact_bytes INTEGER NOT NULL CHECK(reserved_artifact_bytes>=0),
 status TEXT NOT NULL CHECK(status IN ('pending','reconciled','not_dispatched')),
 external_call_id TEXT UNIQUE REFERENCES generation_external_calls(id),
 created_at TEXT NOT NULL,reconciled_at TEXT,
 CHECK(
  (status='pending' AND external_call_id IS NULL AND reconciled_at IS NULL) OR
  (status='reconciled' AND external_call_id IS NOT NULL AND reconciled_at IS NOT NULL) OR
  (status='not_dispatched' AND external_call_id IS NULL AND reconciled_at IS NOT NULL)
 ),
 CHECK((operation='concept_compile')=(attempt_id IS NULL))
) STRICT;
CREATE INDEX idx_generation_pipeline_version ON generation_pipeline_runs(simulation_version_id,created_at);
CREATE INDEX idx_generation_reservation_run ON generation_provider_reservations(run_id,created_at,id);
CREATE TRIGGER immutable_generation_transition BEFORE UPDATE ON generation_pipeline_transitions BEGIN SELECT RAISE(ABORT,'immutable generation transition'); END;
CREATE TRIGGER immutable_generation_transition_delete BEFORE DELETE ON generation_pipeline_transitions BEGIN SELECT RAISE(ABORT,'immutable generation transition'); END;
CREATE TRIGGER immutable_terminal_pipeline_run BEFORE UPDATE ON generation_pipeline_runs
 WHEN OLD.completed_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable terminal generation pipeline run'); END;
CREATE TRIGGER immutable_terminal_pipeline_attempt BEFORE UPDATE ON generation_pipeline_attempts
 WHEN OLD.completed_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable terminal generation pipeline attempt'); END;
CREATE TRIGGER immutable_generation_external_call BEFORE UPDATE ON generation_external_calls BEGIN SELECT RAISE(ABORT,'immutable generation external call'); END;
CREATE TRIGGER immutable_generation_external_call_delete BEFORE DELETE ON generation_external_calls BEGIN SELECT RAISE(ABORT,'immutable generation external call'); END;
CREATE TRIGGER immutable_generation_reservation_identity BEFORE UPDATE OF id,run_id,attempt_id,operation,provider,model_id,template_version,reserved_provider_requests,reserved_input_tokens,reserved_output_tokens,reserved_cost_microusd,reserved_artifact_bytes,created_at ON generation_provider_reservations BEGIN SELECT RAISE(ABORT,'immutable generation reservation identity'); END;
CREATE TRIGGER immutable_terminal_generation_reservation BEFORE UPDATE ON generation_provider_reservations WHEN OLD.status<>'pending' BEGIN SELECT RAISE(ABORT,'immutable terminal generation reservation'); END;
CREATE TRIGGER immutable_generation_reservation_delete BEFORE DELETE ON generation_provider_reservations BEGIN SELECT RAISE(ABORT,'immutable generation reservation'); END;
PRAGMA user_version=3;
    `,
  },
  {
    version: 4,
    name: 'educator_library_and_concept_review',
    sql: `
CREATE TABLE bundled_examples(
 example_id TEXT NOT NULL CHECK(length(example_id) BETWEEN 1 AND 100),
 example_version TEXT NOT NULL CHECK(length(example_version) BETWEEN 1 AND 100),
 catalog_hash TEXT NOT NULL CHECK(length(catalog_hash)=71 AND catalog_hash GLOB 'sha256:*' AND substr(catalog_hash,8) NOT GLOB '*[^0-9a-f]*'),
 simulation_id TEXT NOT NULL UNIQUE REFERENCES simulations(id) ON DELETE RESTRICT,
 domain TEXT NOT NULL CHECK(domain IN ('projectile','pendulum')),
 license_id TEXT NOT NULL CHECK(license_id='CC-BY-4.0'),
 attribution TEXT NOT NULL CHECK(length(attribution) BETWEEN 1 AND 500),
 installed_at TEXT NOT NULL,
 PRIMARY KEY(example_id,example_version)
) STRICT;
CREATE UNIQUE INDEX idx_concept_review_binding ON concept_specs(id,simulation_version_id,generation_run_id,artifact_hash);
CREATE TABLE generation_concept_reviews(
 id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL UNIQUE REFERENCES generation_pipeline_runs(id) ON DELETE CASCADE,
 simulation_version_id TEXT NOT NULL REFERENCES simulation_versions(id) ON DELETE CASCADE,
 concept_spec_id TEXT NOT NULL UNIQUE REFERENCES concept_specs(id) ON DELETE CASCADE,
 concept_hash TEXT NOT NULL CHECK(length(concept_hash)=71 AND concept_hash GLOB 'sha256:*' AND substr(concept_hash,8) NOT GLOB '*[^0-9a-f]*'),
 status TEXT NOT NULL CHECK(status IN ('pending','confirmed','cancelled')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,resolved_at TEXT,
 CHECK(
  (status='pending' AND resolved_at IS NULL) OR
  (status IN ('confirmed','cancelled') AND resolved_at IS NOT NULL)
 ),
 FOREIGN KEY(concept_spec_id,simulation_version_id,run_id,concept_hash)
   REFERENCES concept_specs(id,simulation_version_id,generation_run_id,artifact_hash) ON DELETE CASCADE
) STRICT;
CREATE INDEX idx_bundled_examples_domain ON bundled_examples(domain,example_id,example_version);
CREATE INDEX idx_concept_reviews_version ON generation_concept_reviews(simulation_version_id,created_at,id);
CREATE TRIGGER immutable_bundled_example_update BEFORE UPDATE ON bundled_examples BEGIN SELECT RAISE(ABORT,'immutable bundled example'); END;
CREATE TRIGGER immutable_bundled_example_delete BEFORE DELETE ON bundled_examples BEGIN SELECT RAISE(ABORT,'immutable bundled example'); END;
CREATE TRIGGER immutable_concept_review_identity BEFORE UPDATE OF id,run_id,simulation_version_id,concept_spec_id,concept_hash,created_at ON generation_concept_reviews BEGIN SELECT RAISE(ABORT,'immutable concept review identity'); END;
CREATE TRIGGER immutable_terminal_concept_review BEFORE UPDATE ON generation_concept_reviews WHEN OLD.status<>'pending' BEGIN SELECT RAISE(ABORT,'immutable terminal concept review'); END;
PRAGMA user_version=4;
    `,
  },
  {
    version: 5,
    name: 'duplicate_version_lineage',
    sql: `
CREATE TABLE version_lineage(
 destination_version_id TEXT PRIMARY KEY REFERENCES simulation_versions(id) ON DELETE CASCADE,
 source_simulation_id TEXT NOT NULL,
 source_version_id TEXT NOT NULL,
 source_version_number INTEGER NOT NULL CHECK(source_version_number>0),
 source_revision INTEGER NOT NULL CHECK(source_revision>=0),
 kind TEXT NOT NULL CHECK(kind='duplicate'),
 created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_version_lineage_source ON version_lineage(source_simulation_id,source_version_id);
CREATE TRIGGER immutable_version_lineage_update BEFORE UPDATE ON version_lineage BEGIN SELECT RAISE(ABORT,'immutable version lineage'); END;
PRAGMA user_version=5;
    `,
  },
])

export const CURRENT_PERSISTENCE_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0

export function migrationChecksum(migration: Migration): string {
  return createHash('sha256')
    .update(`${migration.version}\0${migration.name}\0${migration.sql}`)
    .digest('hex')
}

export function ensureMigrationJournal(database: DatabaseSync): void {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(
    version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL CHECK(length(checksum)=64),applied_at TEXT NOT NULL
  ) STRICT;`)
}
