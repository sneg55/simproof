# Supported Docker Compose deployment

## Supported profile

SimProof supports one self-hosted, single-tenant Docker Compose topology. It is for one
teacher/administrator and is not a Kubernetes, multi-node, multi-user, or hosted-SaaS
profile. Generated code is hostile input and runs only in a disposable isolated runner
container. A deployment that changes the authority or isolation boundaries below is
outside the supported profile even if the application appears to work.

The default browser endpoint is authenticated and published only on host loopback.
Network exposure is a separate operator decision and requires an exact HTTPS origin
and a TLS-terminating reverse proxy. There is no supported unauthenticated network
profile.

## Topology and trust boundaries

```text
teacher browser
    |
    | 127.0.0.1:8080 by default, or operator TLS proxy -> loopback
    v
web (only published service; static UI and narrow reverse proxy)
    | edge network exists only for portable loopback publication
    |
    | application network, private HTTP
    v
orchestrator (auth, providers, lifecycle, SQLite/CAS, trusted verifier)
    |
    | runner-control network, authenticated strict protocol
    v
runner-launcher (only Docker-daemon client)
    |
    | fixed image digest and isolation profile; Docker socket never forwarded
    v
disposable runner (network=none, no secrets/mounts/socket, generated core only)
```

Only the orchestrator joins `provider-egress`, the network used for configured
model-provider calls. `web` also joins a dedicated non-internal `edge` network because
some Docker backends do not publish host ports for containers attached only to
internal networks. No other service joins `edge`; `web` receives no provider or
server credentials and has no persistent volume, while necessarily handling opaque
browser cookies and teacher request bodies. Its sole supported application upstream
is fixed to the orchestrator.
The edge network gives `web` generic network egress, so provider exclusivity is an
application configuration and credential boundary, not a network-reachability claim:
only the orchestrator is provider-configured and receives provider credentials.
`runner-launcher` and every disposable runner receive no provider credentials; the
disposable runner has no network at all. The launcher is trusted infrastructure, not
an application or generated-code container. Its sole Docker authority is bounded to
the allowlisted runner image and fixed launch policy.

| Service | Listener and publication | Networks | Storage/authority | Health |
|---|---|---|---|---|
| `web` | container `8080`; host `127.0.0.1:${SIMPROOF_HTTP_PORT:-8080}` only | `edge`, `application` | read-only application assets; no injected server/provider credentials, persistent volume, provider configuration, or Docker socket; handles browser traffic and has a fixed orchestrator proxy target | container-local HTTP probe |
| `orchestrator` | container `3000`; never host-published | `application`, `runner-control`, `provider-egress` | `simproof-data` at `/var/lib/simproof`; `simproof-logs` at `/var/log/simproof`; server secrets; no Docker socket | application and Compose probes use `GET /health` and `GET /ready`; only the web edge exposes `/readyz` |
| `runner-launcher` | container `4318`; never host-published | `runner-control` | `/var/run/docker.sock` gives full daemon authority; confinement comes from the fixed control-plane allowlist, not the `:ro` bind flag. It has no application data or provider secrets | content-free `GET /healthz`, `GET /readyz`; authenticated content-free `GET /v1/capabilities` binds deployment readiness to protocol `1` and the exact runner image |
| `runner` image-only build target / disposable runner | no listener or published port; Compose profile does not start it | network disabled | private bounded temporary workspace only; no host, repository, data, secret, device, or Docker-socket mount | one bounded protocol execution |

The `application` and `runner-control` networks are internal. The two named volumes are
the only durable application locations. Copying `simproof-data` directly is not a
valid backup: SQLite metadata and referenced content-addressed artifacts must be
snapshotted and verified together. Diagnostic logs are not part of the protected data
backup.

`SIMPROOF_DEPLOYMENT_MODE=loopback` describes the browser-facing trust policy. Compose
overrides the orchestrator's container listener to `0.0.0.0:3000` only so `web` can
reach it on the internal `application` network; that port is never host-published. The
only host listener remains the `web` mapping on `127.0.0.1`.

## Compatibility matrix

