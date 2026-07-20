# SimProof product specification

## Status and authority

This document is the production product contract for SimProof. Where a production
choice is open, this document and the accepted architecture decision records (ADRs)
govern.

SimProof is planned software and is not yet production-ready. The promise is:

> A teacher describes a supported STEM concept; SimProof generates an interactive
> simulation, checks its pure physics core against trusted application-owned policy,
> and makes it publishable only when the bounded verification passes.

The governing decisions are:

- [ADR 0001: Trusted verification](docs/decisions/0001-trusted-verification.md)
- [ADR 0002: Supported deployment](docs/decisions/0002-supported-deployment.md)
- [ADR 0003: Storage and artifacts](docs/decisions/0003-storage-and-artifacts.md)
- [ADR 0004: Privacy posture](docs/decisions/0004-privacy-posture.md)
- [ADR 0005: Licensing](docs/decisions/0005-licensing.md)

## Target user

The initial product serves one teacher operating one self-hosted SimProof instance.
That teacher is the instance's sole local administrator and uses AI to draft lesson
materials while retaining responsibility for review, selection, and classroom use.

There are no student accounts, student records, additional user roles, or shared
tenancy in the initial product. SimProof does not replace the teacher's subject-matter,
pedagogical, accessibility, safety, or curriculum review.

## Supported Deployment

The supported production deployment is a single-tenant, self-hosted Docker Compose
topology. It contains the authenticated web/orchestrator application, persistent
SQLite metadata and content-addressed artifact storage, and a separately isolated
runner for generated code. Generated code executes only in that runner container;
Node permissions are an additional restriction, not the security boundary. See
[ADR 0002](docs/decisions/0002-supported-deployment.md) and the
[system overview](docs/architecture/system-overview.md).

One local administrator account uses secure server-side sessions. OIDC, school SSO,
multiple users, multi-tenant hosting, Kubernetes, and cloud-specific deployment
templates are not supported initially.

## User journeys

### Use bundled examples without model credentials

The teacher signs in, browses verified projectile and pendulum examples, changes
parameters within their stated ranges, uses the visual or equivalent data
representation, and inspects the report that names the verification policy, version,
tested range, tolerances, assumptions, and limitations. This path must work without
OpenAI or Codex credentials.

### Generate, verify, and publish a simulation

The teacher supplies a prompt, confirms the recognized supported domain and bounded
parameters, and starts generation. The orchestrator obtains a constrained concept
specification and a pure simulation core, runs the generated code in the isolated
runner, and submits normalized output to the trusted verifier. A passing version may
be previewed and published. A rejected version is not presented as verified or
publishable.

### Review repair and failure outcomes

When verification rejects an attempt, the teacher can inspect stable findings and a
plain-language explanation. The orchestrator may ask Codex to repair only generated
artifact files; repair cannot change application equations, policy, tolerances, or
the trusted verifier. Generation and repair stop after no more than three total
attempts. Scientific rejection, provider failure, runner failure, cancellation, and
budget exhaustion remain distinguishable outcomes.

### Manage owned content

The teacher can inspect version and verification history, export a simulation with
its provenance and recorded content-license metadata, archive it, or delete it.
Changing an artifact, applicable policy, domain pack, or relevant dependency makes
the prior verification stale; stale content cannot display an active Verified badge
or be newly published.

## Lifecycle states

The durable product lifecycle is:

```text
draft -> generating -> verifying -> verified -> published -> archived
                  |          |          |
                  |          |          +-> stale
                  |          +-> rejected
                  +-> terminal operational outcome or cancellation
```

- `draft` represents teacher-owned work that has not entered generation.
- `generating` covers concept compilation, code generation, and repair attempts;
  detailed UI states may expose queued, compiling, generating, executing, and
  repairing without changing the durable lifecycle.
- `verifying` means runner output is being checked against trusted policy.
- `rejected` is a scientific-verification outcome with actionable findings.
- `verified` means a particular artifact passed a particular policy version over its
  recorded parameter space.
- `stale` means the evidence no longer applies to the current artifact or governing
  inputs.
- `published` is a teacher-approved, currently verified version in the library.
- `archived` is retained but removed from active use.

Deletion removes teacher-owned content through the supported deletion workflow rather
than acting as a display state. Provider errors, runner errors, cancellation, and
budget exhaustion are recorded explicitly and never mislabeled as scientific
rejection.

## Verification semantics

The application verifier, not a model-generated assertion, owns scientific truth:
domain equations, units, assumptions, invariants, valid parameter bounds, tolerances,
finding identifiers, and policy versions. Models may emit schema-constrained concept
specifications, produce or repair candidate pure simulation cores for runner-only
execution, and supply validated non-executable renderer data/adapters for
application-owned renderers. They cannot alter trusted policy during repair.

“Verified” always means that the exact artifact hash passed a named policy version
over the report's bounded parameter space and tolerances. It is not a claim of
universal correctness, correctness outside those bounds, pedagogical suitability, or
fitness for a particular learner. Reports must expose enough scope and provenance for
the teacher to understand that limitation. See
[ADR 0001](docs/decisions/0001-trusted-verification.md).

## Domain scope

Projectile motion and simple pendulum are the only initially supported generation and
verification domains. Each requires a complete trusted domain pack, including
equations, units, assumptions, parameter bounds, tolerance policy, deterministic
references, invariants, positive controls, realistic negative controls, report
semantics, and accessible renderer/data adapters.

