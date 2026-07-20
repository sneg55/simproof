# Contributing to SimProof

Thank you for improving SimProof. Contributions must preserve the product's scientific,
security, privacy, accessibility, and data-integrity boundaries; a locally working
change is not enough when it weakens one of those contracts.

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Report a
security concern privately under [SECURITY.md](SECURITY.md), not through an issue or
pull request.

## Before opening a change

Use the closest issue template for bugs, accessibility, deployment, domain-pack
proposals, or scientific corrections. A small, well-scoped pull request may be opened
without an issue when its intent and evidence are self-contained. Do not put secrets,
student-identifying information, prompts, generated content, provider responses, raw
diagnostics, or vulnerability details in public collaboration records.

Read the relevant contracts before changing a trust boundary:

- [Product contract](PRODUCT_SPEC.md)
- [Architecture decisions](docs/decisions/)
- [Generated-code runner](docs/security/generated-code-runner.md)
- [Privacy inventory](docs/security/privacy.md)
- [Accessibility requirements](docs/product/accessibility.md)
- [Domain-pack authoring](docs/domains/authoring.md)

An accepted ADR is not changed implicitly. Propose an explicit decision update when a
change would alter deployment, trust, storage, privacy, or licensing policy.

## Development setup

Use Node.js `>=24.15 <25`, Python 3, Docker Engine with Compose v2, and the exact pnpm
version declared by `package.json`:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` is the authoritative repository gate. During development, run the
smallest relevant tests first, then run the full gate before requesting review. Common
focused gates are:

```sh
pnpm test:domain-packs
pnpm test:integration
pnpm test:security
pnpm test:diagnostics
pnpm test:a11y
pnpm test:e2e
pnpm test:deployment
```

Never make a test pass by weakening a verifier policy, negative control, runner
isolation, schema strictness, accessibility assertion, or production gate.

## Change requirements

### Scientific and domain-pack changes

Trusted policies—not models or renderers—own equations, constants, applicability,
sampling, tolerances, and findings. Follow the [domain-pack authoring
guide](docs/domains/authoring.md) and update exact-content review evidence.

A change to an equation, constant, bound, sample, tolerance, numerical method, finding
meaning, or verdict-affecting helper requires policy and pack version review,
quantitative calibration, positive and realistic negative controls, boundary controls,
fingerprint regeneration, stale-report analysis, and structured scientific review.
Do not claim human scientific or pedagogical credentials unless an identified reviewer
actually supplied them.

Circuits and graphing remain unsupported until complete application-owned packs pass
the same review and conformance gates as projectile and pendulum. A schema stub, model
prompt, or runtime plugin cannot make a domain supported.

### Persistence and migrations

Applied migrations are immutable. Add a new numbered migration for every schema change
and test fresh installation plus upgrades from every supported release fixture. Keep
foreign keys enabled and aggregate changes transactional. Changes to artifact
normalization or hashing are versioned artifact-format migrations; never reinterpret
bytes under an existing content hash.

### Generated-code security

Generated code runs only through the isolated runner. Changes to protocols, image
digests, imports, privileges, limits, cleanup, launcher authority, or output handling
need adversarial tests proving fail-closed behavior and no host or cross-workspace side
effects. Never add direct Node execution as a fallback and never expose the Docker
socket to the orchestrator or generated container.

### Privacy and diagnostics

Update the [privacy inventory](docs/security/privacy.md) before adding or renaming a
persisted or externally transmitted field. Keep credentials, cookies, session/CSRF
values, prompts, generated artifacts, provider responses, raw causes, and stack traces
out of logs and diagnostic bundles. External telemetry and diagnostics remain disabled
by default.

### Web and accessibility

Use the committed shadcn/ui primitives in `apps/web/src/components/ui` and semantic
tokens. Teacher workflows must remain keyboard-operable and meet WCAG 2.2 AA, with
visible focus, status announcements, reduced-motion behavior, and a textual or tabular
equivalent for every visual simulation.

## Pull requests

Use the pull-request template and include:

- the problem, scope, and intentionally unchanged behavior;
- focused and repository-wide commands with results;
- policy, domain-pack, schema, migration, artifact-format, protocol, and compatibility
  impact;
- security, privacy, accessibility, and licensing impact; and
- user/operator documentation and changelog changes when behavior changes.

Keep generated files visibly generated and regenerate them only with their owning
script. Generated metadata is review evidence, not a substitute for reviewing its
source inputs. In particular, a regenerated domain-pack fingerprint or review binding
does not by itself approve changed scientific content.

Do not publish packages, images, repositories, advisories, or releases from a pull
request. Publication requires explicit operator authorization and the
[release runbook](docs/operations/releases-and-support.md).

## Contribution and licensing terms

No Contributor License Agreement or Developer Certificate of Origin sign-off is
currently required. Under Apache-2.0 section 5, unless explicitly stated otherwise, an
intentional code or documentation contribution submitted for inclusion is provided
under Apache-2.0 without additional terms. SimProof-authored bundled educational
content is submitted under CC BY 4.0 and must preserve the attribution in [NOTICE](NOTICE).

Do not submit material unless you have the rights needed to do so. Clearly identify
third-party material and its license before review. User-generated artifacts are not
project contributions merely because the application stores, verifies, or exports
them; their recorded license metadata is not a legal warranty. See
[ADR 0005](docs/decisions/0005-licensing.md).
