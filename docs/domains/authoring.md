# Authoring a reviewed domain pack

## Start with the claim, not the interface

Before writing SDK code, write one sentence defining what the verifier can honestly
claim, followed by its assumptions, input bounds, singularities, and unsupported
cases. If an independent trusted reference or defensible tolerance cannot be stated,
stop: the topic is not ready to become a supported domain.

Read the [domain-pack contract](domain-pack-contract.md), complete the
[scientific-review record](scientific-review.md), and keep domain science together in
`packages/verifier/src/domains/<domain>/`. Generic lifecycle and conformance mechanics
belong in `packages/domain-pack-sdk`; equations do not.

## Recommended package layout

```text
packages/verifier/src/domains/<domain>/
  concept.ts                 # strict concept validation and applicability
  manifest.ts                # immutable metadata, citations, units, review ownership
  policy.ts                  # immutable policy, bounds, samples, tolerances, finding IDs
  reference.ts               # trusted deterministic implementation
  verifier.ts                # candidate-boundary parsing and scientific comparisons
  accessible-adapter.ts      # normalized state -> scene plus equivalent data
  conformance.ts             # pack assembly and domain-specific controls
  <domain>.test.ts           # positive, negative, property, boundary, parity tests
tests/fixtures/
  correct/<domain>-*.json
  negative-controls/<domain>-*.json
```

Create only files with real domain-owned contents. A smaller cohesive layout is valid;
the built-in pendulum pack remains split according to its actual responsibilities.
The manifest's `scientificReview` field carries the reviewed pack/policy identities,
base revision, structured decisions, exact checks, change impact, maintainers, and audit
actors. Each actor explicitly states whether a human subject-matter or educator
credential is claimed. The generated review binding separately binds that artifact and
ordered audit set to the exact non-self-referential content fingerprint. Longer
derivation/calibration records can live in declared inventory files, with their claims
summarized under stable manifest evidence IDs.

## Worked pendulum example

The compile-checked example is
[`tests/docs/src/pendulum-authoring-example.ts`](../../tests/docs/src/pendulum-authoring-example.ts).
It imports the real SDK and built-in pendulum pack, validates the manifest, proves SDK
compatibility, registers the pack explicitly, and runs conformance. Documentation tests
also verify the source and fixture references in this guide.

The example is deliberately not a second pendulum implementation. The application-owned
equation, policy, verifier, and adapter remain under
[`packages/verifier/src/domains/pendulum`](../../packages/verifier/src/domains/pendulum/).
Copying their equation into the SDK or renderer would violate the trust boundary.

### 1. Define the bounded science

