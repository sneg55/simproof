# Upgrades, restore validation, and rollback

## Safety contract

An upgrade changes a coordinated deployment: application images, the independently
pinned runner image, SQLite schema and migration journal, content-addressed artifact
format, configuration contract, and volume layout. Treat every one as release state.
Never run an older application against data already migrated by a newer release unless
that exact path is explicitly covered by a release fixture.

The only general rollback across a schema or artifact-format change is the compatible
old release plus the complete, validated pre-upgrade backup. SimProof does not promise
down migrations. Never edit an applied migration, migration checksum, database row,
artifact hash, or backup manifest to force compatibility.

## Before changing images

The names below are examples. Replace each with a unique lowercase release/change
identifier accepted by the maintenance command; names are never overwritten or reused.

1. Read the target release notes and compare its required Node line, supported
   `linux/amd64`/`linux/arm64` images, Compose/configuration contract, migration range,
   artifact format, runner protocol, and runner image digest with the active release.
2. Confirm the current stack is ready. Resolve any migration, database, artifact, or
   launcher failure before taking a release backup.
3. Stop accepting new generation work. Allow active work to reach a durable terminal
   state or cancel it through the normal workflow; verify the launcher has no active
   disposable runner.
4. Record the current source/release identifier and immutable image digests in the
   operator change record. Record configuration **presence**, not secret values. Keep
   the current private `.env` separately from every backup and diagnostic bundle.
5. Create a protected backup through the coordinated persistence maintenance path in
   [Backup and restore](backup-restore.md). Use a new bounded name; the command refuses
   to overwrite an archive:

   ```sh
   docker compose --env-file .env --env-file .simproof/deployment.generated.env \
     run --rm --no-deps orchestrator \
     backup --name pre-upgrade
   mkdir -m 700 simproof-protected-backups
   docker compose --env-file .env --env-file .simproof/deployment.generated.env cp \
     orchestrator:/var/lib/simproof/backups/pre-upgrade \
     ./simproof-protected-backups/pre-upgrade
   ```

   Do not copy a live SQLite file, a Docker volume, or the artifact directory
   independently. The protected copy contains administrator credential material (not
   active sessions); restrict it as confidential recovery data.
6. Validate that archive before proceeding: manifest version, database digest/schema,
   migration checksums, foreign keys, artifact count/set/digests/lengths, forbidden
   fields, total bounds, and absence of administrator sessions must all pass.
7. Perform a restore rehearsal into a new empty staging data root with the current
   compatible release:

   ```sh
   docker compose --env-file .env --env-file .simproof/deployment.generated.env \
     run --rm --no-deps orchestrator \
     restore-validate --backup pre-upgrade --name pre-upgrade-rehearsal
   ```

   This validates and stages the restored root without activating it or mutating
   `current`. Retain the validated archive and untouched active data.

**STOP:** no migration or image change is permitted without a complete backup and a
successful independent validation/restore rehearsal. A diagnostic bundle, teacher
simulation export, raw volume copy, or SQLite file alone is not a substitute.

## Validate the target configuration

Check out or unpack the exact target release. Reconcile `.env` by field name against
its `.env.example`; do not overwrite the private file or copy secret values into the
repository. In particular:

- keep the public origin and loopback publication policy exact;
- add any newly required value before starting the target;
- keep telemetry and external diagnostics disabled unless separately approved;
- regenerate the target release's host-specific deployment fragment so orchestrator
  and launcher bind the same immutable runner identity; and
- never reuse the session secret as the launcher token.

Then run the target release's static deployment validation before it can touch data:

```sh
node scripts/prepare-deployment.mjs
node scripts/prepare-deployment.mjs --check
docker compose --env-file .env --env-file .simproof/deployment.generated.env \
  config --quiet
docker compose --env-file .env --env-file .simproof/deployment.generated.env build
pnpm test:deployment
```

Inspect the rendered policy without publishing it: all runtime users remain numeric
and non-root; only `web` publishes host loopback; only the launcher mounts the Docker
socket; only the orchestrator joins the provider-configured network and receives
provider credentials; the web-only non-internal edge network still permits generic
egress, so provider exclusivity is not network-enforced; data/log volume destinations
are unchanged or explicitly migrated; and disposable runner
network/mount/capability/resource restrictions remain fixed.

## Upgrade procedure

1. Stop the active Compose stack without deleting volumes:

   ```sh
   docker compose --env-file .env --env-file .simproof/deployment.generated.env down
   ```

2. Preserve the old release checkout/images, private configuration, active volumes,
   and validated pre-upgrade archive. Do not prune them.
3. With the target release checked out, run its explicit migration operation. A
   non-empty database requires a new pre-migration backup name, so the command cannot
   silently migrate without another validated snapshot:

   ```sh
   docker compose --env-file .env --env-file .simproof/deployment.generated.env \
     run --rm --no-deps orchestrator \
     migrate --backup target-pre-migration --confirm-stopped
   ```

   The operation validates configuration and storage, verifies all previously applied
   migration checksums, creates the coordinated backup, applies only the next numbered
   migrations under the migration lock, and fails closed. Application startup then
   sees a no-op migration state rather than becoming the first process to alter data.
