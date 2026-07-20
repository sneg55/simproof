# Privacy and data inventory

## Product boundary

SimProof is a self-hosted, single-tenant tool for one teacher/operator. It has no
student accounts, rosters, grades, learning analytics, advertising identifiers, or
behavioral profiles. Teachers must not place student names, IDs, contact details,
education records, or other student-identifying information in prompts, titles, source
artifacts, or diagnostics.

This document describes technical collection and control boundaries; it does not claim
FERPA, COPPA, or other legal compliance. Expanding the product to student data requires
a new privacy and architecture decision before implementation.

## Durable data inventory

SQLite metadata is local to the deployment. Artifact bytes are stored in the local
content-addressed artifact root. Unless stated otherwise, a simulation export includes
the selected simulation aggregate and referenced artifacts, deleting a simulation
removes its metadata and unshared objects, and logs contain only bounded IDs/hashes and
classifications—not field contents.

| Persisted record | Every persisted field | Purpose and disclosure | Export, deletion, and logging |
|---|---|---|---|
| `schema_migrations` | `version`, `name`, `checksum`, `applied_at` | Local schema compatibility and tamper detection; never sent externally. | Backup only; not teacher export or simulation deletion; log migration version/status, not SQL or paths. |
| `simulations` | `id`, `title`, `created_at`, `updated_at` | Teacher-owned simulation identity and display title. A title remains local unless selected export includes it. | Included in selected export; simulation deletion removes it; logs use `id`, not `title`. |
| `stored_artifacts` | `id`, `role`, `content_hash`, `media_type`, `byte_length`, `normalization_version`, `created_at` | Local metadata for immutable concept, source, renderer-data, manifest, and verification-report objects. Referenced bytes live in the artifact root. Provider generation/repair can transmit the minimum required prompt/workflow inputs described below, not arbitrary stored objects. | Selected referenced metadata/bytes are exported; deletion removes only objects with no retained reference; logs may use role/hash/size, never content. |
| `simulation_versions` | `id`, `simulation_id`, `version_number`, `state`, `revision`, `active_concept_spec_id`, `active_generated_artifact_id`, `active_artifact_bundle_json`, `active_verification_run_id`, `created_at`, `updated_at` | Local lifecycle, optimistic revision, and exact active evidence selections. | Included in selected export and aggregate deletion; logs may use IDs/state/revision, not embedded bundle content. |
| `generation_runs` | `id`, `simulation_version_id`, `status`, `max_attempts`, `codex_session_id`, `created_at`, `completed_at` | Local generation provenance and bounded repair state. `codex_session_id` is a bounded provider-thread provenance identifier, not an authentication session. | Included in selected export and deletion. Provider APIs receive their own thread/session identifier as needed; logs may use run/status/stable provider classification. |
| `generation_attempts` | `id`, `generation_run_id`, `attempt_number`, `outcome`, `generated_artifact_id`, `stable_error_id`, `created_at`, `completed_at` | Local attempt history and stable failure classification. | Included in selected export and deletion; logs may use IDs, ordinal, outcome, and stable error ID. |
| `concept_specs` | `id`, `simulation_version_id`, `generation_run_id`, `schema_version`, `domain`, `artifact_id`, `artifact_hash`, `created_at` | Local immutable binding from a generation run to a schema-constrained concept artifact. | Included with the selected aggregate and deletion; required concept content may be sent during provider generation/repair; logs use IDs/hash/domain only. |
| `bundled_examples` | `example_id`, `example_version`, `catalog_hash`, `simulation_id`, `domain`, `license_id`, `attribution`, `installed_at` | Local immutable provenance, licensing, and ownership metadata for an application-installed educator example. It contains no teacher or student record and is never sent to a model provider. | Included in protected backup and teacher library projections; excluded from teacher simulation and full-privacy JSON exports. A bundled simulation cannot be deleted independently of its installed catalog metadata. Logs may use bounded IDs, version, hash, domain, and license ID, never a simulation title. |
| `generated_artifacts` | `id`, `generation_attempt_id`, `artifact_bundle_json`, `core_artifact_id`, `renderer_artifact_id`, `manifest_artifact_id`, `export_license_json`, `created_at` | Local immutable binding for generated core, renderer, manifest, and recorded export-license metadata. | Included in selected export and deletion; candidate source is sent only to the isolated runner and may be returned by the configured coding provider; logs use IDs/hashes/outcome only. |
| `verification_policy_references` | `id`, `policy_id`, `version`, `content_hash`, `created_at` | Local trusted-policy provenance. | Included when referenced by selected evidence; retained/deleted with references; provider prompts may receive non-secret IDs/versions, never trusted policy code as provider-defined truth. |
| `domain_pack_references` | `id`, `domain_pack_id`, `version`, `content_hash`, `created_at` | Local trusted domain-pack provenance. | Included when referenced by selected evidence; retained/deleted with references; logs may use ID/version/hash. |
| `verification_runs` | `id`, `simulation_version_id`, `concept_spec_id`, `generated_artifact_id`, `evidence_json`, `concept_artifact_json`, `artifact_bundle_json`, `policy_reference_id`, `domain_pack_reference_id`, `policy_content_hash`, `domain_pack_content_hash`, `runner_version`, `runner_protocol_version`, `dependencies_json`, `dependencies_hash`, `observation_hash`, `report_artifact_id`, `report_hash`, `verdict`, `created_at` | Local immutable scientific evidence and exact provenance. Repair may send bounded structured findings and artifact bindings to the configured model provider; raw runner output and host diagnostics are excluded. | Included in selected export and aggregate deletion; logs use IDs/hashes/verdict/stable finding IDs, never embedded evidence JSON. |
| `verification_findings` | `id`, `verification_run_id`, `ordinal`, `finding_json`, `created_at` | Local structured scientific mismatch, invariant, or applicability findings. | Included in selected export/deletion; bounded structured findings may be disclosed for repair; logs use finding/check IDs and severity, not full values/explanations. |
| `published_artifacts` | `id`, `simulation_version_id`, `generated_artifact_id`, `artifact_bundle_json`, `verification_run_id`, `verification_report_artifact_id`, `verification_report_hash`, `export_license_json`, `published_at` | Local immutable publication snapshot. | Included in selected export/deletion; publication itself does not contact a model provider; logs use IDs/hashes/status. |
| `auth_bootstrap` | `singleton`, `completed_at` | Local one-way record that first-run administrator bootstrap completed. | Included in backup, not teacher simulation export or deletion; logs may record completion state only. |
| `local_administrator` | `singleton`, `password_hash`, `password_salt`, `password_hash_version`, `scrypt_cost`, `scrypt_block_size`, `scrypt_parallelization`, `scrypt_key_length`, `credential_version`, `created_at`, `updated_at` | Local single-administrator credential material and versioned password-derivation parameters. Hash and salt are secrets-at-rest and are never sent to providers or browsers. | Included in protected backup so the administrator identity survives recovery; excluded from teacher export/deletion and ordinary logs. |
| `administrator_sessions` | `id`, `administrator_id`, `token_hash`, `csrf_hash`, `credential_version`, `created_at`, `last_activity_at`, `expires_at`, `rotated_from_id`, `revoked_at` | Local short-lived server-side login state. `last_activity_at` enforces idle expiry with bounded refresh writes. No IP address, user agent, student field, or raw cookie/CSRF token is stored. | Excluded from backups and teacher exports. Restore rejects any backup containing a session. Logout/expiry/revocation invalidates a row; deterministic oldest-first pruning clears obsolete rotation links and keeps at most 256 total rows. Logs never contain hashes or tokens. |
| `privacy_settings` | `singleton`, `prompt_retention_enabled`, `external_diagnostics_enabled`, `revision`, `updated_at` | Local teacher privacy choices, defaulting off with optimistic revision. Supplying an external diagnostics endpoint in environment configuration does not enable export by itself. | Included in backup and full privacy export, not simulation export. Reset/deletion is an explicit privacy workflow; logs may record revision and enabled/disabled state. |
| `retained_prompts` | `id`, `simulation_id`, `prompt_text`, `created_at` | Stores a bounded teacher prompt only after explicit prompt-retention opt-in. A retained prompt may be sent to the configured model provider for its requested generation workflow. | Included in full privacy export and protected backup; simulation deletion cascades it. Raw prompt text is excluded from logs and ordinary diagnostics. |
| `generation_pipeline_runs` | `id`, `simulation_version_id`, `idempotency_key_hash`, `state`, `revision`, `max_attempts`, `max_provider_requests`, `max_input_tokens`, `max_output_tokens`, `max_cost_microusd`, `max_artifact_bytes`, `used_provider_requests`, `used_input_tokens`, `used_output_tokens`, `used_cost_microusd`, `used_artifact_bytes`, `cancellation_requested_at`, `terminal_classification`, `stable_error_id`, `findings_reference`, `created_at`, `updated_at`, `completed_at` | Local durable orchestration state, hashed replay identity, configured resource limits, aggregate usage/cost in millionths of a US dollar, cancellation, findings reference, and bounded terminal classification. These records never contain prompts, provider credentials, or raw reasoning. | Included in protected backup and deleted with its simulation version. This operational record is backup-only and intentionally excluded from teacher simulation and full-privacy JSON exports. Logs may use run ID, state, revision, usage totals, stable error ID, and terminal classification, never the idempotency-key source value or findings content. |
| `generation_pipeline_transitions` | `run_id`, `sequence`, `from_state`, `to_state`, `transitioned_at` | Local immutable ordering of each generation state change; never sent externally. It contains no prompt, credential, model response, or raw reasoning. | Included in protected backup and deleted with its pipeline run. This operational record is backup-only and intentionally excluded from teacher simulation and full-privacy JSON exports. Logs may use run ID, sequence, and state names. |
| `generation_pipeline_attempts` | `id`, `run_id`, `attempt_number`, `outcome`, `provider`, `model_id`, `template_version`, `provider_request_id`, `codex_thread_id`, `artifact_hash`, `verification_run_id`, `findings_reference`, `stable_error_id`, `created_at`, `completed_at` | Local bounded attempt provenance: configured provider/model/template identifiers, provider request and Codex thread identifiers returned by OpenAI/Codex, artifact and verification bindings, findings reference, outcome, and stable error ID. Request/thread IDs are operational provenance, not credentials or authentication sessions. No prompt, credential, raw provider response, or raw reasoning is persisted. | Included in protected backup and deleted with its pipeline run. This operational record is backup-only and intentionally excluded from teacher simulation and full-privacy JSON exports. Logs may use bounded IDs, hashes, attempt number, outcome, and stable classifications; they exclude findings content and model output. |
| `generation_external_calls` | `id`, `run_id`, `attempt_id`, `operation`, `provider`, `model_id`, `template_version`, `provider_request_id`, `codex_thread_id`, `stable_error_id`, `provider_requests`, `input_tokens`, `output_tokens`, `cost_microusd`, `artifact_bytes`, `recorded_at` | Local immutable per-call accounting for concept compilation, code generation, and repair: provider/model/template provenance, provider request and Codex thread IDs, stable failure ID, request/token counts, cost in millionths of a US dollar, and artifact-byte usage. The configured provider receives workflow inputs as disclosed below, but this accounting row stores no prompts, provider credentials, raw responses, or raw reasoning. | Included in protected backup and deleted with its pipeline run or attempt. This operational record is backup-only and intentionally excluded from teacher simulation and full-privacy JSON exports. Logs may use operation, bounded identifiers, counts, cost, size, and stable error ID; never transmitted content or secrets. |
| `generation_provider_reservations` | `id`, `run_id`, `attempt_id`, `operation`, `provider`, `model_id`, `template_version`, `reserved_provider_requests`, `reserved_input_tokens`, `reserved_output_tokens`, `reserved_cost_microusd`, `reserved_artifact_bytes`, `status`, `external_call_id`, `created_at`, `reconciled_at` | Local pre-dispatch budget reservation for every provider-call dimension. It records bounded provider/model/template identifiers, reserved counts/cost/size, lifecycle status, and the reconciled local call ID; it stores no prompt, credential, provider response, request ID, Codex thread ID, or reasoning. Pending rows are retained across interruption so recovery cannot silently repeat an external side effect. | Included in protected backup and deleted with its pipeline run or attempt. This operational record is backup-only and intentionally excluded from teacher simulation and full-privacy JSON exports. Logs may use operation, bounded identifiers, reserved totals, status, and local call identity only. |
| `generation_concept_reviews` | `id`, `run_id`, `simulation_version_id`, `concept_spec_id`, `concept_hash`, `status`, `revision`, `created_at`, `updated_at`, `resolved_at` | Local durable educator checkpoint binding one schema-constrained concept artifact to its generation run and simulation version. It stores confirmation/cancellation state and optimistic revision, but no prompt, credential, raw provider response, or reasoning. | Included in protected backup and deleted with its generation aggregate. This operational record is excluded from teacher simulation and full-privacy JSON exports. Logs may use bounded IDs, concept hash, status, and revision; concept content remains excluded. |

