# Backup, restore, export, deletion, and artifact recovery

## What constitutes SimProof data

A complete durable data set has two coordinated parts:

1. the SQLite database and migration journal; and
2. every content-addressed object referenced by retained metadata.

Copying only one part is not a backup. Provider credentials, administrator password
material, session secrets, environment files, and external diagnostics configuration
are deliberately outside this data set and must never appear in backup or export
archives. Operators manage those secrets separately.

The low-level backup and restore APIs accept operator-configured absolute paths; those
paths are privileged configuration and must never be copied from request input. A
caller that supplies `operationRoot` gets an additional lexical containment check for
the backup and publication paths. Service and command boundaries must supply an
application-owned operation root or perform an equivalent allowlisted-path check.

The operation root and its ancestors must be owned by the application account and
must not be writable by untrusted processes running as that same UID. Component and
symlink checks are defense in depth: pathname checks alone cannot prevent a same-UID
process from replacing an intermediate directory between validation and use. A host
that cannot provide this ownership boundary must place backup and restore behind a
more strongly isolated privileged helper.

## Supported Compose command boundary

The supported deployment exposes these operations only through the orchestrator
image's fixed entrypoint: `backup`, `migrate`, `restore-validate`, `restore-activate`,
`rollback`, and `maintenance-unlock`. It derives bounded operator names beneath
`/var/lib/simproof/backups`, `/var/lib/simproof/restores`, and
`/var/lib/simproof/rollbacks`; it does not accept request-derived or arbitrary host
paths. Every invocation must use both the private `.env` and the host-specific
`.simproof/deployment.generated.env`. Exact commands and the required offline ordering
are in [Upgrades, restore validation, and rollback](upgrades.md).

`restore-validate` writes only a new staging root. `restore-activate` and `rollback`
require `--confirm-stopped` and refuse an application-running marker. Never use
`maintenance-unlock` until every application container and disposable runner is
independently proven stopped. These command checks do not relax the ownership,
archive-validation, or integrity rules below.

## Backup archive contract

A successful backup is a versioned archive containing:

- a transactionally consistent SQLite snapshot, created through SQLite's supported
  backup/snapshot mechanism rather than by copying a live database file;
- referenced artifact objects at their store-owned digest paths; and
- a canonical manifest with backup format version, database schema version, creation
  metadata, object digests, byte lengths, artifact format versions, and archive-entry
  checksums.

The manifest contains no process environment, application configuration dump,
credential, session value, or arbitrary diagnostic payload. It is sufficient to
verify completeness without trusting filenames from archive input.

### Creating a backup

1. Acquire the persistence maintenance lock so schema changes, deletion, and the
   metadata-reference snapshot cannot interleave.
2. Create a consistent SQLite snapshot. Do not copy `-wal` or `-shm` files as an
   ad-hoc substitute for the SQLite snapshot API.
3. Read the referenced artifact-hash set from that snapshot, not from a later live
   connection.
4. Copy each object into a staging archive while recalculating its SHA-256 digest and
   byte length. A missing, corrupt, or unsupported object fails the backup.
5. Write the canonical manifest, then validate its creation date, database size and
   digest, artifact count, per-object sizes, total artifact bytes, staged database,
   foreign keys, object set, hashes, and the forbidden-secret-field allowlist using
   bounded reads.
6. Sync the staged database, manifest, artifact directories, and staging directory;
   rename the completed archive atomically; then sync the publication parent. On
   failure, remove only the owned staging/publication attempt and leave any previous
   complete backup untouched.

Artifact objects are immutable, so objects added after the database snapshot do not
belong to that backup. Objects deleted by cleanup cannot race the backup because both
operations use the maintenance protocol.

## Restore procedure

Restore is an offline replacement operation, not a merge. It targets a new empty
staging data root and does not mutate the active database or artifact store until all
validation succeeds.

1. Stop application writes and retain the current data root as the rollback source.
2. Read only a supported manifest version. Reject duplicate archive entries, absolute
   paths, `..` segments, symlinks, special files, unexpected roots, and values above
   configured entry/count/size limits before extraction.
3. Extract into a newly created staging root using store-derived paths.
4. Recalculate every archive-entry checksum and every artifact digest/byte length.
   Require exact agreement between the manifest, database references, and objects;
   extra objects are rejected or reported rather than silently trusted.
5. Open the staged SQLite database with foreign keys enabled. Run SQLite integrity and
   foreign-key checks, validate runtime schemas for stored boundary values, and confirm
   the schema version is supported by the running release.
6. Start against the staged root, run required forward migrations, then repeat database
   and artifact integrity checks. Applied migration checksums must match shipped files.
