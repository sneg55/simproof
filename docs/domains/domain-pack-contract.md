# Domain-pack contract

## Status and authority

This is the extension contract for scientific domains shipped by SimProof. It
implements the trust boundary in [ADR 0001](../decisions/0001-trusted-verification.md)
and the domain scope in [`PRODUCT_SPEC.md`](../../PRODUCT_SPEC.md). A domain is
supported only when its application-owned pack is explicitly imported, registered,
scientifically reviewed, and shipped in a SimProof release.

A pack is source code under the same review, dependency, security, and release gates
as the rest of the application. It is not a runtime plugin. SimProof does not download,
discover, install, import, or execute domain packages from configuration, the data
directory, a model response, an archive, a URL, or a teacher upload. A third-party
contribution can become trusted only by entering the repository, completing this
contract, and shipping in a reviewed build.

Projectile and pendulum are the registered built-ins. Circuits and graphing remain
unsupported requirements only; probability is outside this contract's current scope.

## Trust boundary

The domain pack owns the trusted scientific meaning of its domain:

- the shared strict `ConceptSpec` schema, strict observation schemas, canonical
  quantities, and units;
- applicability conditions, parameter bounds, singularities, and assumptions;
- an independent deterministic reference implementation;
- immutable, versioned verification policy and sampling inputs;
- tolerances with calibration evidence;
- stable finding identifiers and teacher-facing explanations;
- positive, realistic negative, property, and boundary controls; and
- an application-owned adapter from validated normalized state to equivalent visual,
  textual, and tabular scene data.

The generic SDK may validate, register, and exercise these parts. It must not contain
domain equations, constants, special cases, tolerances, or repairs. A model may emit a
schema-constrained concept, candidate pure core, and validated non-executable renderer
data. It cannot supply, replace, select, or weaken any trusted pack component.

Generated code runs only in the isolated runner. The verifier and renderer never
evaluate generated source. A renderer consumes normalized state and must not
reimplement an equation or state transition.

## Required package contents

Each registered pack provides one immutable `DomainPack` and the evidence below.

| Content | Contract | Machine evidence |
|---|---|---|
| Identity | Stable lower-case namespaced ID and semantic pack version | Manifest schema and duplicate-registration tests |
| Ownership | Named maintainer team and completed scientific-review record | Manifest schema; review-record presence gate |
| Learning scope | Human title, description, learning objectives, and explicit exclusions | Manifest schema and documentation review |
| Citations | Stable citation IDs for authoritative sources, with title, author or issuing body, edition/version, locator, and supported claim | Citation schema, reference-integrity gate, and manifest-to-policy linkage tests |
| Concept boundary | Shared strict `ConceptSpec` schema with no unknown fields and an exhaustive domain discriminator | Schema rejection and registry exhaustiveness tests |
| Units | Unique quantity IDs, unambiguous canonical unit symbols, and dimensions | Unit-integrity and duplicate-quantity tests |
| Applicability | Inclusive/exclusive bounds, model conditions, assumptions, limitations, and singularities | Boundary fixtures and inapplicable-verdict tests |
| Reference | Pure, deterministic, finite trusted calculations over the supported range | Repeatability, finiteness, property, and boundary tests |
| Policy | Stable policy ID, semantic version, immutable checks, sampling, tolerances, assumptions, and limitations | Deep-immutability and compatibility tests |
| Findings | Stable namespaced IDs, categories, quantities, and explanations | Uniqueness, schema, and snapshot/regression tests |
| Controls | Known-correct, realistic negative, property, and boundary controls | Conformance control gates; negative controls must be rejected |
| Accessible output | One validated state maps to both visual scene data and equivalent text/table data with exact values and units | Accessibility-adapter conformance and renderer equivalence tests |
| Compatibility | Supported SDK semantic-version range | Manifest validation and incompatible-SDK rejection tests |
| Change history | Pack and policy versions plus an evidence-impact decision | Review and stale-report tests |