| Layer | Supported contract |
|---|---|
| Host | Linux with Docker Engine, the Compose v2 plugin, and the daemon socket at `/var/run/docker.sock`. Rootless engines, Docker Desktop, remote daemons, and alternate socket locations are not the supported release profile unless future deployment evidence explicitly adds them. |
| Image architectures | `linux/amd64` and `linux/arm64`; application-image persistence and runner isolation smoke evidence must pass on the selected architecture. |
| Application runtime | Node `>=24.15 <25` in the pinned orchestrator image that owns persistence. This is the runtime that must pass `node:sqlite` creation, foreign-key, extension-denial, defensive-mode, backup, and restore checks. |
| Runner runtime | Independently pinned by the immutable runner image digest. Do not infer application SQLite support from it or substitute the application image for it. |
| Browser | Current Chromium-family desktop browsers are release-gated through Playwright. JavaScript, cookies, secure origin rules, and standards-based SVG are required. Browsers not represented in release evidence are best-effort until added to the gate. |

Cross-platform emulation may provide development smoke evidence, but it does not
qualify that architecture for release. Release evidence for the selected deployment
architecture must run natively on that architecture. Record the execution mode with
the evidence. Pin release images by immutable digest; a mutable tag is not an
acceptable runner allowlist.

## Prepare the deployment

1. Install Docker Engine and the Compose v2 plugin. Confirm the daemon can enforce
   read-only roots, capability drops, `no-new-privileges`, PID/memory/CPU limits, and
   `network=none` for disposable containers.
2. Clone the exact release and verify its source/release provenance.
3. Copy `.env.example` to a private `.env`. Follow
   [Deployment configuration](configuration.md); generate the administrator bootstrap
   secret, session secret, and runner token independently.
4. Prepare the host-specific deployment authority:

   ```sh
   node scripts/prepare-deployment.mjs
   node scripts/prepare-deployment.mjs --check
   ```

   This builds/inspects the local runner and writes its immutable image ID plus the
   Docker socket group to `.simproof/deployment.generated.env` with mode `0600`. It
   does not print or copy application secrets. The orchestrator and launcher receive
   the same image identity; the launcher refuses any other image. Never hand-edit or
   commit the generated file, change socket ownership, or make the socket world-writable.
5. Validate Compose interpolation and policy before startup:

   ```sh
   docker compose \
     --env-file .env \
     --env-file .simproof/deployment.generated.env \
     config --quiet
   docker compose \
     --env-file .env \
     --env-file .simproof/deployment.generated.env \
     build
   pnpm test:deployment
   ```

   The deployment gate is a runtime acceptance gate, not only a static policy check. It
   starts exact local images on clean disposable volumes, proves the provider-absent
   seed library and generation-unavailable behavior, then uses a test-only bind-mounted
   deterministic provider driver with the real launcher, disposable runner, trusted
   verifier, persistence, web edge, restart, report, publication, export, and shutdown
   paths. The driver is not copied into an image and there is no production fake-provider
   switch. The gate fails if provider networking occurs or runtime residue remains.

Do not continue if the runner image remains a mutable tag, any application service has
the Docker socket, a runtime user is root, the launcher port is published, or the
rendered runner policy contains a network or host/data mount.

## First run and administrator bootstrap

Start the supported stack and inspect health without printing its environment:

```sh
docker compose --env-file .env --env-file .simproof/deployment.generated.env \
  run --rm --no-deps orchestrator migrate --confirm-stopped
docker compose --env-file .env --env-file .simproof/deployment.generated.env \
  up -d runner-launcher
docker compose --env-file .env --env-file .simproof/deployment.generated.env \
  run --rm --no-deps orchestrator check
docker compose --env-file .env --env-file .simproof/deployment.generated.env up -d
docker compose --env-file .env --env-file .simproof/deployment.generated.env ps
curl --fail http://127.0.0.1:8080/readyz
```

Replace `8080` in the final probe when `SIMPROOF_HTTP_PORT` is changed; do not source
the secret-bearing `.env` merely to construct this URL.

The explicit first `migrate` creates a fresh schema. On a non-empty database, it
refuses to migrate unless `--backup NAME` is supplied; follow the upgrade runbook.
`check` runs only after the launcher is healthy because supported readiness always
authenticates to `GET /v1/capabilities` and requires the configured daemon/image and
protocol binding to match exactly, including seed-only mode.
Its JSON report contains only fixed ready/not-ready classifications, administrator
presence, and provider-presence booleans. It does not print configuration values,
credentials, paths, provider responses, or generated content. An unconfigured
administrator is expected before browser bootstrap and does not authorize any request.

For the default local profile, open the exact loopback origin configured in
`SIMPROOF_ALLOWED_ORIGINS`, normally `http://127.0.0.1:8080`. The browser presents the
one-time administrator setup. Supply the configured bootstrap secret and choose the
administrator password; then sign in with that password. The bootstrap completion is
one-way and cannot create a second account.

