# SimProof agent instructions

## Architecture and repository structure

Use this structure as the project grows:

```text
apps/
  web/                       # React teacher experience and thin simulation renderers
  orchestrator/              # GPT -> Codex -> runner generate/verify/repair loop
packages/
  contracts/                 # Shared boundary schemas and schema-derived types
  verifier/                  # Ground truth, tolerances, invariants, and verification reports
    src/domains/
      projectile/
      pendulum/
      circuits/
      graphing/
  sim-runtime/               # DOM-free interface and execution boundary for generated cores
  shared/                    # Truly cross-cutting Result, errors, cancellation, and truncation
tests/
  fixtures/
    correct/                 # Known-correct positive controls
    negative-controls/       # Realistic failure modes the verifier must reject
proof/                       # Original critical-path evidence; not production runtime code
scripts/                     # Repository checks and developer tooling
```

- Organize product code by feature or scientific domain, not by generic technical layers.
- Keep each domain's equations, schemas, tolerance policy, verifier logic, finding IDs, and tests together under that domain.
- Put schemas shared across processes in `packages/contracts`; infer static types from those schemas instead of maintaining duplicate interfaces.
- Generated physics cores must be pure, deterministic, importable, and free of DOM or renderer dependencies.
- Renderers may consume verified core output but must not reimplement governing equations or physics state transitions.
- The orchestrator owns generation, execution, verification, repair attempts, and provenance. It must not contain domain equations.
- `packages/shared` is only for code with multiple real consumers. Prefer keeping a helper inside its owning feature or domain.
- Preserve realistic negative controls as permanent regression fixtures. Do not weaken verification merely to make a generated artifact pass.
- Do not create directories, barrel files, abstractions, or placeholders before they have real contents and an identified owner.
- Add a nested `AGENTS.md` only when a subtree needs conventions that differ from or refine these root rules.

## File size and cohesion

- Keep production source files below 300 lines of code (LOC) whenever a cohesive design allows it.
- When a production source file crosses 300 LOC, review it before continuing and extract a distinct responsibility when that improves cohesion or navigation.
- Production source files must not exceed 400 LOC unless an exemption is explicitly documented in the file or the implementation notes.
- Do not split code solely to satisfy the LOC thresholds. Keep tightly coupled equations, invariants, state transitions, and their supporting logic together when separation would make correctness harder to audit.
- LOC exemptions are limited to generated artifacts, fixtures, test vectors, declarative schemas, migrations, and data tables. An exempt file must state why keeping it cohesive is clearer than splitting it.
- Treat cognitive complexity separately from file length. A file below 300 LOC still requires refactoring when its control flow or responsibilities are difficult to understand.
- A source-file exemption must use `LOC-EXEMPT: <specific reason>` in a leading comment so the automated check can verify that the exception is intentional.

## Lint and static verification

- Use Biome as the only formatter and for fast syntactic lint rules.
- Use ESLint only for type-aware TypeScript checks, React Hooks, imports, security, and cognitive complexity rules that Biome does not own.
- Do not add formatting rules to ESLint or duplicate a rule already enforced by Biome.
- Keep TypeScript strict and use `parserOptions.projectService` for typed ESLint rules.
- Run `pnpm check` after changing TypeScript, JavaScript, JSON, or configuration files.

## Persistence and artifact integrity

- Treat applied database migrations as immutable. Add a new numbered migration for
  every schema change, preserve migration checksums, and test both a fresh install and
  upgrade from every supported release fixture.
- Enable SQLite foreign-key enforcement on every connection and keep lifecycle
  transitions, evidence references, and other aggregate changes transactional.
- Store generated payloads only through the content-addressed artifact store beneath
  its configured data root. Persist canonical hashes, never request-derived host paths;
  reject traversal, absolute paths, hash mismatches, missing content, and corruption.
- Treat artifact normalization or hashing changes as versioned artifact-format
  migrations. Never silently reinterpret or overwrite bytes under an existing hash.
- Coordinate backup, restore, export, deletion, and orphan cleanup across both SQLite
  metadata and referenced artifact files. Credentials and unredacted secrets must not
  enter either store or any resulting archive.

## Production trust and safety invariants

