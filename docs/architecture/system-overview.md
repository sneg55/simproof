# SimProof system overview

## Document status

This document describes the approved target architecture. At the time it was written,
the application services and packages described below had not yet been implemented.
It is an implementation map, not a production-readiness claim. The product contract
is [`PRODUCT_SPEC.md`](../../PRODUCT_SPEC.md), and detailed rationale is recorded in
the [architecture decision records](../decisions/).

## Planned topology

```text
teacher browser
      |
      | authenticated HTTP; no provider credentials
      v
+---------------- web / orchestrator application ----------------+
| teacher UI     API and secure session     lifecycle coordinator |
| provider clients     persistence     trusted verifier policies  |
+-----------+-----------------+-----------------------+------------+
            |                 |                       |
            | HTTPS           | narrow versioned      | transactional
            |                 | runner protocol       | metadata/artifacts
            v                 v                       v
   OpenAI / Codex     +------------------+     +------------------+
   model services     | isolated runner  |     | persistent data  |
                      | generated core   |     | SQLite metadata  |
                      | no network       |     | hashed files     |
                      | no secrets       |     +------------------+
                      +------------------+
```

Docker Compose is the single supported deployment. Production images separate the
web/orchestrator runtime from the runner image. The persistent data directory contains
SQLite metadata and content-addressed artifact files. The runner receives neither
that full directory nor the application repository, host paths, credentials, or the
Docker socket.

## Component responsibilities

### `apps/web`

The React teacher experience authenticates the one local administrator and presents
the seed library, generation workflow, lifecycle, verification reports, history,
export, archive, and deletion. Thin SVG renderers consume normalized simulation state;
they do not reimplement domain equations. Each renderer has an equivalent textual/data
representation and composes the committed shadcn/ui primitive system. Any
model-emitted renderer material crosses into the browser only as validated,
non-executable data; executable generated code remains confined to the runner.

The browser is not trusted with provider credentials, session material beyond the
secure session mechanism, verifier policy, or executable generated code.

### `apps/orchestrator`

The server owns the generation state machine, model-provider calls, cancellation,
attempt limits, provenance, persistence, runner invocation, verification, and badge
validity. It validates every process boundary with shared schemas. It can request a
constrained concept specification from GPT and a pure core or repair from Codex, but
it contains no domain equations and cannot delegate truth to either model.

One generation run retains its model/template/thread identifiers and immutable attempt
history without retaining credentials. It stops on success, cancellation, terminal
failure or budget exhaustion, or after no more than three total attempts.

### `apps/runner`

The runner is the only process allowed to execute generated code. It loads a pure,
deterministic `SimulationCore` through the allowlisted `packages/sim-runtime`
interface, applies deterministic inputs and limits, and returns schema-validated,
normalized samples and diagnostics.

The runner is an unprivileged, disposable container boundary with a read-only root
filesystem, isolated temporary workspace, no network, no secrets, no host or Docker
socket mounts, dropped capabilities, resource limits, and output caps. Node
permissions and import restrictions add defense in depth; they are not treated as the
primary sandbox. Workspaces are destroyed after success, failure, or cancellation.

### `packages/contracts`

Shared, versioned runtime schemas define concept specifications, generated artifact
manifests, runner requests and responses, verification reports, and API boundaries.
Static types are inferred from those schemas. Malformed, oversized, unknown, or stale
data is rejected before crossing into the next trust domain.

### `packages/verifier`

The trusted verifier owns each supported domain's equations, units, assumptions,
valid parameter range, tolerance policy, invariants, stable finding identifiers,
references, and positive and negative controls. It compares normalized runner output
to application-owned truth and emits an immutable report bound to the artifact hash,
policy ID/version, domain-pack version, runner version, tested ranges, tolerances,
findings, and limitations.

Generated code and model output cannot import, replace, or modify this package.
Repairs create a new generated artifact and verification run under the same trusted
policy unless an operator-installed application release explicitly changes policy.

### `packages/sim-runtime`

The simulation runtime is a DOM-free contract and loader boundary for generated pure
cores. It defines the narrow operations a core may expose and the normalized data a
runner may return. It contains no renderer and confers no authority over correctness.

### Persistence

SQLite stores transactional metadata: simulations and versions, generation runs and
attempts, artifact references, verification policy references, immutable reports and
findings, publish state, domain-pack references, and license/provenance metadata.
Content-addressed files store generated artifact payloads. Hash verification connects
the two stores and detects missing, substituted, or corrupt content.

Exports, backups, restores, migration, and deletion preserve or deliberately remove
both sides of that relationship. Credentials never enter either store as artifact or
provenance data. See [ADR 0003](../decisions/0003-storage-and-artifacts.md).

## Trust and process boundaries

