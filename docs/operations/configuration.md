# Deployment configuration

## Configuration boundary

SimProof reads deployment settings only from the orchestrator process environment.
Start from [`.env.example`](../../.env.example), keep the resulting `.env` file outside
source control, make it readable only by the deployment owner, and never paste its
contents into an issue, log, diagnostic bundle, or teacher export. Configuration
errors identify field names, not values. Unknown `SIMPROOF_*` names are rejected so a
misspelling cannot silently weaken the deployment.

Compose interpolation and the orchestrator environment are distinct boundaries. The
host-facing HTTP port and image references are used by Compose; application settings
are passed only to the service that owns them. Do not pass the host environment or the
Docker socket into `web`, `orchestrator`, or a generated-code container.

`node scripts/prepare-deployment.mjs` derives the local immutable runner image ID and
the Docker socket group as seen through the container mount into
`.simproof/deployment.generated.env` with mode `0600`. This
generated file contains deployment authority and is ignored by source control. Do not
edit it, use it on another host, or treat it as a replacement for the private `.env`.
Preparation builds and inspects the runner first, then uses that exact raw image ID for
the unprivileged, networkless socket metadata probe; it neither depends on a separate
cached probe image nor pulls during the probe.
Every Compose command must load both files in this order:

```sh
docker compose \
  --env-file .env \
  --env-file .simproof/deployment.generated.env \
  config --quiet
```

## Required application settings

The supported production profile requires every row below. A value is shown here only
when it is a fixed, non-secret deployment constant.

| Name | Owner | Requirement |
|---|---|---|
| `NODE_ENV` | orchestrator | Must be `production`. |
| `SIMPROOF_DEPLOYMENT_MODE` | orchestrator | `loopback` for the default host-local profile; `network` only behind the required TLS reverse proxy. |
| `SIMPROOF_LISTEN_HOST` | orchestrator | Compose uses `0.0.0.0` inside the private `application` network. The orchestrator port must remain unpublished. |
| `SIMPROOF_PORT` | orchestrator | Compose uses `3000`; accepted range 1–65535. |
| `SIMPROOF_DATABASE_PATH` | orchestrator | Absolute path to the SQLite file in `simproof-data`; Compose uses `/var/lib/simproof/current/metadata.sqlite`. |
| `SIMPROOF_ARTIFACT_ROOT` | orchestrator | Absolute artifact directory in `simproof-data`; Compose uses `/var/lib/simproof/current/artifacts`. It must not equal, contain, or be contained by the database path. |
| `SIMPROOF_ADMIN_BOOTSTRAP_SECRET` | orchestrator | Deployer-generated secret of 32–1,024 characters with at least 12 distinct characters. It is accepted only for one-time administrator setup. |
| `SIMPROOF_SESSION_SECRET` | orchestrator | Independent deployer-generated high-entropy secret of at least 32 characters. Never reuse the bootstrap or runner token. |
| `SIMPROOF_ALLOWED_ORIGINS` | orchestrator | Exact browser-visible origin. The default is the matching `http://127.0.0.1:<port>` loopback origin. Network mode requires exact HTTPS origins. No wildcard, credentials, path, query, or fragment. |
| `SIMPROOF_RUNNER_ENDPOINT` | orchestrator | Compose uses `http://runner-launcher:4318` on the private runner-control network. Do not publish it or point it at a general container API. |
| `SIMPROOF_RUNNER_TOKEN` | orchestrator and launcher | Independent 32–4,096 character bearer secret shared only by these two services. Missing or weak authentication disables generation. |
| `SIMPROOF_RUNNER_IMAGE` | orchestrator and launcher | Exact allowlisted local runner image ID as `sha256:<64 lowercase hex>`. Names, tags, and name-qualified digests are rejected. |
| `SIMPROOF_RUNNER_VERSION` | orchestrator | Compose defaults to semantic version `1.0.0`; it binds runner and verification provenance and must match the deployed protocol/image release. |

Generate each secret independently with an operating-system credential generator.
Write it directly into the private environment file or secret manager; do not print it
into shell history. The repository does not contain defaults. Completing browser
bootstrap replaces the one-time bootstrap credential with the administrator password,
but the required configured value remains sensitive. It cannot bootstrap a second
administrator after the one-way completion record exists.

## Optional application settings