## Local diagnostic data inventory

Structured operational signals are local diagnostic data outside the SQLite metadata
and content-addressed artifact stores. Each accepted signal contains `schemaVersion`,
`occurredAt`, `severity`, `component`, a registered `event`, and optional registered
`errorId`, correlation IDs (`requestId`, `runId`, `attemptId`, `simulationId`), and
allowlisted operational attributes. Allowed attributes are state/verdict/status,
attempt/queue/resource classifications, and bounded numeric measurements. The signal
schema rejects unknown fields and provides no raw message, title, prompt, content,
header, URL, path, environment, provider response, reasoning, or exception field.

Local diagnostic retention is bounded by per-event and per-file byte limits plus a
maximum rotated file count; it is not age based. Errors are not sampled out. A simulation
deletion removes its authoritative aggregate but does not search or rewrite retained
diagnostic snapshots; random correlation IDs may remain until the configured bounded
file rotation evicts their containing signals. Diagnostic data is excluded from
backups, teacher simulation exports, and the full privacy JSON export.

An operator diagnostic bundle contains component/schema versions, configuration
presence booleans, migration and readiness status, aggregated registry-known stable
error IDs, and an unknown-ID count. Strictly parsed redacted signals are omitted unless
the operator explicitly selects the `logs` category. Bundles always exclude raw
environment values, credentials, authentication records, cookies, prompts, generated
or artifact content, provider responses, reasoning, paths, and raw causes. The command
creates one private local file and never transmits it.

