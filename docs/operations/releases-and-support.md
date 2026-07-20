# Release, compatibility, and support policy

## Release authority

Repository automation may assemble and verify local release artifacts, but it must not
publish a repository, package, image, advisory, or release without explicit operator
authorization. A source revision is not a release merely because `pnpm check` passes or
an image builds.

The operator must enable the private vulnerability-reporting path required by
[SECURITY.md](../../SECURITY.md) before making the repository public. Publication is
blocked if the path is absent, the supported-version table is inaccurate, or release
materials would expose credentials, prompts, generated content, provider responses,
raw diagnostics, or signing secrets.

## Versioned contracts

SimProof uses semantic versioning where a public compatibility contract exists, but
each contract has its own identity. Changing one version does not silently change the
others.

| Contract | Versioning rule |
|---|---|
| Application release | SemVer for teacher/operator behavior and the supported Compose product. Breaking API, configuration, deployment, or supported-data changes require a major review. |
| Domain-pack SDK | Independent SemVer. A pack declares a compatible SDK range and registration fails closed outside it. |
| Domain pack | Independent SemVer plus a deterministic content fingerprint. Renderer/data, evidence, inventory, or declared capability changes receive pack compatibility review. |
| Verification policy | Independent SemVer bound into every report. Any equation, constant, applicability bound, sample, tolerance, numerical method, check order, or finding-meaning change requires policy/pack version review and stale-report analysis. |
| Runtime/process schema | Explicit schema or protocol version at each boundary. Unknown fields and unsupported versions fail closed; application SemVer does not replace protocol negotiation. |
| Database schema | Ordered immutable migrations with checksums. Every release states its source/target schema support and proves fresh install plus supported upgrades. |
| Artifact and backup formats | Explicit format versions. Hashing or normalization changes are migrations and never reinterpret bytes under an existing hash. |
| Runner binding | Protocol version, semantic runner version, and immutable image digest are one verified binding. A mutable tag is not a release identity. |
| Deployment format | Compose topology, configuration schema, image identities, persistence layout, and supported host/architecture matrix are reviewed together. |

SemVer does not decide scientific evidence validity. A report is current only when its
exact artifact, policy, pack fingerprint, runner binding, and other authoritative
dependencies still match. Preserve old records for provenance even when they become
stale or unsupported.

## Supported compatibility profile

The supported production profile is one teacher administrator on a single-tenant Linux
host using Docker Engine, Compose v2, the daemon socket at `/var/run/docker.sock`, and
the documented web/orchestrator/launcher/disposable-runner topology. Supported image
architectures are `linux/amd64` and `linux/arm64` only when native release evidence is
present for the selected architecture. The application runtime is Node `>=24.15 <25`;
the runner runtime is pinned independently by its image digest.