Passing the schema proves structure, not scientific validity. Passing conformance proves
the registered tests behave consistently, not that their equations or tolerances are
correct. A separate scientific review decision records the audit method and whether it
was automated, human, or both; automated evidence must not imply a human credential.

## Identity, versions, and compatibility

- Pack IDs and policy IDs are permanent. Renaming creates a new identity and requires a
  migration and stale-evidence analysis.
- Pack and policy versions use SemVer. A change that can change applicability, expected
  values, findings, tolerances, or verdicts is not a patch-only documentation change.
- The manifest declares an SDK compatibility range. Unsupported, malformed, empty,
  open-ended, or ambiguous ranges fail registration.
- Verification evidence binds the exact pack ID/version/content fingerprint and policy
  ID/version. A relevant change makes previous evidence stale; it never silently
  changes the meaning of an existing report.
- A release may retain an older policy only if its implementation, fixtures, dependency
  closure, and report semantics remain installed and independently addressable.

The generated domain-pack fingerprint file is reviewed source evidence. Its check must
fail when registered trusted content changes without deliberate regeneration and
review. A separately generated review binding avoids impossible self-reference while
requiring the review artifact ID, base revision, pack/policy identities, and ordered
audit IDs to match that exact fingerprint at registration. Fingerprints and review
bindings are not substitutes for signing release artifacts.

## Compile-time registration

The built-in registry uses ordinary static TypeScript imports and an explicit literal
list or record. Registration validates every manifest and rejects duplicate pack IDs,
duplicate policy IDs, unsupported compatibility, and inconsistent domain
discriminators. Every `switch` over supported domains is exhaustive at compile time.

Registration must not use filesystem scanning, package-name conventions, dynamic
`import()`, `eval`, `Function`, worker-loaded source, database rows, environment values,
URLs, or dependency injection that accepts untrusted executable policy. Production
configuration can enable or disable a compiled feature; it cannot add a domain.

Adding a built-in pack therefore requires a source diff that changes the explicit
registry, the supported-domain discriminator, release evidence, and user-facing scope.
Removing one requires data compatibility and report-retention analysis.

## Schemas and units

Pack schemas validate every process boundary and reject unknown or oversized input.
Static TypeScript types are inferred from runtime schemas where a value crosses a
boundary. A unit entry identifies a scientific quantity as well as a symbol; the same
symbol cannot ambiguously stand for different quantities in one pack.

