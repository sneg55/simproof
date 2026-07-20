# Scientific review and change control

## Purpose

A domain pack carries trusted equations and acceptance policy. Code review alone does
not establish that those choices are scientifically defensible. This process requires
two explicit decisions:

1. **Scientific validation:** Are the model, derivation, units, applicability,
   singularities, numerical method, tolerances, references, and controls correct for
   the stated claim?
2. **Pedagogical review:** Do the learning scope, explanations, controls, scene, data
   representation, and limitations help a teacher use that bounded claim accurately?

Neither decision implies the other. A scientifically valid simulation can teach the
wrong objective or obscure its limits. A clear lesson can use an invalid model. Both
review decisions must pass before registration, and neither may expand the verifier's
claim beyond its evidence.

## Roles and provenance

- The **author** writes the derivation, implementation, calibration, fixtures, and
  evidence record.
- The **scientific audit** checks sources, derivations, applicability, numerical
  behavior, tolerance allocation, and controls. It records whether it was performed by
  an automated agent, a human subject-matter expert, or both.
- The **pedagogical/accessibility audit** checks learning objectives, language,
  misconceptions, inspectability, and the equivalent nonvisual representation. It
  records whether it was automated, human, or both, separately from the scientific
  decision.
- A **maintainer** accepts or rejects the recorded evidence and checks security
  boundaries, SDK compatibility, registration, provenance, release impact, and
  stale-report handling.

The record names accountable people, teams, or automated audit identities; the exact
pack, policy, content fingerprint, and commit under review; the checks performed; and
the decision (`accepted`, `changes-requested`, or `rejected`). It must explicitly state
whether any human subject-matter or educator credential is claimed. An automated audit
must never be presented as human expertise. A later human review is additive release
evidence bound to the same immutable content, not an unstated prerequisite or a reason
to fabricate a credential in the current record.

## Required review record

Store the immutable review subject and audits in the manifest beside the domain source.
Because a file cannot contain its own content hash, generate the separate exact-content
review binding beside the checked-in fingerprint file. Registration requires the
binding's pack hash, pack/policy versions, base revision, artifact ID, and ordered audit
IDs to match the manifest and computed inventory. Together they contain:

- pack ID/version/content fingerprint and policy ID/version;
- author and maintainer ownership;
- each citation with title, author or issuing body, durable locator, relevant section,
  edition/version, stable citation ID, and the exact claim it supports;
- derivation notes from governing principles to every trusted reference result;
- units and dimension analysis for inputs, intermediate quantities, and outputs;
- assumptions, parameter bounds, inclusive/exclusive endpoints, singularities,
  unsupported cases, and consequences outside the model;
- reference and candidate numerical methods, convergence/stability or closed-form
  justification, deterministic runtime constraints, and finite-output analysis;
- tolerance calibration data and an error-budget allocation;
- a complete inventory of verification-affecting constants and check ordering,
  including helper-local comparison, interpolation, spatial, and ordering thresholds;
- positive, negative, property, and boundary fixture inventory;
- accessible scene/data equivalence evidence;
- privacy/security effects and a declaration that no runtime plugin or generated
  verifier policy was introduced;
- scientific, pedagogical, accessibility, and maintainer decisions, including audit
  kind and an explicit human-credential claim or disclaimer; and
- change classification, compatibility impact, fixture replay, and stale-report
  decision.

URLs alone are not adequate citations. Prefer standards, peer-reviewed primary
sources, authoritative reference works, or established textbooks. Record edition or
version and a section/equation/table locator. Explain source conflicts or why a source
is applicable. A tutorial or generated explanation can help discovery but cannot be
the sole authority for trusted equations or tolerances.

The manifest links stable citation/evidence IDs directly to equations, constants,
applicability statements, numerical-method choices, and tolerance records. A citation
list detached from the policy does not show which source supports which claim.

## Derivation review

The derivation defines variables, sign conventions, coordinate system, initial and
boundary conditions, and all approximations. Each algebraic or numerical step must be
auditable without reading candidate generated code. The recorded scientific audit
checks:

- dimensional consistency and canonical unit conversion;
- limiting cases, symmetry, conservation or monotonicity laws where applicable;
- exact meaning of inclusive and exclusive endpoints;
- singular, ill-conditioned, discontinuous, or non-unique cases;
- whether the trusted reference is independent from candidate behavior; and
- whether renderer or pedagogical shortcuts accidentally become scientific truth.