External telemetry remains independently disabled by default. When the deployer
explicitly enables its configured HTTPS exporter, only fixed metric names, numeric
aggregates, fixed state/failure classifications, and application version may leave the
deployment. Correlation IDs and product content are not telemetry dimensions.

Privacy-setting updates include the last observed revision. A stale update is rejected with HTTP
`409` and stable ID `http.privacy-conflict`; the teacher client must reload current settings before
retrying. Internal storage details are not included in that response.

When the explicit loopback test-only authentication bypass is active, the orchestrator
creates an ephemeral session ID and CSRF token in memory. Neither value is persisted,
exported, logged, or included in a backup. The session response additionally transmits
the fixed classification `authenticationMode: local-bypass` so the browser can label
the workspace and suppress password-session controls. This classification contains no
credential or environment value.

SQLite `application_id` and `user_version` are local format markers. Database and
artifact host paths are server configuration, not application records. Provider API
keys, bootstrap/session secrets, raw cookies/CSRF tokens, environment dumps, and
unredacted diagnostics are forbidden from every table, artifact, backup, export,
prompt, browser response, and log.

## Prompt handling and external providers

Prompt retention defaults to `discard`: the bounded request prompt exists only for the
active workflow and is not written to persistence or ordinary diagnostics. After the
teacher explicitly chooses `persist`, the prompt is stored in `retained_prompts`, is
included in the full privacy export, and is deleted with its simulation.