Canonical units are part of the policy. Conversion, when allowed, occurs in a reviewed
application-owned boundary before verification and is covered by exact conversion and
round-trip tests. Candidate output never selects a unit system. Angle documentation
must distinguish degree input from radian arguments used by trigonometric functions.
The [BIPM SI Brochure](https://www.bipm.org/en/publications/si-brochure) is the
normative units reference unless the review record justifies another standard.

## Reference, policy, and findings

The trusted reference is independent of the candidate core and cannot import candidate
or renderer code. It is pure and deterministic for identical normalized inputs. It
must fail closed for non-finite values, unsupported inputs, and singularities instead
of clamping, extrapolating, or quietly choosing a different model.

A policy names every check and owns its sampling inputs and tolerance. Repair cannot
change those inputs. Tolerance is quantity- and method-specific; a global epsilon is
prohibited. The review record must show how model approximation, reference numerical
error, candidate numerical error, floating-point effects, and measurement/display
rounding were allocated. A loose tolerance cannot compensate for an unstated model.

Every verification-affecting constant belongs in the immutable, versioned,
fingerprinted policy, including comparison epsilons, interpolation or time-matching
thresholds, spatial floors, ordering thresholds, and the sequence in which
applicability and scientific checks run. A helper-local “implementation detail” is
still policy when changing it can alter a verdict, finding, sample count, or finding
order. Hidden verifier thresholds are prohibited.

Finding IDs are lower-case, namespaced, stable API values. They distinguish malformed
input, unsupported applicability, non-finite output, invariant failure, and scientific
mismatch. Explanations state the checked quantity, applicable expectation, and
bounded tolerance without claiming universal correctness.

The manifest links each governing equation, constant, applicability rule, numerical
method, and tolerance-calibration record to one or more stable citation/evidence IDs.
It also classifies IDs as concept-boundary errors, candidate-boundary errors, or
scientific findings, and records check linkage, category, severity, explanation, and
deprecation/replacement lifecycle. All classes are unique within the pack namespace.

## Required controls

Each pack includes:

1. Positive controls independently known to be correct, including all policy checks.
2. Realistic negative controls for plausible sign, unit, ratio, equation, boundary,
   ordering, and state-transition defects. Each must fail for its intended reason.
3. Seeded property controls for dimensional relations, invariants, monotonicity or
   symmetry where scientifically applicable, finiteness, and determinism.
4. Boundary controls immediately inside, on, and outside each inclusive/exclusive
   limit, plus every declared singularity.
5. An intentionally incomplete conformance fixture proving each generic gate fails
   closed rather than allowing missing evidence.

The manifest inventory declares every control class, deterministic property seed, and
the exact expected boundary error or ordered finding sequence, including multiplicity
and sample count. Set comparison is insufficient: three repeated sample findings are
different evidence from one deduplicated finding. Threshold controls exercise a value
immediately below, exactly equal to, and immediately above every acceptance boundary.

Fixtures are permanent regression evidence. A policy change replays all of them and
records why any expected verdict changed. Tests or tolerances must not be weakened to
make a candidate or new pack pass.

## Accessible scene and data adapter

The adapter accepts only validated normalized state and returns non-executable data.
It supplies the same current parameters, exact values, units, meaningful events,
assumptions, limitations, and verification scope to:

- an application-owned visual scene description; and
- a visible text/table description with caption, headers, row/column relationships,
  current-state prose, and downloadable data when applicable.

It returns no HTML, SVG markup, scripts, event handlers, URLs, CSS, arbitrary ARIA
strings, or executable callbacks. Teacher controls remain design-system HTML controls
outside the scientific scene. Tests compare meaningful values in both representations,
exercise keyboard and reduced-motion behavior in the application shell, and follow the
[educator accessibility contract](../product/accessibility.md).

## Report and lifecycle integration

A verification report records the exact artifact hash, runner protocol/image identity,
pack identity/fingerprint, policy identity/version, bounded inputs, tolerances, and
findings. The active badge and publish action require current evidence. Changes to any
bound artifact, pack, policy, reference-relevant dependency, or runner semantics make
the evidence stale. Re-verification appends a new report; it does not rewrite history.
The change record distinguishes `policy-changed` when an installed policy identity or
content changes from `domain-pack-changed` when manifest/reference/adapter or other
pack content changes. A same-ID, same-version content collision fails installation; it
does not silently choose a staleness reason.

Stale-report conformance uses the authoritative installed-evidence path and exercises
artifact, policy, domain-pack, runner protocol, runner image, dependency, and report
integrity changes. A narrower convenience helper cannot serve as the gold standard.

An inapplicable input is not a scientific rejection. Schema failure, runner failure,
provider failure, cancellation, and budget exhaustion are operational outcomes and
must not be represented as verifier findings.

## Acceptance and change checklist

The [scientific-review checklist](scientific-review.md#review-checklist-and-evidence-map)
is mandatory. The author also demonstrates:

- `pnpm test:domain-packs` passes all registered packs and the incomplete-pack failure
  fixture;
- `pnpm --filter @simproof/docs test` compiles the authoring example and validates
  documentation references;
- package tests preserve existing projectile and pendulum verdict fixtures;
- `pnpm check` passes, including fingerprint, type, lint, security, accessibility,
  integration, and production-build gates; and
- each audit records its identity and kind, exact evidence commands, immutable commit
  references, and whether any human subject-matter or educator credential is claimed.

No checklist waiver can make a domain supported. Missing independent reference
behavior, honest applicability, defensible tolerance calibration, negative controls,
or equivalent accessible output is a STOP condition.
