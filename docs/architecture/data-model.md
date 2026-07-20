# Durable data model

## Purpose and boundaries

SimProof persists transactional metadata in SQLite and immutable payloads in one
content-addressed artifact store. This is a single-tenant, teacher-owned data model;
it contains no student identity, roster, grading, tenant, or cross-user authorization
records. [ADR 0003](../decisions/0003-storage-and-artifacts.md) owns the storage
decision, and [ADR 0004](../decisions/0004-privacy-posture.md) owns the privacy
boundary.

SQLite rows refer to artifacts by a canonical `sha256:<64 lowercase hex>` digest.
They never contain caller-supplied absolute or relative host paths. Application-issued
record identifiers are UUIDs and are not artifact identities.

## Aggregate relationships

```text
Simulation
  +-- SimulationVersion
      +-- GenerationRun
      |   +-- ConceptSpec
      |   +-- GenerationAttempt
      |       +-- GeneratedArtifact (immutable artifact bundle)
      +-- VerificationRun
      |   +-- VerificationFinding
      |   +-- VerificationPolicyReference
      |   +-- DomainPackReference
      +-- PublishedArtifact
          +-- current passing VerificationRun

ConceptSpec/GeneratedArtifact/VerificationRun -- role bindings --> StoredArtifact
StoredArtifact -- content hash --> immutable artifact-store object
```

`Simulation` and `SimulationVersion` form the teacher-owned aggregate. Runs,
attempts, evidence, and publication records are retained as history while that
aggregate is retained. Reference records identify installed trusted code; they do
not store or make trusted policy executable from the database.

## Records and constraints

| Record | Required identity and relationships | Integrity rules |
|---|---|---|
| `Simulation` | Primary key; title and creation/update metadata | Owns versions. A version ordinal is unique within a simulation. |
| `SimulationVersion` | Primary key; required simulation foreign key; version ordinal; lifecycle state; optimistic revision; optional active concept, generated-artifact, exact core/renderer/manifest bundle, and verification-run references | The `(simulation_id, version_ordinal)` pair is unique. Verification-relevant bindings change only in a transaction that also invalidates current evidence. |
| `GenerationRun` | Primary key; required version foreign key; explicit operational status/outcome and bounded provider/template/thread provenance | Provider failure, runner failure, cancellation, and budget exhaustion are distinct from scientific rejection. No credential value is provenance. |
| `GenerationAttempt` | Primary key; required run foreign key; one-based attempt ordinal; terminal outcome | `(generation_run_id, attempt_ordinal)` is unique. Completed attempts are immutable, and one run cannot exceed the configured three-attempt cap. |
| `ConceptSpec` | Primary key; required version and generation-run foreign keys; schema version; domain; exact `concept-spec` stored-artifact ID and content hash | Immutable after generation starts. The normalized JSON lives only in the CAS; the record selects installed domain behavior but never defines equations, invariants, or tolerances. |
| `StoredArtifact` | Primary key; one allowlisted role; format/normalization version; canonical hash; byte length; media type | Roles are `core-source`, `renderer-source`, `renderer-data`, `manifest`, `concept-spec`, and `verification-report`. The record contains no owner path or inline payload. |
| `GeneratedArtifact` | Primary key; required generation-attempt ownership; exact core, renderer, and manifest stored-artifact ID/role/hash bindings; license metadata | The bundle is immutable provenance. Several bundles may share content objects, but provenance and license metadata remain separate. Host paths are forbidden. |
| `VerificationPolicyReference` | Primary key; policy ID, semantic version, and trusted content hash | The tuple is unique and immutable. It identifies application-owned installed policy; database content cannot replace policy code. |
| `DomainPackReference` | Primary key; domain-pack ID, semantic version, and trusted content hash | The tuple is unique and immutable and must resolve to an installed trusted domain pack. |
| `VerificationRun` | Primary key; required version, generated-artifact, exact bundle, policy, domain-pack, runner, bounded canonical dependency-set, and report stored-artifact ID/hash bindings; status/verdict | A terminal run is append-only. Re-verification creates another run. Its result applies only to its exact recorded bindings. |
| `VerificationFinding` | Primary key; required verification-run foreign key; stable finding ID; severity; structured measurements/message | Findings are append-only children of an immutable run. Their order/key is unique within that run. |
| `PublishedArtifact` | Primary key; required version, generated-artifact, and passing verification-run foreign keys; exact core/renderer/manifest bundle and verification-report ID/hash bindings; selected export-license metadata | Creation is allowed only when evidence is current. A later invalidation preserves publication history but removes current publication/badge eligibility. |

Foreign keys are enabled on every connection. Required parents use restrictive
foreign keys during ordinary repository operations so evidence cannot be orphaned by
an incidental delete. The explicit simulation-deletion workflow removes the complete
aggregate in one transaction, after collecting candidate artifact hashes for
post-commit orphan cleanup. Trusted policy and domain-pack references remain while any
retained verification run refers to them.