| Name | Default or behavior | Safety rule |
|---|---|---|
| Provider/Codex set below | Entire provider set absent; bundled verified examples remain usable while the runner binding stays configured. | Live generation is available only when the complete atomic provider set and required runner binding validate. Any partial provider set fails configuration rather than starting a partly trusted workflow. |
| `SIMPROOF_TRUSTED_PROXY_ADDRESS` | No forwarded metadata is trusted. | Leave unset in the supported Compose topology: `web` discards caller forwarding metadata. This field is reserved for a separately reviewed non-Compose integration with one exact immediate proxy IP; never use a subnet or wildcard. |
| `SIMPROOF_SESSION_TTL_SECONDS` | `28800` | Integer from 900 through 604800; idle lifetime cannot exceed it. |
| `SIMPROOF_SESSION_IDLE_SECONDS` | `3600` | Integer from 300 through 86400. |
| `SIMPROOF_MAX_ACTIVE_SESSIONS` | `8` | Integer from 1 through 128. |
| `SIMPROOF_LOCAL_AUTH_BYPASS` | `false` | Test-only password-free educator access. It is accepted only with `NODE_ENV=test`, loopback deployment, exact `http://127.0.0.1:<port>` origins, no trusted proxy, and both external exporters disabled. Never enable it in a production or network deployment. |
| `SIMPROOF_MAX_REQUEST_BYTES` | `65536` | Integer from 16384 through 1048576. Compose passes the same validated limit to the web edge and orchestrator so the proxy cannot reject an otherwise accepted application request. |
| `SIMPROOF_MAX_PROMPT_CHARACTERS` | `16384` | Integer from 256 through 65536. |
| `SIMPROOF_PROMPT_RETENTION` | `discard` | Keep `discard` unless the teacher explicitly opts into local retention. |
| `SIMPROOF_DIAGNOSTIC_LOG_ROOT` | Beside the database when not supplied | Compose uses `/var/log/simproof`. It must be absolute and must not overlap the database or artifact root in either direction. |
| `SIMPROOF_DIAGNOSTIC_LOG_MAX_BYTES` | `8388608` | Per-file bound from 65536 through 16777216. |
| `SIMPROOF_DIAGNOSTIC_LOG_FILES` | `3` | Rotated-file count from 1 through 10. |
| `SIMPROOF_TELEMETRY_ENABLED` | `false` | The supported Compose topology forces this off. A separately reviewed non-Compose integration may enable only the documented allowlisted metrics export; endpoint presence alone never enables export. |
| `SIMPROOF_TELEMETRY_ENDPOINT` | Absent | Reserved for a separately reviewed non-Compose integration and not forwarded by Compose. It must be an exact HTTPS URL when telemetry is explicitly enabled there. |
| `SIMPROOF_EXTERNAL_DIAGNOSTICS_ENABLED` | `false` | The supported Compose topology forces this off. Diagnostic-bundle upload is not part of the supported Compose procedure. |
| `SIMPROOF_EXTERNAL_DIAGNOSTICS_ENDPOINT`, `SIMPROOF_EXTERNAL_DIAGNOSTICS_TOKEN` | Absent | Reserved for a separately reviewed non-Compose integration and not forwarded by Compose. Presence does not authorize content export. Never put either value in a bundle. |

## Password-free local browser testing

Use the committed Compose override when testing the educator interface on the same
machine and password flows are outside the test scope:

```sh
docker compose \
  --env-file .env \
  --env-file .simproof/deployment.generated.env \
  -f compose.yaml \
  -f compose.local-test.yaml \
  up -d
```

The override changes only the orchestrator to `NODE_ENV=test` and enables
`SIMPROOF_LOCAL_AUTH_BYPASS=true`. The web port remains bound to `127.0.0.1`; the
orchestrator and launcher ports remain unpublished. The server returns an ephemeral
in-memory educator session, keeps mutation CSRF checks active, and labels the header
`Local test access`. It does not put a password, session token, or server environment
value in the browser bundle.

Do not use this override for authentication testing, shared machines, network exposure,
or production data. Stop the override stack before starting the normal production
profile; the normal `compose.yaml` keeps `NODE_ENV=production` and the bypass disabled.

## Atomic live-generation settings

The supported Compose topology configures the authenticated runner binding even in
seed-only mode, so readiness can prove local launcher availability without executing
generated code. Seed-only mode is the complete absence of the provider/Codex settings
in the first five rows below. To enable live generation, configure every one of those
rows together. A partial provider set is a startup error. Provider credentials remain
only in the orchestrator; model IDs and prices are explicit deployment policy, not
values accepted from a browser or provider response.

