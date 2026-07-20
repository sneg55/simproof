# ADR 0003: Metadata storage and generated artifacts

## Status

Accepted

## Context

Simulation generation has durable lifecycle state, provenance, verification reports,
and potentially large source or data artifacts. Flat files alone do not provide safe
concurrent state transitions or a migration path. Storing every artifact as a mutable
database value would make deduplication, integrity checks, and recovery harder.

The product must also preserve who controls user-generated material and which export
license metadata was selected without confusing that metadata with a legal grant of
rights.

## Decision

- SQLite stores transactional metadata, including lifecycle state and references to
  generated artifacts.
- The persistence package uses Node 24's built-in
  [`node:sqlite`](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
  driver. The supported
  deployment pins Node 24.15 or newer within the Node 24 LTS line, where this API is a
  release candidate, and disables loadable SQLite extensions. This avoids a separate
  architecture-specific native addon while keeping SQLite embedded in the application
  process.
- Generated artifacts are stored as content-addressed files. Metadata refers to an
  artifact by its content identity rather than by a mutable user-chosen path.
- Artifact provenance and verification records retain the applicable trusted policy
  version and the identity of the verified content. A changed artifact is new content
  and must not inherit another artifact's verification result.
- User-generated artifacts retain deployer/user ownership. Each artifact records
  configurable export-license metadata selected under the deployment's policy.
- License metadata is descriptive metadata; setting it does not create ownership or
  grant rights that the deployer or user does not possess.

## Consequences

- Lifecycle transitions and their artifact references can be committed atomically in
  SQLite while artifact bytes remain immutable and independently integrity-checkable.
- Deployment and recovery checks must verify the pinned Node runtime supplies the
  expected `node:sqlite` API on every supported architecture.
- Backup, restore, garbage collection, and migration procedures must coordinate the
  database and content-addressed file store.
- Duplicate artifact content can share storage identity, but authorization, provenance,
  lifecycle, and export-license records remain metadata concerns.
- An artifact mutation creates a new content identity and requires verification under
  the applicable policy before it can be represented as verified.
- Deployments must preserve both metadata and artifact files; copying either one alone
  is not a complete backup.

## Rejected alternatives

- **Flat JSON as production persistence:** rejected because concurrent writes,
  transactional lifecycle changes, migrations, and consistent recovery require a
  transactional metadata store.
- **Mutable artifact paths as identity:** rejected because content could change while
  retaining stale provenance or a stale verification result.
- **All artifact bytes stored in SQLite:** rejected as the initial design because a
  content-addressed file store provides clearer immutable identities and artifact
  lifecycle operations.
- **A fixed license applied to all generated artifacts:** rejected because generated
  artifacts retain deployer/user ownership and require configurable export-license
  metadata.

## Conditions for revisiting

Revisit the storage engines only when measured scale, concurrency, or operational needs
cannot be met by the supported SQLite and content-addressed-file design, and only with a
tested migration and recovery path. Revisit artifact ownership or license metadata only
after product and legal review; storage implementation must not be used to infer or
silently change legal rights.
