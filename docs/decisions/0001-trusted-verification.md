# ADR 0001: Trusted verification and supported simulation presentation

## Status

Accepted

## Context

SimProof generates executable simulations with models, but model output cannot also be
the final authority for whether that output is correct. Allowing a generator to write
or revise its own answer key during repair would let it make an incorrect simulation
pass by weakening the check. The earlier demonstration specification described a model
as emitting executable ground truth; that shortcut is superseded for production.

Verification is necessarily scoped. Numerical methods have domain- and quantity-specific
tolerances, and a finite policy can only establish behavior over stated assumptions and
parameter bounds. Teachers also need a result they can inspect without relying on a
visual animation alone.

## Decision

- The trusted application verifier owns governing equations, schemas, supported
  parameter bounds, invariants, tolerance policy, finding identifiers, and policy
  versions.
- Models may emit schema-constrained concept specifications and candidate pure physics
  cores that execute only in the isolated runner. Model-emitted renderer material is
  limited to validated, non-executable data or adapters consumed by application-owned
  thin renderers. Generation and repair cannot add, replace, or weaken trusted
  equations, bounds, invariants, tolerances, or acceptance criteria.
- A successful result is labeled as verified against a named policy version and bounded
  parameter space. It is not a claim of universal correctness or pedagogical
  suitability. Reports expose the applicable assumptions, bounds, checks, and
  tolerances.
- Projectile and pendulum are the initial supported domains. Circuits and graphing are
  unsupported until complete application-owned domain packs pass their conformance
  gates.
- Generation and repair stop after at most three attempts. Exhaustion produces a failed
  result rather than a weakened policy or an unverified artifact presented as verified.
- Generated physics cores are pure, deterministic, importable, and independent of the
  DOM and renderer. A renderer consumes verified output and does not reimplement the
  governing equations or state transitions.
- SVG is the default visual renderer. Every visual simulation also provides an
  equivalent textual or data representation.
- The web application uses shadcn/ui with committed component source and CSS-variable
  semantic tokens. Feature code composes shared primitives; lint rejects hand-rolled
  controls and direct primitive-library imports outside `components/ui`.

## Consequences

- Scientific policy changes are trusted application changes that require review,
  versioning, positive controls, and realistic negative controls.
- Model flexibility is deliberately narrower than the verifier's authority. Unsupported
  specifications fail closed instead of extending the trusted domain at runtime.
- Verification reports remain meaningful across repairs because a repair cannot move
  the goalposts.
- Users can audit exactly what passed and can access the simulation's information when
  animation or vision is unavailable.
- Supporting another scientific domain requires a complete, conforming domain pack; a
  prompt or generated plugin cannot make a domain supported.

## Rejected alternatives

- **Model-generated ground truth or verifier policy:** rejected because the same model
  could make an incorrect artifact pass, especially during repair.
- **A universal “verified correct” badge:** rejected because finite tests and numerical
  tolerances do not prove universal correctness or lesson quality.
- **One global epsilon:** rejected because acceptable error depends on the domain,
  quantity, method, and parameter range.
- **Runtime-downloadable scientific plugins:** rejected because third-party executable
  policy would undermine the trusted verifier and isolated-runner threat models.
- **Visual-only or renderer-owned physics:** rejected because it is inaccessible and
  creates a second, unverified implementation of the science.
- **Ad hoc feature controls and visual values:** rejected because they weaken
  accessibility, consistency, and enforceable design-system boundaries.

## Conditions for revisiting

Revisit this decision only when a reviewed threat model and scientific-governance
process can preserve application-owned truth, or when conformance evidence supports a
new domain, renderer, or accessible representation. Any change to verification claims,
attempt limits, policy authority, or UI primitive boundaries requires a new ADR and
must not retroactively broaden the meaning of existing verification reports.