Before provider-backed generation, the teacher is told that SimProof sends the prompt
and minimum workflow context to the configured OpenAI/Codex service. Depending on the
operation, that context can include a concept specification, candidate source,
artifact hashes/bindings, structured verification findings, and bounded runner failure
classifications. SimProof does not send provider credentials in prompts, database or
host paths, administrator/session material, unrelated simulations, raw environment,
or unrestricted logs. Provider retention and processing are governed by the deployer’s
provider account and terms, outside the local SimProof data store.

For durable provenance, SimProof stores the configured provider, model, and template
identifiers and the bounded request or Codex thread identifiers returned by the
provider. It also stores request/token counts, aggregate cost accounting, artifact
hashes and sizes, findings references, and stable error classifications. Discard-mode
prompts are not persisted in those records. Provider credentials, raw responses, and
raw reasoning are never persisted or written to ordinary logs.

Bundled verified examples require no provider communication. Telemetry and external
diagnostics are independently disabled by default and require explicit configuration
of both the enable flag and HTTPS destination. Product content is never silently used
as telemetry.

## Backup, export, deletion, and retention

- A backup contains the database, referenced artifact objects, administrator credential
  and bootstrap/settings state. It excludes active sessions, environment files,
  provider/bootstrap/session plaintext secrets, telemetry tokens, and diagnostics.
  Restore never revives an existing session cookie.
- A teacher simulation export is allowlisted to the selected simulation, versions,
  content lineage, generation/attempt outcomes, immutable scientific evidence provenance,
  findings, publication history, license metadata, and referenced content. Operational
  orchestration control data—idempotency hashes, transition journals, additional provider
  request/thread identifiers, budgets, usage/cost accounting, and reservations—is
  backup-only because it is not required to interpret the exported content or its trusted
  verification evidence. The export excludes authentication, configuration, other
  simulations, and diagnostics.
- A full privacy export reads settings, retained prompts, simulation metadata, and
  hash-verified artifact content from one locked SQLite snapshot. Collection is
  bounded incrementally and fails closed when its UTF-8 JSON would exceed 64 MiB;
  it never returns a partial or metadata/artifact-mismatched export.
- Simulation deletion removes the selected aggregate and unshared objects. Shared
  content hashes remain until their last reference is removed. Authentication settings
  are unaffected.
- Local simulation records persist until teacher deletion. Immutable verification and
  publication history persists with that simulation. Sessions persist only until
  rotation, revocation, logout, or bounded expiry. Discard-mode prompts are not retained.
- Local structured diagnostics are bounded and redacted. External diagnostics and
  telemetry remain off unless the deployment owner explicitly opts in. Operator
  diagnostic bundles are private local files, are excluded from backup and teacher
  exports, and include logs only through the explicit `logs` category.