If the model is approximate, state the comparison model and quantify the approximation
error over the whole supported domain. A familiar classroom formula is not by itself
an error bound.

## Numerical method and tolerance review

For a closed form, document floating-point range, cancellation, overflow/underflow,
and the finite domain. For an iterative method, also document initialization,
termination, maximum work, convergence evidence, conditioning, discretization, and
failure classification. Determinism includes fixed sampling, ordering, seeds, and
dependency versions.

Tolerance calibration separates at least:

| Error source | Required evidence |
|---|---|
| Model approximation | Bound or dense comparison to a higher-fidelity accepted reference over all supported inputs |
| Trusted reference numerical error | Analytic error bound or convergence/cross-implementation study |
| Candidate numerical error | Representative correct implementations and precision/step-size sensitivity |
| Floating-point and platform variation | Architecture/runtime replay or a justified analytic bound |
| Input/display rounding | Exact boundary conversion and round-trip tests |

Choose each tolerance from the evidence, then prove realistic defects exceed it. The
accepted error is not automatically the sum of worst cases: explain the combination
rule and safety margin. Record both false-reject and false-accept analysis. A tolerance
cannot be tuned against the implementation under test or broadened after a negative
control fails.

## Pendulum review example

This is a filled review narrative for the current small-angle pendulum policy. The
typed manifest and pack remain the machine authority; this narrative makes its claim
auditable.

### Claim and sources

The supported model is an ideal point-mass bob on a massless, inextensible string,
without damping or driving, under uniform configured gravity. For angular displacement
`theta` in radians, tangential force gives

`m L theta'' = -m g sin(theta)` and therefore
`theta'' + (g/L) sin(theta) = 0`.

Using `sin(theta) ~= theta` gives angular frequency `sqrt(g/L)` and the policy reference
period

`T_small = 2 pi sqrt(L/g)`.

The review uses these stable IDs and locators:

| ID | Source metadata | Locator and supported claim |
|---|---|---|
| `pendulum.openstax.simple-period` | Paul Peter Urone and Roger Hinrichs, OpenStax, *College Physics*, 2012, “16.4 The Simple Pendulum” | [Equations 16.23–16.29](https://openstax.org/books/college-physics/pages/16-4-the-simple-pendulum): tangential restoring force, radian arc length, small-angle approximation, and period |
| `pendulum.nist.nonlinear-period` | NIST Digital Library of Mathematical Functions, version 1.2.7, “§22.19(i) Classical Dynamics: The Pendulum” | [Equations 22.19.1–22.19.2 and following period statement](https://dlmf.nist.gov/22.19.i): nonlinear equation, bounded solution, and complete-elliptic-integral period used for endpoint error calibration |
| `units.bipm.si-9` | Bureau International des Poids et Mesures, *The International System of Units (SI Brochure)*, 9th edition, version 4.01 | [Sections 2.3.3 and 2.3.4](https://www.bipm.org/en/publications/si-brochure): coherent derived unit one, radian, and SI derived quantities/units |
| `gravity.nist.sp811` | Ambler Thompson and Barry N. Taylor, NIST Special Publication 811, 2008 edition | [Appendix B.8, row “acceleration of free fall, standard”](https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8): conventional standard gravity `9.80665 m/s^2` used to distinguish the policy's deliberate `9.81` convention |

### Applicability and numerical justification

The policy accepts `0 < amplitude <= 15 deg`, `0.5 <= L <= 2 m`, and uses configured
`g = 9.81 m/s^2`. Amplitude changes the validity of the approximation but not the
small-angle reference value. Zero amplitude is excluded because there is no oscillation
from rest and a measured period is not meaningful under this input contract. Negative
length, zero length, and lengths outside the bounded instructional range are
inapplicable rather than extrapolated.

For amplitude `alpha`, the undamped nonlinear period is

`T_exact = 4 sqrt(L/g) K(sin(alpha/2))`.

At the maximum supported amplitude of 15°, numerical evaluation gives
`T_exact / T_small ~= 1.004300579`, so the small-angle period is about `0.4301%` below
the nonlinear ideal model there. The relative difference increases from zero over this
range. The policy's 1% relative period tolerance therefore covers the stated model
approximation at the endpoint and leaves about `0.5699` percentage points for candidate
and floating-point error. The reference is a closed-form finite calculation over the
length bounds; property tests verify the `sqrt(L)` ratio and deterministic output.
The docs gate independently reproduces the endpoint ratio by composite Simpson
evaluation of the complete elliptic integral; that calculation is calibration evidence,
not a second production reference implementation.

The accepted error budget is explicit rather than implied:

| Error source | Pendulum evidence and allocation |
|---|---|
| Model approximation | The independently reproduced nonlinear endpoint comparison is `0.4301%`; monotonicity over `0 < amplitude <= 15 deg` makes that the supported-range maximum. |
| Trusted reference numerical error | The production reference is one finite closed-form `sqrt` evaluation over `0.5 <= L <= 2 m`, with no iteration, subtraction, or singular denominator. Exact-vector, repeated-call, and seeded ratio tests hold to `1e-12` relative scale, far inside the remaining margin. |
| Candidate numerical error | The known-correct three-sample fixture passes with the serialized binary64 results, while the policy permits a candidate implementation up to the explicit 1% relative boundary. No hidden absolute floor is added. |
| Floating-point and platform variation | Inputs and outputs are finite binary64 values in a small normal range. Determinism, finiteness, exact fixture replay, and below/equal/above threshold controls are required on the supported Node runtime. |
| Input/display rounding | Verification consumes the runner's numeric output directly and does not parse rounded display text; display formatting receives no error allocation and cannot alter the verdict. |

**False-reject analysis:** the exact reference fixture and the 1% equality control pass,
and even the independently calculated nonlinear ideal period at the worst supported
amplitude differs by only `0.4301%`. **False-accept analysis:** errors at or below 1%
are intentionally within this bounded policy; an immediately-above control is rejected,
and the inverted-ratio negative control is rejected at every sample with relative
errors from `390.5%` through `1862%`. These controls establish the declared threshold
and a realistic defect's discrimination; they do not justify claims outside the
reviewed range or about untested pendulum models.

The `g = 9.81 m/s^2` value is a documented product convention, not a claim to local
gravity or exact standard gravity. NIST lists conventional standard gravity as
`9.80665 m/s^2` at the SP 811 locator above. Candidate and reference must use the same
policy-bound value; changing it requires a policy version, fixture replay, and
stale-report analysis.

### Controls and review state

The current evidence includes exact sampling at `(0.5 m, 5 deg)`, `(1 m, 10 deg)`, and
`(2 m, 15 deg)`; a known-correct fixture; an inverted-length-ratio negative control;
bad-unit, non-finite, incomplete-grid, and outside-applicability controls; seeded
`sqrt(L)` properties; exact endpoint tests; immutable policy checks; and accessible
scene/data equivalence through the built-in pack conformance suite.

This checkpoint records separate automated scientific and pedagogical/accessibility
audits plus maintainer acceptance. It claims no human subject-matter-expert or educator
credential. The automated scientific audit covers the cited derivation, applicability,
endpoint calibration, unit declarations, exact fixture parity, and conformance gates.
The automated pedagogical/accessibility audit covers bounded learning scope,
limitations, non-executable scene data, and exact scene/table equivalence. A later
human review may be appended as additional fingerprint-bound release evidence; it must
not rewrite or mislabel this audit record.

## Projectile review record

### Claim, derivation, and sources

The supported model is a point mass launched from and landing at `y = 0` in a flat
inertial frame, with no drag, wind, spin, or lift and constant configured gravitational
acceleration `g = 9.81 m/s^2`. For initial speed `v` and launch angle `theta`, measured
in radians inside the trusted reference,

`x(t) = v cos(theta) t` and `y(t) = v sin(theta) t - g t^2 / 2`.

Solving the nonzero root of `y(t) = 0`, evaluating `y` where vertical velocity is zero,
and substituting the flight time into `x` gives

- `T = 2 v sin(theta) / g`;
- `H = v^2 sin^2(theta) / (2 g)`; and
- `R = v^2 sin(2 theta) / g`.

Each expression is dimensionally a time or length as declared. The identity
`sin(2 theta) <= 1` gives the level-ground maximum at 45°. The OpenStax projectile
motion reference cited by the manifest supports these component equations and model
assumptions. The BIPM SI Brochure supports the declared units, and NIST SP 811 is used
only to distinguish the policy's deliberate `9.81 m/s^2` classroom convention from
conventional standard gravity. None of those sources is claimed to choose SimProof's
software tolerances; the calibration below does that.

### Applicability and numerical method

The closed instructional domain is `15 <= v <= 40 m/s` and
`15 <= theta <= 75 deg`. The bounds avoid near-vertical and near-horizontal limiting
cases, keep every sampled apex above 1 m, and cover a useful symmetric angle range.
They are product applicability choices, not a claim that the equations become singular
immediately outside them. Concept requests outside the bounds and candidate observation
grids that do not exactly match the verifier-owned points fail at their respective
boundaries; they are not scientific findings.

The trusted reference is a fixed sequence of binary64 `sin`, `cos`, multiplication,
division, and `sqrt` operations. Over the finite supported range, all intermediate
values are ordinary finite numbers far from overflow, underflow, or a singular
denominator. There is no iteration, convergence criterion, interpolation, or
candidate-selected sample. Repeated reference calls and the seeded complementary-angle,
landing-state, and energy properties are deterministic to `1e-12` relative scale on
the supported runtime. Candidate time matching uses the declared `1e-10` relative
scale exactly; time, horizontal-position, and vertical-position comparisons add no
helper-local epsilon or hidden acceptance floor.

### Tolerance calibration and error budget

The model-approximation allocation is zero because the verified claim is explicitly
the vacuum, level-ground, constant-gravity model; SimProof does not claim agreement
with drag-affected real trajectories. Trusted-reference roundoff is allocated below
`1e-12` relative by the finite-range analysis and property replay. Verification reads
runner numbers directly, so display formatting and text round-trips receive no error
allocation. The remaining thresholds admit a representative correct finite-step
candidate while retaining separation from the realistic defects and exact boundary
controls.

| Threshold | Calibration evidence and decision |
|---|---|
| Range, 1% relative | The analytic fixture is exact and the fine symplectic fixture's maximum range error is `0.18325%`; the remaining margin is about `0.81675` percentage points. |
| Apex height, 1% relative | The analytic fixture is exact and the fine symplectic maximum is `0.49023433%`; the remaining margin is about `0.50977` percentage points. |
| Flight time, 1% relative | The analytic fixture is exact and the fine symplectic maximum is `0.18325%`; the remaining margin is about `0.81675` percentage points. |
| Trajectory y, 2% of trusted apex | The fine symplectic maximum is `0.98054554%` of apex; the remaining margin is about `1.01945` percentage points. |
| Trajectory time, `1e-10` of `max(1, t)` | Both reviewed positive controls use verifier-owned sample times within this boundary. The scale is eight orders above the `1e-18`–`1e-16` arithmetic noise seen in the bounded closed-form replay while still rejecting a shifted sample location. |
| Trajectory x, `1e-10` of trusted range | Both reviewed positive controls have normalized x-location error below `3.7e-14` (`3.7e-12%`). The boundary is about 2,700 times that observed error, matches the time-location scale, and caps any accepted shift below `9.2e-9 m` over the complete grid. |
| Specific energy, 2% relative | The analytic fixture's maximum drift is below `5.5e-14%`; the fine symplectic maximum is `0.63153219%`, leaving about `1.36847` percentage points. |
| Maximum-range ordering, 1% relative | At 40° and 50°, the analytic range is `1.51922470%` below the 45° value. The ordering allowance is smaller than that nearest-grid separation by about `0.51922` percentage points. |

These are independent per-check budgets, not quantities summed into one global
allowance. A candidate must pass every applicable check. Equality is accepted and the
next representable value above the exact absolute-comparison boundary is rejected;
test-only accepted-side construction handles cases where decimal multiplication cannot
represent mathematical equality exactly.

**False-reject analysis:** the analytic and fine symplectic positive controls pass all
checks. Their maxima above remain below every applicable threshold, and exact
below/equal/above controls pass below and at each boundary. **False-accept analysis:**
every immediately-above threshold control is rejected. The accepted-side x control
also bounds the deliberate false-accept region: a shift just below `1e-10` of range is
accepted, but is less than `9.2 nm` anywhere on the grid and cannot represent a
meaningful sample-location defect at the model's metre scale. The coarse-Euler control has
maximum scalar errors of `27.92%`–`31.51%`, trajectory-y error `57.45%`, and energy
drift `37.40%`; the dropped-factor and radians defects exceed at least one relevant
threshold by still larger margins. The controls establish discrimination for these
plausible failures without extending the claim beyond the finite grid.

### Review and migration state

The automated scientific audit covers the derivation, dimensional analysis,
applicability semantics, finite-range method, all eight error budgets, exact boundary
comparison, fixture replay, and stale-evidence classification. The separate automated
pedagogical/accessibility audit covers bounded learning scope, explicit limitations,
non-executable scene data, and visual/table equivalence. Neither audit claims a human
subject-matter-expert or educator credential. Maintainer acceptance is bound through
the structured review record to the exact pack fingerprint, policy identity/version,
base revision, audit identities, commands, and change classification.

The removal of the dead absolute floor, promotion of time/x tolerances into shared
policy, exact comparison semantics, and boundary lifecycle clarification are classified
as a minor trusted-policy change: projectile policy and pack advance from `1.0.0` to
`1.1.0`. Old `1.0.0` evidence remains historical and is stale under both
`policy-changed` and `domain-pack-changed`; the implementation does not relabel it or
pretend the old policy remains installed.

## Projectile dead-threshold migration decision

The pre-SDK projectile trajectory helper declared an apex absolute floor of `0.02 m`.
The verifier-owned fixed sampling grid gives every trusted apex a height above `1 m`,
so the active 2% relative apex allowance is greater than `0.02 m` for every case. The
absolute floor therefore never selects the accepted error, cannot change a verdict or
finding, and is dead policy for the supported grid.

Plan 011 removes that field instead of promoting it into the manifest and fabricating
below/equal/above controls for an unreachable branch. Regression evidence must prove
the dominance inequality over the complete policy grid and preserve every fixture's
verdict, sample count, exact ordered finding IDs, and multiplicity. If a later policy
adds a case at or below `1 m` apex height, its tolerance calibration starts as a new
review decision; this deleted value does not silently reactivate.

Although scientific outcomes remain identical, removing the field changes versioned
policy content and the domain-pack fingerprint. Installed evidence bound to the prior
content becomes stale as `policy-changed` and `domain-pack-changed` under the
authoritative comparison; parity proof does not allow old reports to be relabeled
current.

## Review checklist and evidence map

| Review question | Recorded decision evidence | Machine evidence |
|---|---|---|
| Are sources authoritative and relevant? | Scientific audit records each claim/locator decision and its audit identity | Manifest citation schema, minimum citation count, reachable local references |
| Is the derivation correct and dimensionally sound? | Scientific audit records its independent reproduction or review method | Unit-integrity, property, and reference-vector tests |
| Are assumptions and learning scope honest? | Separate scientific and pedagogical decisions record scope acceptance | Required manifest fields and report snapshot tests |
| Are all bounds and singularities explicit? | Scientific audit records the completeness decision | Inside/on/outside boundary fixtures and strict concept validation |
| Is reference behavior independent and deterministic? | Scientific audit records the implementation-independence decision | Repeat-call, order, seed, finiteness, and cross-vector tests |
| Is the numerical method justified? | Scientific audit records the method/error-analysis decision | Convergence or closed-form tests and bounded-work checks |
| Is each tolerance calibrated? | Scientific audit records error-budget acceptance | Calibration vectors, threshold tests, and realistic negative controls |
| Are all verdict-affecting thresholds and check order public policy? | Scientific audit traces implementation to the inventory | Policy fingerprint, no-hidden-threshold audit, ordered finding parity, and below/equal/above controls |
| Are finding IDs stable and useful? | Separate scientific and pedagogical decisions record explanation acceptance | Namespace, uniqueness, schema, and regression snapshots |
| Do controls cover plausible defects? | Scientific audit traces each defect to a control | Positive/negative/property/boundary conformance gates |
| Are visual and data outputs equivalent? | Pedagogical/accessibility audit records the usability decision | Adapter equivalence, schema, keyboard, reduced-motion, and WCAG tests |
| Is policy immutable during generation/repair? | Maintainer audits boundary | Deep-freeze, repair, provenance, and report-binding tests |
| Is registration build-time only? | Maintainer audits dependency and registry diff | Explicit registry, duplicate/incompatible rejection, no dynamic-loading checks |
| Does a change invalidate old evidence? | Scientific audit and maintainer classify impact | Fingerprint, stale-report, fixture replay, and migration tests |

### Stable machine-gate catalog

Review records cite these gate IDs. A gate automates only the stated evidence; the
record must still identify who or what accepted each scientific and pedagogical
decision and must not imply credentials it does not have.

| Gate | Machine-checkable evidence |
|---|---|
| `PACK-001` | Strict manifest schema rejects unknown and missing governance fields. |
| `PACK-002` | Registration rejects duplicate domain and domain/version identities. |
| `PACK-003` | Manifest, pack, policy domain/version, computed content fingerprint, and external exact-content review binding agree. |
| `PACK-004` | Current SDK satisfies the declared range; incompatible and malformed ranges fail. |
| `PACK-005` | Every inventory path is relative, canonical, declared, regular, and inside its pack root. |
| `PACK-006` | Missing, extra, duplicate, linked, device, and traversal inventory entries fail closed. |
| `PACK-007` | The canonical inventory produces a deterministic fingerprint and the generated review binding names that exact hash. |
| `PACK-008` | Every governing equation, constant, assumption, applicability rule, numerical method, and tolerance links to declared citation/evidence IDs. |
| `PACK-009` | Manifest quantity/unit uses agree across applicability, thresholds, controls, and quantity-tagged accessible table columns. |
| `PACK-010` | Applicability endpoints encode open/closed semantics and disposition. |
| `PACK-011` | Every declared singularity has independently passing below/equal/above control behavior. |
| `PACK-012` | Concept, candidate-boundary, finding, and check IDs are namespaced, unique, declared, stable, and emitted only in their allowed lifecycle. |
| `PACK-013` | Fixture outcomes match boundary error or verdict, sample count, and exact ordered finding IDs with multiplicity. |
| `PACK-014` | Every verdict-affecting tolerance/threshold has below, equal, and above controls. |
| `PACK-015` | Every applicability endpoint has immediately inside, exactly on, and immediately outside controls. |
| `PACK-016` | Property controls declare fixed seed, run bounds, generator bounds, invariant, and pass evidence. |
| `PACK-017` | The adapter accepts strict verified normalized output and emits schema-valid non-executable scene/data. |
| `PACK-018` | Every advertised feature is accepted by the typed renderer/domain capability registry used by renderer behavior tests. |
| `PACK-019` | Scene and visible table rows, exact values, assumptions, and limitations are equivalent; table columns separately cover every row key with coherent declared quantity/unit metadata. |
| `PACK-020` | Generic SDK source has no domain-ID branches, equations, tolerances, conversions, or renderer physics. |
| `PACK-021` | Registry imports are static and production contains no runtime domain discovery/loading path. |
| `PACK-022` | Authoritative comparison emits every exact stale reason, and the shared production trust decision blocks badge, preview, and publish access for individual and combined staleness. |
| `PACK-023` | A deliberately incomplete pack fails each applicable gate with the corresponding stable diagnostic ID. |
| `PACK-024` | Circuits and graphing requirements remain unsupported and absent from the built-in registry. |

## Change control

Every change begins by classifying whether it affects scientific meaning. Equation,
constant, dependency, schema, unit, applicability, sampling, invariant, tolerance,
finding semantics, reference, normalized state, or adapter-equivalence changes require
scientific review, a pack or policy version decision, full control replay, fingerprint
regeneration, and stale-report analysis. A refactor is non-scientific only when evidence
proves identical normalized outputs, findings, reports, and fingerprints by the
project's declared fingerprint rules.

Ordering is scientific behavior when it chooses between boundary failure,
inapplicable, rejected, or verified outcomes, or changes finding multiplicity/order.
Parity tests lock that behavior until a versioned review deliberately changes it.

Introducing manifests and moving hidden thresholds into explicit policy changes the
trusted content fingerprint. Migration review must record existing reports as
`domain-pack-changed`, and additionally `policy-changed` when policy content changes,
while separately proving the pre-migration fixture verdicts and ordered findings remain
unchanged. Stale evidence is re-verified; it is never relabeled current.

Do not edit an applied review record. Add a superseding record linked to the prior
decision. Emergency rollback restores a previously reviewed exact pack; it does not
silently reinterpret reports produced under the withdrawn version.