The pendulum pack claims only that candidate periods match
`T = 2 pi sqrt(L / 9.81)` within 1% for an ideal small-angle pendulum with
`0.5 <= L <= 2 m` and `0 < amplitude <= 15 deg`. The derivation, nonlinear comparison,
gravity convention, and error budget are recorded in the
[filled review example](scientific-review.md#pendulum-review-example).

Do not phrase this as “the pendulum is correct.” A passing report is evidence only for
the exact candidate artifact, policy version, sampling grid, assumptions, bounds, and
tolerance recorded in that report.

### 2. Define strict concept and quantities

The concept schema uses the shared exhaustive `pendulum` discriminator. It requires
length in metres and amplitude in degrees, rejects unknown fields, and rejects the
whole request if any requested range lies outside policy applicability. The trusted
reference converts angle only when it needs a radian trigonometric argument; a renderer
does not perform scientific conversion.

Each manifest unit entry names its quantity, symbol, dimension, and role. Symbols alone
are insufficient: `m` means pendulum length here, and `s` means period. Add schema tests
for missing, duplicate, and ambiguous quantity/unit declarations.

### 3. Build an independent reference and immutable policy

The pendulum reference is pure and closed-form. It imports only reviewed policy
constants, not candidate output or generated code. The policy owns its exact sampling
grid, applicability, assumptions, limitations, and period tolerance. Freeze nested
arrays and objects, then let conformance attempt mutation and compare repeated output.

Reference tests cover known vectors, `T(L2)/T(L1) = sqrt(L2/L1)`, finite output, exact
endpoints, just-outside endpoints, and stable results across repetition and order.

### 4. Define stable findings and controls

Pendulum IDs are namespaced by domain and cause, for example
`pendulum.period.relative-error` and `pendulum.input.out-of-domain`. Never encode an
array index, translated prose, pack version, or transient implementation detail in an
ID. Separate invalid boundary input from an inapplicable scientific input and from a
valid input whose candidate result mismatches the reference.

The complete control set includes:

- known-correct periods on every policy sample;
- an inverted length/period ratio that looks plausible but violates `sqrt(L)`;
- wrong units and non-finite output;
- missing, extra, duplicate, and reordered sampling cases as applicable;
- exactly-on and just-outside length/amplitude bounds; and
- seeded length-ratio properties.

Keep negative controls after the bug they represent is fixed. Their purpose is to
prove the verifier rejects realistic wrong science.

The worked pack's durable fixture inventory is the
[known-correct period vector](../../tests/fixtures/correct/pendulum-correct.json), plus
negative controls for [inverted length/period
behavior](../../tests/fixtures/negative-controls/pendulum-inverted-ratio.json),
[wrong units](../../tests/fixtures/negative-controls/pendulum-bad-units.json),
[non-finite output](../../tests/fixtures/negative-controls/pendulum-nonfinite-output.json),
and [out-of-domain
inputs](../../tests/fixtures/negative-controls/pendulum-out-of-domain.json). Sampling-grid
shape failures, endpoint triples, and seeded properties are executable controls in the
domain tests and conformance adapter because they are generated cases rather than
static vectors.

### 5. Supply one accessible normalized representation

The pack's adapter maps validated state to an immutable scene and equivalent data
record. For pendulum, both representations expose length, amplitude, current time,
angular displacement, period evidence, turning points, equilibrium crossings, units,
assumptions, and limitations when those values are present in normalized state.

The adapter supplies data, not markup or behavior. The application-owned renderer
creates SVG; the shared shell creates a visible captioned table and text description.
Tests compare exact meaningful values between the two. Play/Pause, Reset, stepping,
focus, announcements, and reduced motion remain application-shell responsibilities.

### 6. Register explicitly

Add one static import and one literal registry entry. Do not scan a directory, load a
package name from configuration, or add a runtime import hook. Registration validates
the manifest against the running SDK version and rejects duplicate pack/policy IDs.
Update the exhaustive supported-domain discriminator in the same change.

The registry is a trust decision visible in review. A skeleton requirements document
or conforming object created only in a test does not make a domain supported.

### 7. Run and record evidence

Run:

```sh
pnpm test:domain-packs
pnpm --filter @simproof/docs test
pnpm --filter @simproof/verifier test
pnpm check
```

Record exact commands, results, pack fingerprint, policy version, fixture changes, and
review decisions. The first two commands exercise the shared conformance suite and this
compile-checked authoring example. The repository gate remains authoritative.

## Versioning examples

| Change | Minimum action |
|---|---|
| Typo outside any reported claim or citation meaning | Review; fingerprint decision under declared rules |
| Add a finding explanation without changing its scientific meaning | Pack version and report/UI compatibility review |
| Change an input bound, equation, constant, sample, check order, helper threshold, tolerance, or finding meaning | Policy and pack version review, full controls, ordered parity, fingerprint, stale-report analysis |
| Change normalized accessible data fields | Pack compatibility review, renderer equivalence/accessibility replay, stale-report analysis if scientific evidence changes |
| Upgrade a reference-relevant numerical dependency | Scientific review, cross-version vectors, fingerprint, stale-report analysis |

SemVer does not decide evidence validity by itself. The review record states whether
old reports remain resolvable and whether they are current.

## Before proposing a new domain

- The claim, exclusions, applicability, singularities, and citations are explicit.
- An independent trusted reference exists without generated or renderer code.
- Units and all conversions are unambiguous.
- Tolerances have quantified calibration and defect discrimination.
- Positive, realistic negative, property, and boundary controls are complete.
- The adapter provides equivalent scene and visible data/text output.
- Separate scientific and pedagogical/accessibility audits accepted the exact content,
  identify their automated or human provenance, and claim no credential they do not
  have.
- Registration is static, exhaustive, fingerprinted, and compatible with the SDK.
- Report invalidation and retained-version behavior are tested.

If any item is absent, keep the work as an unsupported requirements document. The
[circuits](circuits-requirements.md) and [graphing](graphing-requirements.md) documents
show that pre-implementation state.