Circuits and graphing are unsupported until complete domain packs pass the same
conformance and scientific-review gates. Other closed-form STEM topics and
runtime-downloadable scientific plugins are also outside the initial product.

## Non-goals

The initial product does not provide:

- student access, student data storage, classroom rostering, grading, or learning
  analytics;
- multiple administrators, collaboration, school SSO, OIDC, or multi-tenancy;
- verification of open-ended subjects or arbitrary scientific models;
- a universal correctness guarantee or an automated judgment of pedagogy;
- runtime-downloadable domain plugins or execution of third-party verifier policy;
- arbitrary generated code in the web or orchestrator process;
- support for deployment targets other than the documented Docker Compose topology;
- external telemetry or observability export unless the deployer explicitly enables
  the optional export.

## Data ownership and licensing

User-generated artifacts retain deployer/user ownership and carry recorded,
configurable export-license metadata; SimProof does not silently assign them a fixed
content license. The deployment owner controls locally stored product data and its
export and deletion workflows. Metadata is stored in SQLite and artifact payloads in
content-addressed files, with integrity maintained across export, backup, restore, and
deletion. Credentials are never artifacts and are never included in an export or
backup.

SimProof source code is licensed under Apache-2.0. Bundled educational examples are
licensed under CC BY 4.0. License rationale and boundaries belong in
[ADR 0005](docs/decisions/0005-licensing.md), while storage behavior belongs in
[ADR 0003](docs/decisions/0003-storage-and-artifacts.md).

## Privacy posture

SimProof intentionally limits personal data by serving a single teacher and storing
no student accounts or records. Teacher prompts and the minimum required generation
context may be sent from the server to the configured OpenAI/Codex services when the
teacher requests generation. Provider credentials are deployer-supplied, remain
server-side, and must not enter browser bundles, generated artifacts, provenance,
logs, diagnostics, or the runner environment.

Telemetry and external diagnostics export are disabled by default. Local structured
diagnostics are included and must redact secrets. Export and deletion workflows give
the teacher control over stored prompts and artifacts. See
[ADR 0004](docs/decisions/0004-privacy-posture.md).

## Accessibility target

The educator experience targets WCAG 2.2 AA. Core workflows must be keyboard operable,
have visible focus and programmatic names, expose lifecycle and error status without
relying on color alone, and support appropriate reduced-motion and contrast behavior.

SVG is the default visual renderer. Every visual simulation must have an equivalent
textual/data representation that exposes the same meaningful state, values, units,
and verification context. Accessibility regressions are correctness defects, and a
domain is incomplete without its accessible representation.

The web design system is shadcn/ui with committed component source and CSS-variable
semantic tokens. Feature code composes shared primitives; controls are not hand-rolled
and primitive-library imports stay inside `apps/web/src/components/ui`.

## Operational requirements

- A fresh supported deployment installs bundled verified examples and serves them
  without model credentials. Generation remains unavailable until deployer-supplied
  credentials validate.
- The web surface is authenticated with one local administrator account and secure
  server-side sessions; an unauthenticated network deployment is not supported.
- Generated code runs as an unprivileged process only inside the isolated runner,
  without network, credentials, host mounts, the repository, or the Docker socket.
- SQLite metadata transitions are transactional. Artifact content is addressed and
  checked by hash. Backups and restores preserve references and verification state.
- Verification evidence is immutable. A new run produces a new record, and any
  relevant change invalidates the active badge until re-verification.
- Generation and repair use explicit, persisted states and stop after at most three
  attempts.
- Local health, readiness, stable error identifiers, and redacted structured
  diagnostics are included. Optional external export is off by default.
- The authoritative repository gate ultimately covers formatting, lint, types,
  scientific positive and negative controls, security boundaries, migrations,
  orchestration, accessibility, production builds, and deployment/recovery smoke
  tests.

## Release criteria

A production release is eligible only when all of the following are true:

1. Projectile and pendulum domain packs pass deterministic references, invariants,
   valid-range, tolerance, accessibility, and realistic negative-control tests.
2. Reports bind verdicts to exact artifact, runner, domain-pack, and policy versions,
   and stale evidence cannot produce an active badge or publication.
3. Generated-code isolation tests deny filesystem, network, process, environment,
   dynamic loading, resource-exhaustion, and cross-workspace attacks.
4. Authentication, session, origin, secret-redaction, export, deletion, migration,
   backup, restore, and artifact-integrity tests pass.
5. Generation succeeds with deterministic fake providers in automated tests, obeys
   the three-attempt cap, and cannot mutate verifier policy during repair.
6. The seed experience works without model credentials; configured real-provider
   behavior is documented without making live credentials a CI requirement.
7. Keyboard, browser, automated WCAG 2.2 AA, production-build, Compose deployment,
   clean-install, restart, upgrade, recovery, and shutdown-cleanup gates pass.
8. `pnpm check` is green as the authoritative repository gate, licensing and security
   documentation are complete, and release artifacts are traceable to source.

## Definition of done

SimProof is done for its initial production scope when a teacher can deploy the
documented Compose topology, sign in, use accessible bundled projectile and pendulum
examples without model credentials, configure server-side credentials to generate a
new supported simulation, understand every lifecycle and failure outcome, publish
only currently verified work, and export or delete owned content.

That result must be backed by trusted immutable verification, isolated generated-code
execution, durable and recoverable storage, privacy-preserving diagnostics, complete
licensing, and all release criteria above. A polished demo, a passing happy path, or a
model's own claim of correctness does not satisfy this definition.