4. If migration succeeds, start the target launcher, run the deployment check against
   its daemon/image readiness, and only then start the full target stack:

   ```sh
   docker compose --env-file .env --env-file .simproof/deployment.generated.env \
     up -d runner-launcher
   docker compose --env-file .env --env-file .simproof/deployment.generated.env \
     run --rm --no-deps orchestrator check
   docker compose --env-file .env --env-file .simproof/deployment.generated.env up -d
   docker compose --env-file .env --env-file .simproof/deployment.generated.env ps
   ```

5. Require every service health check and the browser-visible readiness endpoint to
   pass. Readiness must not contact a provider or execute generated code.
6. Sign in again if session state was intentionally invalidated and check both bundled
   examples without provider credentials. The fake-provider flow belongs only to the
   repository deployment harness on disposable test state; it is prohibited in the
   production image entrypoint and normal application process. If real-provider access
   is explicitly approved and configured, perform only the operator-approved minimal
   workflow.
7. Verify persistence across a controlled restart, publication/export of existing
   verified content, local redacted diagnostic creation, and shutdown cleanup. Do not
   call the launcher directly. Runner execution belongs to the repository deployment
   harness or an explicitly approved real-provider workflow through the application.
8. Keep the pre-upgrade archive and old compatible release under the operator's
   retention policy. Remove staging data only after identifying it as the owned staging
   root and confirming it is not active.

## Failure before activation

If target validation or the staged migration fails, do not point the target at active
data. Preserve the redacted stable error ID, create a local diagnostic bundle if safe,
stop target containers, and continue using the unchanged active release. Do not retry
by deleting the migration journal, widening permissions, skipping artifact checks, or
changing the runner allowlist to a mutable tag.

## Failure after active migration

Take the deployment out of writable-ready state. Preserve the failed upgraded root for
diagnosis; do not let the old release open it. Recovery is an offline replacement:

1. stop every SimProof service and verify the launcher has cleaned all disposable
   runners;
2. select the exact old release and image digests recorded before the upgrade, then
   run its `node scripts/prepare-deployment.mjs` and `--check` so the generated
   fragment binds that release's runner;
3. restore the validated pre-upgrade archive into a **new empty** candidate with the old
   compatible release:

   ```sh
   docker compose --env-file .env --env-file .simproof/deployment.generated.env \
     run --rm --no-deps orchestrator \
     restore-validate --backup pre-upgrade --name rollback-candidate
   ```

4. reject unexpected paths, duplicate entries, links, special files, unsupported
   versions, size/count excess, checksum mismatch, extra/missing artifacts, sessions,
   or incompatible stored records before activation;
5. open staged SQLite with foreign keys enabled and run integrity, foreign-key,
   migration-checksum, schema, runtime-record, and artifact-reference/hash checks;
6. atomically activate the validated candidate while retaining the upgraded root only for
   diagnosis:

   ```sh
   docker compose --env-file .env --env-file .simproof/deployment.generated.env \
     run --rm --no-deps orchestrator \
     restore-activate --name rollback-candidate \
     --rollback upgraded-root-for-diagnosis --confirm-stopped
   ```

7. start the old release's launcher, run `orchestrator check`, then start the full old
   Compose stack using both environment files. Require readiness and sign in again.
   Pre-restore session cookies must remain invalid.

If activation fails, reselect the untouched prior root appropriate to that release.
Never merge the restored database into the failed root, restore only artifacts, accept
a teacher export as a backup, or run a destructive down migration.

Never activate `upgraded-root-for-diagnosis` under the old release. If the restored
root fails readiness, stop the stack and stage and validate a fresh candidate from a
compatible pre-upgrade backup. A rollback command is safe only when it selects a
separately named prior root that was independently proven compatible with the release
being restarted; the retained upgraded root is not such a candidate. Root selection
and release selection are one compatibility decision, not independent retries.

Restore and rollback commands refuse to run while the application-running marker
exists. If a host crash leaves a stale marker, first prove every SimProof application
container and generated runner is stopped, then run only:

```sh
docker compose --env-file .env --env-file .simproof/deployment.generated.env \
  run --rm --no-deps orchestrator \
  maintenance-unlock --confirm-stopped
```

Never use this command to bypass a live maintenance or application lock.

## Rollback limitations

| Situation | Supported action |
|---|---|
| Target images fail before touching data | Restart the recorded old images with unchanged active volumes. |
| Target release has only an explicitly compatible, fixture-tested no-op schema path | Follow that release's stated rollback procedure; do not infer compatibility from matching table names. |
| Target applied any migration or artifact-format change | Restore the complete pre-upgrade archive with the old compatible release. |
| Backup validation or restore rehearsal failed | No upgrade or rollback is authorized; preserve data and diagnose. |
| Active database, migration journal, or referenced artifact is corrupt | Keep the deployment not-ready; recover only from a validated compatible backup. Do not regenerate evidence or weaken integrity checks. |
| Runner protocol/image cannot meet the old or new isolation profile | Leave generation disabled. Seed content may remain available only if application readiness safely permits it. |

## Post-change evidence

Retain a bounded operator record containing release and image identifiers, source and
target schema/artifact-format versions, validation results, backup manifest identity,
readiness status, and stable error IDs. Do not retain `.env`, credentials, cookies,
prompts, provider responses, generated content, raw container output, or stack traces
in that record.

Run the authoritative repository and deployment gates for any maintained change:

```sh
pnpm check
pnpm test:deployment
```

See [Supported deployment](deployment.md), [Deployment configuration](configuration.md),
[Backup and restore](backup-restore.md), and [Observability](observability.md).
