# Graphing domain-pack requirements (unsupported skeleton)

## Status

Graphing is **not implemented, registered, or supported**. This requirements skeleton
does not define an accepted expression language, numerical policy, tolerance, or
scientific-review record. It must not create a `graphing` discriminator, manifest,
runtime evaluator, seed, or verification claim.

## Scope decision required

“Graphing” is not one scientific model. A future proposal must choose a finite learning
claim, such as application-owned families of real-valued linear and quadratic
functions over bounded real intervals. It must explicitly decide which families,
parameter ranges, features (values, intercepts, extrema, monotonic intervals), and
discontinuities are in scope. Rational, trigonometric, transcendental, piecewise,
implicit, parametric, polar, complex, statistical, and arbitrary user-defined functions
remain excluded unless independently reviewed.

The [NIST Digital Library of Mathematical Functions](https://dlmf.nist.gov/) is a
candidate authoritative reference for definitions and properties of any supported
special functions, not a blanket citation for an undefined graphing domain. Units and
dimensionless quantities must follow the
[BIPM SI Brochure](https://www.bipm.org/en/publications/si-brochure). Every accepted
function family needs a pinned section/equation source and derivation in its review.

## Non-executable concept representation

The future schema must use an application-owned discriminated AST or an enumerated
function family with finite numeric coefficients. It must not accept JavaScript,
TypeScript, Python, formula strings, HTML, LaTeX as executable input, callbacks, URLs,
imports, identifiers resolved from runtime scope, or generated code. Rendering and
verification interpret the same validated declarative structure through separate
application-owned implementations.

The schema must bound coefficient magnitude, domain endpoints, sample count, nesting
if any, and output size. It must reject unknown operators, non-finite values, reversed
or zero-width intervals where inappropriate, ambiguous independent/dependent variables,
and undeclared units.

## Trusted reference and applicability requirements

For each accepted family, the reference must independently provide finite evaluations
and the exact reviewed features. The policy must identify and classify:

- roots and repeated roots;
- extrema, monotonic intervals, and endpoint behavior;
- discontinuities, holes, vertical asymptotes, and values outside the function domain;
- constant or degenerate coefficient cases;
- roots or features exactly on bounded interval endpoints;
- overflow, underflow, cancellation, and ill-conditioned root calculations; and
- visual clipping versus scientific out-of-range behavior.

Sampling a curve is not proof of behavior between samples. If the claim includes roots,
extrema, continuity, or monotonicity, verification must use reviewed analytic or bounded
numerical evidence appropriate to the function family rather than pixel comparison.
Screen coordinates and renderer paths are never trusted truth.

## Calibration and controls still required

No global `x/y` epsilon is approved. The review must calibrate evaluation, root,
feature-location, and near-zero tolerances separately, with absolute/relative rules and
scale behavior. It must analyze correct rounding, catastrophic cancellation, multiple
roots, interval endpoints, and transform error without accepting a visually similar but
scientifically wrong curve.

Required controls include:

- independently derived linear/quadratic vectors if those families are accepted;
- coefficient scaling, translation, reflection, and substitution properties;
- wrong sign, swapped axes, incorrect intercept, missed repeated root, false continuity,
  clipped-as-zero, and sample-only false-positive negative controls;
- constant, zero-leading-coefficient, repeated-root, endpoint-root, extreme-scale,
  non-finite, and unsupported-family boundaries; and
- deterministic feature ordering and output across repeated evaluation.

## Accessible adapter requirements

One normalized state must feed both the application-owned plot scene and a visible
equivalent representation. It must expose the exact function family and parameters,
bounded domain/range, axis units and scale, selected `x` and `y`, intercepts, extrema,
discontinuities, interval/features, and a navigable data table. Color, line style, and
position cannot be the only distinctions. Pan/zoom must have keyboard controls and
must not change scientific values or verification scope.

Data tables use semantic captions and headers as described by
[W3C Technique H51](https://www.w3.org/WAI/WCAG21/Techniques/html/H51). A table of
samples alone is not equivalent when the graph communicates unsampled roots,
discontinuities, extrema, asymptotes, or interval relationships; those require explicit
text/structured feature output.

## Gate to implementation

Implementation remains blocked until separate recorded scientific and
pedagogical/accessibility audits accept a finite function-family scope, safe
declarative schema, independent feature reference, discontinuity/degeneracy semantics,
tolerance-calibration protocol, and equivalent nonvisual model. Each audit must identify
whether it is automated, human, or both without claiming an absent credential. Only
after those decisions may code, fixtures, a manifest, or explicit registration be added
through TDD and the full domain-pack conformance process.