| Boundary | Untrusted or sensitive input | Required control | Output allowed across |
|---|---|---|---|
| Browser to application | Prompts, parameters, state-changing requests | Authentication, secure server-side session, origin/CSRF checks, size limits, schema validation | Validated teacher intent and safe response data |
| Application to providers | Teacher prompt and constrained generation context; server credentials | Server-only provider clients, explicit data disclosure, redacted diagnostics | Schema-constrained concept or generation result |
| Provider output to orchestrator | Model-generated structured data and source | Strict schemas, path/import allowlists, attempt and output limits; never execute in-process | Validated artifact candidate |
| Orchestrator to runner | Generated code is hostile | Narrow versioned protocol plus OS/container isolation; no network, secrets, repository, host mounts, or shared workspace | Normalized samples, diagnostics, observed hash, exit class |
| Runner output to verifier | Malformed or adversarial values | Response schema, size/finite-value/hash checks | Validated deterministic observations |
| Observations to verifier policy | Candidate may encode the same model error as its spec | Application-owned immutable equations, ranges, invariants, and tolerances | Version-bound report and stable findings |
| Application to browser | Reports, SVG/data state, diagnostics | No generated executable code or secrets; output encoding and accessible application renderers | Teacher-readable state, provenance, and controls |
| Application to persistent data | Concurrent lifecycle changes and artifact bytes | Transactions, migrations, hashes, immutable evidence, redaction | Durable metadata and content-addressed files |

The verifier is trusted for scoped scientific policy; the generated core, model
outputs, prompts, and runner observations are not. The orchestrator is trusted to
apply policy and manage secrets but is deliberately unable to execute generated code.
The browser and runner are separate from the secret-bearing server process.

## Generate, verify, and repair data flow

1. The authenticated teacher submits a prompt and confirms the supported domain and
   bounded parameter inputs.
2. The orchestrator records a generation run and sends the minimum required context
   to configured server-side provider clients.
3. GPT returns a schema-constrained concept specification. It selects only an
   installed supported domain and parameters; it does not supply executable truth.
4. Codex creates a pure core and constrained adapter in a disposable artifact
   workspace. The orchestrator validates the candidate and stores it by content hash.
5. The orchestrator sends the candidate hash/content, deterministic inputs, policy
   reference, and resource limits through the versioned runner protocol.
6. The isolated runner executes the core and returns normalized observations,
   diagnostics, exit classification, and the observed artifact hash.
7. The trusted verifier checks those observations against the installed domain policy
   and writes an immutable, version-bound report.
8. A passing report moves the version to `verified`; teacher approval can then publish
   it. The web app renders normalized state with a thin SVG renderer and equivalent
   data output.
9. A rejection returns stable findings to the teacher and, when another attempt is
   permitted, to Codex. Only generated artifact files may change. Steps 4–7 repeat,
   with the run terminating after at most three total attempts.
10. Provider failure, runner failure, invalid output, cancellation, and budget
    exhaustion remain operational outcomes and are not converted into a verifier
    rejection.

## Lifecycle and evidence validity

Durable simulation-version states are `draft`, `generating`, `verifying`, `rejected`,
`verified`, `stale`, `published`, and `archived`. The user interface may show finer
operational states such as queued, compiling, executing, repairing, or provider and
runner failure, but it must map them to explicit persisted transitions.

Verification records are append-only evidence, not mutable status blobs. Publishing
requires a current passing report. Any change to artifact content, applicable policy,
domain pack, runner semantics, or other verification-relevant dependency invalidates
the evidence and marks the version stale. Re-verification creates a new record; it
does not edit history.

## Deployment and operations

The Compose deployment provides:

- an authenticated web/orchestrator application image with outbound access only where
  model-provider calls require it;
- a distinct minimal runner image invoked with its network disabled and strict
  isolation controls;
- persistent volumes for SQLite and content-addressed artifacts;
- configuration validation, migrations, health and readiness checks, seed example
  installation, backup/restore, upgrade, rollback limits, and redacted diagnostic
  export.

All runtime containers operate as unprivileged users. The supported local profile must
bind safely, and network exposure requires an authenticated, TLS-terminating reverse
proxy configuration. Provider credentials are optional for readiness of the seed
experience but required before generation can start. External telemetry or
observability export is disabled unless the deployer opts in.

## Supported domains and rendering

Projectile motion and simple pendulum are the initial supported domain packs. Their
governing equations and tolerance policy live only in `packages/verifier` domain
modules, together with scientific references and regression controls. Generated cores
implement the simulation contract; thin renderers consume their verified normalized
state without becoming another implementation of the physics.

Circuits and graphing are explicitly unsupported until each has a complete domain
pack that passes deterministic reference, invariant, range, units, policy immutability,
positive/negative control, stale-report, and accessible-output conformance. Domain
packs are installed application code reviewed and shipped with a release, not
runtime-downloadable plugins.

SVG is the default visual representation. Every supported domain also supplies a
textual/data representation with equivalent meaningful parameters, state, units, and
results; rendering never becomes an alternate implementation of the physics.

## Decision ownership

- Verification trust and claim language: [ADR 0001](../decisions/0001-trusted-verification.md)
- Compose topology and process isolation: [ADR 0002](../decisions/0002-supported-deployment.md)
- Metadata and artifact persistence: [ADR 0003](../decisions/0003-storage-and-artifacts.md)
- Identity, credentials, diagnostics, and data disclosure: [ADR 0004](../decisions/0004-privacy-posture.md)
- Source, bundled-content, and generated-artifact licensing: [ADR 0005](../decisions/0005-licensing.md)

Changing one of those boundaries requires an explicit ADR update rather than an
incidental implementation choice.