| Name | Constraint |
|---|---|
| `OPENAI_API_KEY`, `CODEX_API_KEY` | Independent bounded server credentials. Never pass either to `web`, launcher, disposable runner, generated artifacts, diagnostics, or logs. |
| `SIMPROOF_OPENAI_MODEL`, `SIMPROOF_CODEX_MODEL` | Explicit model IDs, 1–128 characters, using only letters, digits, `.`, `_`, `:`, `/`, or `-`. Review model changes as provider and compatibility changes. |
| `SIMPROOF_OPENAI_INPUT_PRICE_MICROUSD_PER_MILLION`, `SIMPROOF_OPENAI_OUTPUT_PRICE_MICROUSD_PER_MILLION` | Integers from 1 through 100000000 defining the approved OpenAI input/output price policy in micro-US-dollars per million tokens. |
| `SIMPROOF_CODEX_INPUT_PRICE_MICROUSD_PER_MILLION`, `SIMPROOF_CODEX_OUTPUT_PRICE_MICROUSD_PER_MILLION` | Integers from 1 through 100000000 defining the approved Codex input/output price policy in micro-US-dollars per million tokens. |
| `SIMPROOF_CODEX_WORKSPACE_ROOT`, `SIMPROOF_CODEX_STATE_ROOT` | Absolute, application-owned, isolated roots. In Compose, use `/tmp/simproof-codex/workspaces` and `/tmp/simproof-codex/state` inside the bounded private tmpfs. They must not overlap each other, SQLite/artifacts/diagnostics, the repository, or a secret-bearing directory. Codex receives only its disposable artifact workspace as writable. |
| Required runner binding above | `SIMPROOF_RUNNER_ENDPOINT`, token, immutable image, and semantic version remain the prerequisite for provider mode. |

The deployment reserves provider budgets before every external action. Its fixed upper
reservations are 12,000 input and 3,000 output tokens for concept compilation, then
32,000 input and 8,000 output tokens for each generation or repair attempt. The
concept plus the maximum three generation/repair attempts fit the educator workflow's
120,000 input and 30,000 output token limits. Configured prices must keep every fixed
reservation within the 5,000,000 micro-US-dollar aggregate cost budget; changing a
price or model requires revalidation.

## Compose and launcher settings

| Name | Default or requirement | Owner |
|---|---|---|
| `SIMPROOF_HTTP_PORT` | `8080`; published only on `127.0.0.1` | Compose `web` port mapping |
| `SIMPROOF_DOCKER_GID` | Required numeric group ID that owns the Docker socket as mounted inside a container | Compose grants only `runner-launcher` this supplemental group. Preparation probes the mounted view because Docker Desktop can remap ownership from the host view. Socket access is full daemon authority—the `:ro` bind flag does not limit Docker API operations—so confinement depends on the fixed launcher control plane and sole socket ownership. |
| `SIMPROOF_LAUNCHER_HOST` | `0.0.0.0` inside its private network | launcher |
| `SIMPROOF_LAUNCHER_PORT` | `4318` | launcher |
| `SIMPROOF_LAUNCHER_MAX_REQUEST_BYTES` | Compose uses `1048576`; accepted range 16384–1048576 | launcher only; protocol/source/output maxima still apply independently |
| `SIMPROOF_LAUNCHER_MAX_CONCURRENT` | `2`; accepted range 1–32 | launcher only; excess work receives bounded `runner.limit.processes` failure |

The launcher exposes content-free `GET /healthz` and `GET /readyz` probes. The
deployment check uses authenticated, content-free `GET /v1/capabilities` and requires
the configured immutable runner image plus protocol `1` to match exactly. Only
authenticated `POST /v1/execute` can request work. That request contains the exact
allowlisted image and a strict runner-protocol request; it cannot supply Docker flags,
mounts, networks, environment, or arbitrary commands. The orchestrator receives no
Docker authority. The supported launcher transport is HTTP only at the exact private
`http://runner-launcher:4318` endpoint; Unix sockets and operator-selected hosts, ports,
paths, credentials, queries, or fragments are not supported.

## Validation and first-run checks

Before starting containers, validate interpolation without printing the rendered
secret-bearing configuration into a ticket or shared log:

```sh
node scripts/prepare-deployment.mjs --check
docker compose \
  --env-file .env \
  --env-file .simproof/deployment.generated.env \
  config --quiet
docker compose \
  --env-file .env \
  --env-file .simproof/deployment.generated.env \
  build
```

Startup validates required fields, path separation, database and artifact access,
migration checksums, administrator bootstrap availability, the launcher token/image
contract, and local runner readiness. Liveness never checks dependencies. Readiness
never contacts a model provider or executes generated code.

After startup, use the browser-visible readiness endpoint and verify all containers are
healthy. A missing provider credential is not a readiness failure: sign in and inspect
the bundled projectile and pendulum examples before configuring provider access.

## Safe configuration changes

Treat changes to origins, trusted proxy, secrets, runner endpoint/image, persistence
paths, image architecture, or limits as reviewed deployment changes. Back up and
validate both SQLite and referenced artifacts before changing an image or any storage
layout. Rotating the session secret invalidates active sessions. A restore also removes
all active sessions by design.

Stop instead of weakening a check if configuration would require a mutable runner
image, an unauthenticated launcher, an application Docker socket, overlapping storage,
an HTTP origin in network mode, blanket proxy trust, provider credentials in client
assets, or external diagnostics enabled without an explicit privacy decision.

See [Deployment](deployment.md), [Upgrades and rollback](upgrades.md),
[Backup and restore](backup-restore.md), [Authentication](../security/authentication.md),
and [Observability](observability.md).