Timestamp fields record UTC instants. Stored structured values cross a shared runtime
schema before insertion; unknown and oversized values are rejected rather than
preserved for forward compatibility.

## Lifecycle transitions

The persistence package is the sole owner of durable transition rules. Callers submit
the expected optimistic revision, and a stale revision fails without a partial write.

| From | Allowed destinations | Required condition |
|---|---|---|
| `draft` | `generating`, `archived` | Generation has a new durable run; archive is an explicit teacher action. |
| `generating` | `verifying`, `draft`, `archived` | A valid candidate enters verification. Cancellation or a terminal operational outcome returns the editable version to `draft` while the run retains its outcome. |
| `verifying` | `verified`, `rejected`, `stale`, `archived` | Only a trusted passing report yields `verified`; only a trusted scientific-failure report yields `rejected`. An `inapplicable` report or concurrent binding mismatch yields `stale`, never a current verdict. |
| `rejected` | `generating`, `archived` | Repair starts a new immutable attempt/run within its cap; prior findings remain unchanged. |
| `verified` | `published`, `stale`, `archived` | Publish and badge checks must succeed in the same transaction. |
| `published` | `stale`, `archived` | Invalidation preserves the prior publication record but removes its current status. |
| `stale` | `generating`, `verifying`, `archived` | New generation or re-verification uses a fresh binding snapshot and creates new evidence. |
| `archived` | none | Archive is a retained terminal lifecycle state; deletion is a separate workflow. |

All other transitions are denied. Operational sub-states such as queued, provider
failure, executing, repairing, or runner failure belong to run/attempt outcomes and
must not be represented as `rejected`.

## Verification validity and staleness

A lifecycle value is not sufficient for a Verified badge. Evidence is current only
when all of the following are true:

- the version is `verified` or `published`;
- the selected terminal verification run passed;
- every current verification-relevant artifact hash equals the run binding;
- policy ID, version, and content hash equal the installed policy and run binding;
- domain-pack ID, version, and content hash equal the installed pack and run binding;
- runner version/semantics and every declared verification dependency equal the run
  bindings; and
- the report artifact exists and passes its content hash and runtime schema checks.

A change to any bound artifact, policy, domain pack, runner semantics, or relevant
dependency marks the version `stale` atomically. The historical verification run and
findings remain unchanged. Missing or corrupt content also fails closed: the version
cannot show a Verified badge or be published. Publication repeats the complete
validity check inside the transaction that creates `PublishedArtifact`.

## Artifact ownership and physical layout

The artifact API accepts a supported artifact role, bytes or normalized structured
content, and an optional declared hash. It does not accept a destination path.
Role-specific, versioned normalization occurs before hashing. A declared hash must
match the normalized bytes.

Objects live beneath the configured data root in a store-owned fan-out derived only
from the validated digest, for example:

```text
artifacts/sha256/ab/cdef...  # `ab` plus the remaining lowercase digest
```

Writes use a temporary file beneath the same data root, verify byte length and digest,
then publish without replacing an existing object. Identical normalized content is
deduplicated. Reading revalidates the digest; missing, substituted, or corrupt content
is an integrity error, never an invitation to regenerate or silently bless content.

Core source, renderer data/source, manifests, concept material, and reports use
distinct artifact roles even when bytes happen to deduplicate. Executable candidate
core content remains runner-only. Stored ownership, provenance, and configurable
export-license metadata do not themselves grant legal rights.

## Immutability, deletion, and secret boundary

Verification runs, findings, terminal attempts, content objects, and publication
snapshots are immutable while retained. Correcting them means appending a new record
or artifact. Mutable lifecycle state and optimistic revisions are changed only through
the central repository transaction.

Deletion is not a lifecycle state. The supported workflow removes one teacher-owned
simulation aggregate, then removes content objects only after proving that no retained
metadata references their hashes. Shared hashes survive until their final reference
is gone.

Provider API keys, Codex/OpenAI credentials, administrator password material, session
cookies/secrets, environment values, and unredacted secret-bearing diagnostics are
forbidden from every record and artifact role. Configuration references may record a
non-secret provider/model identifier, but never a credential value. Boundary schemas
exclude secret fields, and backup/export code uses allowlists instead of serializing
arbitrary configuration or process environment data.

## Schema evolution

All schema changes use ordered, checksummed migrations recorded in a migration
journal. Applied migration files are immutable. A fresh database and every supported
upgrade fixture must reach the same schema. Foreign-key checks and integrity checks
run before an upgraded database becomes writable.

Hash algorithms, canonicalization, or normalization changes are artifact-format
migrations: existing bytes keep their original identity and format version until an
explicit migration creates and rebinds new content. They must never be reinterpreted
or overwritten in place.