Docker Desktop, rootless or remote daemons, alternate sockets, Kubernetes, hosted SaaS,
multi-node or multi-user operation, and modified runner authority/isolation are outside
the release profile. Current Chromium-family desktop browsers are release-gated;
unrepresented browsers are best-effort. See the complete [deployment compatibility
matrix](deployment.md#compatibility-matrix).

Only versions explicitly listed as supported in [SECURITY.md](../../SECURITY.md) and
the corresponding release notes receive security support. Forks and locally modified
profiles retain their open-source license rights but are not represented as supported
SimProof deployments.

## Release inputs and gates

A release candidate must be built from a clean, identified source revision with the
committed lockfile and no undeclared generated files. Record the source revision,
application and component versions, domain-pack fingerprints, policy bindings,
migration source hash and ordered version/name inventory, artifact/backup formats,
runner protocol/image identity, and supported architecture.

Run from a clean checkout using the exact pinned toolchain:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm audit:dependencies
pnpm check
pnpm test:e2e
pnpm test:a11y
pnpm test:deployment
```

The dependency audit must complete successfully; an unavailable advisory service is a
failed release prerequisite, not evidence of zero advisories.

Build all four Compose images, including the profile-gated runner, then generate and
verify unsigned local evidence at a nonexistent child of a new private work directory:

```sh
env \
  SIMPROOF_DOCKER_GID=0 \
  SIMPROOF_ADMIN_BOOTSTRAP_SECRET=release-build-placeholder \
  SIMPROOF_RUNNER_TOKEN=release-build-placeholder \
  SIMPROOF_RUNNER_IMAGE=sha256:0000000000000000000000000000000000000000000000000000000000000000 \
  SIMPROOF_DOCKER_SOCKET=/var/run/docker.sock \
  SIMPROOF_SESSION_SECRET=release-build-placeholder \
  docker compose --profile image-only build

release_work="$(mktemp -d)"
release_output="$release_work/evidence"
release_revision="$(git rev-parse HEAD)"
release_epoch="$(git show -s --format=%ct HEAD)"
web_image="$(docker image inspect --format '{{.Id}}' simproof-web:local)"
orchestrator_image="$(docker image inspect --format '{{.Id}}' simproof-orchestrator:local)"
launcher_image="$(docker image inspect --format '{{.Id}}' simproof-launcher:local)"
runner_image="$(docker image inspect --format '{{.Id}}' simproof-runner:local)"

pnpm release:dry-run \
  --output "$release_output" \
  --release-version 0.1.0-rc.1 \
  --source-revision "$release_revision" \
  --source-date-epoch "$release_epoch" \
  --image "simproof-web:local=$web_image" \
  --image "simproof-orchestrator:local=$orchestrator_image" \
  --image "simproof-launcher:local=$launcher_image" \
  --image "simproof-runner:local=$runner_image"

pnpm release:dry-run --verify "$release_output"
```

The six values passed through `env` are non-secret build-only interpolation
placeholders. Compose parses runtime configuration even for `build`; these values let
it render that configuration without reading deployment secrets. Never start services
with these placeholders, copy them into `.env`, or reuse them in a deployment.

The generator requires those exact four references and full `sha256:` image IDs. It
rejects a missing, duplicate, substituted, or malformed image identity. The source
revision must be the clean release-candidate revision; the epoch is derived from that
same commit so repeated generation uses the same release input.

`pnpm check` covers the scientific negative controls, domain-pack conformance and exact
review bindings, migration fixtures, integration/security/diagnostic suites, Python
proof, production builds, and a runtime Compose acceptance test. The separate
`test:e2e` and `test:a11y` Playwright commands complete the browser release gate. Native
image evidence is required for each advertised architecture; emulation is development
evidence only.

Also verify:

- the dependency audit has no unresolved reachable high/critical advisory;
- every dependency, image base, asset, and bundled example has reviewed license and
  attribution metadata;
- `CHANGELOG.md` and release notes identify behavior, security, migration,
  compatibility, and rollback impact;
- the generated-code threat model and adversarial runner matrix still cover every
  changed authority, protocol, import, limit, and cleanup path;
- the seed library works without provider credentials and generation is explicitly
  unavailable rather than using a fallback provider;
- backup validation, restore rehearsal, upgrade fixtures, and rollback selection use
  complete SQLite plus artifact state; and
- private vulnerability reporting is enabled without exposing a public exploit form.

## Release artifacts

The local dry-run release assembly produces one bounded manifest and checksum set that
binds the source revision, lockfile hash, migration metadata, changelog copy, aggregate
SPDX 2.3 workspace/dependency SBOM, provenance, and exact identities of the web,
orchestrator, launcher, and runner images. The SBOM records those four Compose image
identities as packages, and the provenance names the same four image IDs as subjects.
The dry run does not claim image-filesystem SBOM coverage.

An authorized publication must additionally include the source archive, `LICENSE`,
`LICENSE-CONTENT`, `NOTICE`, and any image-specific SBOMs required by the release notes
or registry policy. Those publication artifacts are prerequisites, not claims about the
current dry-run workflow.

Review generated metadata against its source inputs. An SBOM, checksum, attestation,
domain-pack fingerprint, or review binding proves an identity relationship; it does
not prove scientific correctness, vulnerability absence, license compatibility, or
human approval.

Keep publication as a separately authorized action. Dry-run or pull-request automation
does not need to upload artifacts and must have no package, registry, image, or release
publication credential. If a separate retention step is authorized, it may retain only
the bounded non-secret dry-run outputs.

## Licensing review

Release distributions keep these categories distinct:

- source code and repository documentation: [Apache-2.0](../../LICENSE);
- declared SimProof bundled educational examples: [CC BY
  4.0](../../LICENSE-CONTENT) with [NOTICE](../../NOTICE); and
- teacher-directed generated artifacts: deployer/user ownership posture with the
  export-license metadata and provenance recorded for that artifact.

Generated-artifact metadata is not proof of ownership, copyrightability, provider-term
compatibility, or authority to license. Do not apply Apache-2.0 or CC BY 4.0 to a user
artifact merely because SimProof stored, verified, published, or exported it. Before
adding third-party educational content or changing a license, revisit [ADR
0005](../decisions/0005-licensing.md).

## Release notes and changelog

Move entries from `Unreleased` into a versioned changelog section only for an
authorized release. Release notes must state:

- exact supported deployment and architecture;
- source, image, SBOM, checksum, and provenance identities;
- application, SDK, domain-pack, policy, runner/protocol, schema, migration, artifact,
  and backup-format changes;
- report-staleness and retained-version behavior;
- operator actions for configuration, backup, upgrade, validation, and rollback;
- security fixes and affected supported versions without premature exploit detail;
- accessibility or privacy-impacting behavior; and
- known limitations and explicit unsupported profiles.

Never describe a policy as simply “more correct.” Name the changed scientific claim,
bounds, samples, tolerance, evidence, and stale-report consequence.

## Upgrade, rollback, and support handoff

Operators must follow [upgrades.md](upgrades.md), not replace images against live data
and hope schemas match. A release that changes a migration or artifact format rolls
back by restoring a complete validated pre-upgrade archive with the old compatible
release; destructive down migrations and partial artifact/database restores are not
supported.

Support requests should contain release/image identifiers, architecture, readiness
classification, stable error IDs, and a reviewed redacted diagnostic bundle when
needed. They must not include `.env`, credentials, cookies, prompts, provider responses,
generated content, databases, backups, raw container logs, or stack traces. See
[observability.md](observability.md).