- Treat [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md) as the authoritative product contract and accepted records in [`docs/decisions`](docs/decisions/) as the decision history.
- Trusted application-owned verifier policies define equations, invariants, parameter bounds, and tolerances. Models may supply schema-constrained concept specifications, candidate pure physics cores that execute only in the runner, and non-executable renderer data/adapters consumed by application-owned renderers; they must never redefine verification truth. See [ADR 0001](docs/decisions/0001-trusted-verification.md).
- Repair attempts may change only the candidate generated artifact. Keep the trusted policy, verification inputs, negative controls, and failure evidence immutable across repair, and stop after the configured attempt cap.
- Execute generated code only in the isolated runner container. Never evaluate it in the web app, orchestrator, host process, or verifier process; language-level permissions are defense-in-depth rather than the isolation boundary. See [ADR 0001](docs/decisions/0001-trusted-verification.md) and [ADR 0002](docs/decisions/0002-supported-deployment.md).
- Keep the runner fail-closed and unprivileged with a read-only root filesystem, a fresh private bounded workspace, no network, secrets, host or persistent-data mounts, repository, devices, or Docker socket, dropped capabilities, and externally enforced process/resource/output limits. Never fall back to direct Node execution when isolation is unavailable.
- Treat runner protocols, images, dependencies, import policy, privileges, limits, cleanup, and stable denial identifiers as security-sensitive. Adversarial tests must prove forbidden capabilities cause no host or cross-workspace side effects and that every terminal path removes generated processes and workspaces.
- Validate every process boundary with shared runtime schemas, including model output, runner requests and reports, persistence records, imports, and API input. Reject unknown or oversized input before it reaches a trusted component.
- Keep OpenAI, Codex, administrator, and session secrets server-side. Never place secrets in prompts, generated artifacts, client bundles, logs, diagnostics exports, fixtures, or committed files.
- Preserve the teacher-only, single-tenant privacy posture: collect no student accounts or student records, minimize prompt and diagnostic retention, and keep telemetry and external export disabled by default. See [ADR 0004](docs/decisions/0004-privacy-posture.md).
- Update the privacy inventory before adding or renaming any persisted or externally transmitted field. Prompts default to discard, require teacher-visible provider disclosure before external transmission, and must never appear in ordinary logs.
- Keep authentication records out of teacher simulation exports. Backups may preserve the local administrator credential/settings but must exclude active sessions, and restore must invalidate every pre-restore cookie.
- Require exact HTTPS production origins. Trust forwarded request metadata only from one explicitly configured immediate proxy address; never enable blanket proxy trust.
- Construct browser configuration from an explicit public schema. Never serialize process environment or server configuration objects into client responses.
- Meet WCAG 2.2 AA for teacher workflows. Every visual simulation needs an equivalent textual or tabular representation, complete keyboard operation, visible focus, meaningful status announcements, and reduced-motion support.
- Before considering work complete, run focused tests plus the strongest repository-wide gate available. `pnpm check` is authoritative once Plan 007 lands; security, negative-control, integration, accessibility, production-build, and deployment smoke gates must not be skipped or weakened.

## Model orchestration

- Keep OpenAI Responses and Codex SDK calls behind typed provider ports. Default tests and demonstrations to deterministic fake providers; network-backed adapters require explicit server configuration.
- Compile teacher prompts only into the shared strict `ConceptSpec` schema. Never execute, evaluate, import, or dynamically interpret model output to determine a concept.
- Run Codex only through the server-side TypeScript SDK in a dedicated disposable artifact workspace with `workspace-write`, approvals disabled, command network and web search disabled, no additional writable directories, and an allowlisted child environment.
- Treat the Codex working directory and sandbox as the write boundary, then independently inventory output. Accept only the declared core, renderer, manifest, and test-adapter paths; reject links, devices, undeclared paths, traversal, and changes outside that inventory.
- Preserve one Codex thread per generation run and persist only bounded provenance: provider, model, template version, provider request ID, Codex thread ID, usage totals, artifact hashes, policy bindings, and stable error IDs. Never persist credentials, prompts when retention is disabled, raw reasoning, or unbounded diagnostics.
- Persist every run transition and attempt before starting the next external action. Idempotency keys identify one durable run; replay must return that run rather than create another.
- Propagate one cancellation signal through provider calls, Codex turns, runner execution, and durable terminal state. Cancellation, provider failure, runner failure, budget exhaustion, invariant failure, and scientific rejection are distinct outcomes.
- Count every provider request and token usage against a per-run budget, including failed and repair calls. Never exceed three total generation/repair attempts, and never repair trusted verifier policy, reference equations, sampling inputs, or retained findings.

## Operational signals and diagnostics

- Emit production operational signals only through `packages/observability`; do not add ad hoc `console` logging or component-specific log formats.
- Register every operational event and stable error ID before use. Propagate server-generated request IDs and durable run, attempt, and simulation IDs across component boundaries without accepting caller-selected correlation IDs.
- Keep signal schemas strict and allowlisted. Do not add arbitrary message, attribute, header, URL, path, environment, exception, provider-response, or content fields.
- Never emit credentials, authorization values, cookies, session or CSRF values, prompts, titles, findings content, generated/artifact content, provider responses, raw reasoning, raw causes, or stack traces.
- Add or update redaction fixtures before introducing any field that could carry sensitive data. Invalid local log entries must be discarded, never copied raw into a diagnostic bundle.
- Keep liveness dependency-free. Readiness may check configuration, migrations, database and artifact access, and local runner availability, but must never invoke a provider or execute generated code.
- External telemetry and diagnostic transmission remain disabled by default. Construct an exporter only after explicit validated enablement, document every exported field, and prove the default performs no network call.
- Build operator bundles property-by-property from their strict schema. Include configuration presence booleans only, refuse stdout and unsafe/overwriting destinations, and require a separate explicit category for redacted logs. No diagnostic option may include environment values, authentication data, prompts, generated content, artifacts, provider responses, or reasoning.

## Design system and UI primitives

- Use shadcn/ui as the web application's design system. Initialize it with the official CLI in `apps/web`, commit `components.json`, and keep the generated component source under `apps/web/src/components/ui`.
- Use CSS-variable semantic tokens for color, radius, spacing, typography, and elevation. Feature code must not introduce ad hoc visual values when an existing token or component variant fits.
- Feature code composes components imported from `@/components/ui`. Do not hand-roll buttons, inputs, selects, textareas, dialogs, tables, labels, progress indicators, or separators outside `apps/web/src/components/ui`.
- Direct Radix UI, Base UI, or Headless UI imports are allowed only inside `apps/web/src/components/ui`. Extend an existing shadcn component or variant there before creating a new primitive.
- Preserve semantic HTML for document structure and domain-specific accessible SVG. The primitive boundary does not justify replacing useful native structure with generic wrappers.
- Generated shadcn source is owned application code: review it, keep it accessible, and adapt it through variants rather than one-off feature styles.
- `pnpm check:ui` enforces the primitive boundary. Do not add broad lint disables; any narrow exception must include a specific reason and remain local to the exceptional line.