7. Atomically select the validated staged root as active and run readiness checks. If
   activation fails, restore the untouched prior root; never attempt an untested down
   migration.

A restore made by a newer application is not promised to work on an older release.
Rollback means restoring the pre-upgrade backup with the compatible release. Never
edit the migration journal or an applied migration to force compatibility.

## Teacher-owned simulation export

A simulation export is a portable content package, not a database backup and not an
application configuration dump. It contains only the selected simulation and version
records needed to understand the content, their artifact payloads, immutable
generation/verification provenance, findings, scope/limitations, and recorded
export-license metadata.

Export follows an explicit allowlist. It omits provider credentials, session/auth
data, administrator data, process environment, internal storage paths, secret-bearing
diagnostics, unrelated simulations, and unselected artifacts. References use content
hashes and portable archive names. Before publication, export recalculates artifact
hashes and validates every included structured record. Missing or corrupt evidence
fails closed; it is never labeled current or verified in the export.

Authentication session IDs, cookies, and session secrets are omitted. A bounded Codex
thread/session identifier is generation provenance rather than authentication material
and remains in the selected simulation's allowlisted generation-run records.

Importing a teacher export, if added later, requires its own untrusted-input design.
The restore command must not accept a teacher export as though it were a trusted
backup.

## Simulation deletion

Deletion is explicit and scoped to a teacher-owned `Simulation`; it is not represented
by changing the version to another lifecycle state.

1. Begin an immediate write transaction and load the complete owned aggregate plus
   all referenced artifact hashes.
2. Delete versions, runs, attempts, concept records, generated-artifact metadata,
   verification evidence/findings, and publication records through the repository's
   defined deletion path. Any unexpected foreign-key reference aborts the transaction.
3. Commit the metadata deletion before touching content objects.
4. Under the artifact-cleanup lock, query retained metadata for each candidate hash.
   Delete an object only when the database proves it has no remaining reference.
5. Record a redacted result containing counts and hashes, not deleted content or
   secrets. Repeating the request is safe and does not broaden its scope.

The post-commit object step means interruption can leave an unreferenced object, but
cannot leave retained metadata pointing at an object deleted by this workflow. The
orphan-cleanup procedure handles such leftovers. Deduplicated objects referenced by
another simulation are preserved.

## Orphan cleanup and integrity audit

Run cleanup through the artifact-store API under the same maintenance protocol as
backup and deletion. Start with dry-run/report mode.

The audit classifies, rather than conflates, these cases:

| Condition | Required action |
|---|---|
| Referenced object is present and hash-valid | Keep. |
| Referenced object is missing or corrupt | Report a high-severity integrity failure; fail current verification/badge checks; do not delete metadata or regenerate silently. |
| Valid object is unreferenced | After the configured safety/grace policy and a repeat reference check, delete using its digest-derived path. |
| Abandoned store-owned staging file | Remove only after proving no live writer owns it and it exceeds the staging safety policy. |
| Unexpected file, symlink, or path | Quarantine/report without following it. Never recursively delete an unvalidated path. |

Cleanup derives paths only from validated canonical hashes and stays beneath the
configured root. It never accepts a request path or follows symlinks. After cleanup,
run database foreign-key checks and a referenced-object integrity pass.

Cleanup reports discovered, deleted, grace-skipped, and deferred artifact identities
separately. It likewise reports counts for recognized store-owned temporary files that
were deleted, skipped, or deferred; it never treats an arbitrary filename as owned.
If deletion is deferred, the committed content-addressed object remains the durable
retry record. An operator reruns destructive orphan cleanup, which rediscovers the
identity from the store and retries it after another database reference check. A
partial failure must not be reported as complete cleanup.

## Migration and recovery rules

- Apply numbered migrations in order under an exclusive migration lock. Each migration
  and its journal write are transactional where SQLite permits.
- Verify the checksum of every already-applied migration before applying a new one.
  A mismatch is a hard stop, not a reason to rewrite history.
- Enable foreign keys on every connection and run foreign-key/integrity checks after
  migration.
- Take and validate a complete backup before a migration with non-trivial data
  transformation or artifact rebinding.
- Test fresh installation and upgrades from every supported release fixture. Test
  failure rollback without relying on destructive down migrations.
- Treat normalization or digest changes as explicit artifact-format migrations that
  create new identities and atomically update metadata; never overwrite existing
  content under its old hash.

If database integrity, migration checksums, or referenced artifacts cannot be
validated, keep the deployment out of writable-ready state. Preserve the data root
for diagnosis, use redacted diagnostics, and recover from a validated compatible
backup.