Provider credentials are optional. Without `OPENAI_API_KEY` or `CODEX_API_KEY`, the
deployment must still become ready and the authenticated library must show the bundled
verified projectile and pendulum examples. This is the clean-install acceptance test:

1. liveness and readiness are healthy;
2. administrator bootstrap and sign-in succeed;
3. both bundled examples load, including report and accessible data representation;
4. generation is clearly unavailable rather than silently using a fake or local
   provider; and
5. no provider request or generated-code execution occurs.

Enabling providers later requires the complete atomic generation set in
[Deployment configuration](configuration.md): both credentials, explicit model and
price policy, isolated Codex roots, and authenticated runner identity. A partial set
fails closed. Recreate only the orchestrator after validation. Test provider
reachability from the configured application workflow, never by copying a credential
into another container. A provider failure is an operational result and must not make
the seed library unavailable.

## Network exposure with TLS

Keep the Compose publication on `127.0.0.1`; do not change it to `0.0.0.0`. Place an
operator-managed reverse proxy on the same host in front of that loopback endpoint,
then configure all of the following together:

- `SIMPROOF_DEPLOYMENT_MODE=network`;
- `SIMPROOF_ALLOWED_ORIGINS` equal to the exact public `https://` origin;
- a valid certificate and HTTPS-only redirect/HSTS policy at the proxy;
- forwarding only to the host-loopback `web` port; and
- `SIMPROOF_TRUSTED_PROXY_ADDRESS` unset: the supported `web` edge discards caller
  forwarding metadata, and the host proxy must replace rather than append it before
  that point.

The SimProof administrator session remains mandatory behind the proxy. The proxy must
strip caller-supplied forwarding headers and set its own; it must not publish the
orchestrator or launcher, bypass origin/CSRF checks, terminate on plain HTTP, or expose
an alternate unauthenticated route. Validate login, logout, exact-origin rejection,
secure cookies, readiness, and a bundled example through the public HTTPS origin before
allowing other clients.

## Health, readiness, and diagnostics

The web edge serves `/healthz` and proxies `/readyz` for Compose/host probes. The
orchestrator application contract remains `/health` and `/ready`. Liveness is
dependency-free. Readiness checks configuration, exact migration state, database
access, artifact-root safety/access, and the configured launcher image/daemon binding.
The supported Compose profile configures that binding even in seed-only mode, so an
unavailable launcher makes it not-ready. Provider absence does not: neither check
contacts a provider or runs generated code. Treat a not-ready result as a stop signal;
do not route writes or try direct Node execution.

To create a local, redacted support bundle in the diagnostics volume, use a new bounded
name as documented in [Observability](observability.md):

```sh
docker compose --env-file .env --env-file .simproof/deployment.generated.env \
  run --rm --no-deps orchestrator \
  diagnostics --name simproof-diagnostics-local.json
docker compose --env-file .env --env-file .simproof/deployment.generated.env cp \
  orchestrator:/var/log/simproof/simproof-diagnostics-local.json \
  ./simproof-diagnostics-local.json
```

The bundle is not a backup. Review it before sharing; never attach `.env`, a database,
artifact files, container output, provider responses, or stack traces.

## Shutdown and STOP conditions

For a normal shutdown, preserve both named volumes:

```sh
docker compose --env-file .env --env-file .simproof/deployment.generated.env down
```

Do not add `--volumes` unless the explicit goal is irreversible destruction of the
deployment after a validated backup. Shutdown must cancel or drain launcher work and
leave no generated process or private workspace.

Stop the deployment and preserve its data for diagnosis when any of these is true:

- a container requires root/privileged mode, added capabilities, host namespaces,
  devices, repository/data/secret mounts, or a writable runner root;
- `web`, `orchestrator`, or a generated runner can access the Docker socket;
- the launcher is unauthenticated, accepts arbitrary Docker options, or cannot enforce
  the immutable runner image and resource/concurrency bounds;
- the runner has network access, inherited secrets, shared workspaces, or a fallback to
  host/orchestrator Node execution;
- a migration checksum, database integrity check, artifact hash/reference, backup, or
  restore validation fails;
- credentials appear in an image layer, browser asset, diagnostic bundle, artifact, or
  log; or
- network exposure cannot preserve exact HTTPS origins, administrator authentication,
  secure sessions, and narrow immediate-proxy trust.

Continue with [Upgrades and rollback](upgrades.md) before changing images or schemas,
and use the full [Backup and restore](backup-restore.md) integrity contract for every
recovery operation.
