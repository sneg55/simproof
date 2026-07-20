# Circuits domain-pack requirements (unsupported skeleton)

## Status

Circuits is **not implemented, registered, or supported**. This document records the
evidence a future pack must supply; it is not a manifest, policy, tolerance, scientific
sign-off, or promise of support. No concept discriminator, runtime code, fixture, seed,
or UI may label circuits verified until the complete pack passes review and conformance.

## Candidate bounded claim

The smallest reviewable initial scope is connected series/parallel networks of ideal,
positive, finite resistors driven by one ideal independent DC voltage source. A proposal
must decide and document whether that exact scope is pedagogically sufficient before
implementation. Bridge or other irreducible multi-loop networks, multiple or current
sources, capacitors, inductors, transients, AC/phasors, semiconductor devices, dependent
or nonlinear sources, thermal effects, tolerances of physical components, and
student-built arbitrary circuits remain excluded unless separately modeled and reviewed.

[OpenStax *University Physics Volume 2*, §10.2](https://openstax.org/books/university-physics-volume-2/pages/10-2-resistors-in-series-and-parallel)
defines series/parallel equivalent resistance, voltage division, current division, and
Ohm's law for this candidate scope. [Section 10.3](https://openstax.org/books/university-physics-volume-2/pages/10-3-kirchhoffs-rules)
states the junction rule (current conservation) and loop rule (zero algebraic potential
change around a closed loop), which remain residual checks even when the supported
topology can be reduced. The future record must pin authors Samuel J. Ling, William
Moebs, and Jeff Sanny, the OpenStax 2016 edition, relevant equations/sections, and any
additional primary reference before review; these candidate citations are not sign-off.
Units must follow the
[BIPM SI Brochure](https://www.bipm.org/en/publications/si-brochure).

## Required concept and units

The schema must be declarative and bounded: stable node IDs; a designated reference
node; explicitly oriented two-terminal components; finite values; and hard limits on
nodes, branches, values, and output samples. Candidate canonical quantities are volts
(`V`), amperes (`A`), and ohms (`ohm` or the project's reviewed canonical symbol).
The review must resolve source polarity/current orientation and sign conventions.

The boundary must reject unknown component types, duplicate IDs, self-loops where not
meaningful, undeclared nodes, non-finite values, non-positive resistance, ambiguous
ground, uncontrolled topology size, and any executable expression or callback.

## Required trusted behavior

A future reference should independently reduce the reviewed series/parallel topology,
then compute equivalent resistance plus branch/node voltage and current. Kirchhoff/Ohm
residuals provide independent properties rather than a second copy of the candidate.
It must classify, rather than conceal:

- uniquely solvable networks;
- disconnected or floating subcircuits;
- singular or ill-conditioned systems;
- topology outside the accepted reducible series/parallel grammar;
- open circuits and prohibited zero-resistance shorts; and
- values outside the numerically calibrated range.

The implementation proposal must justify the reduction algorithm, deterministic
ordering, maximum topology size/depth, finite-output behavior, and residual computation.
No arbitrary netlist language, SPICE model, generated solver, runtime plugin, or dynamic
expression evaluator is allowed.

## Policy and calibration evidence still required

No tolerance is approved. Before implementation, calibration must allocate error for
matrix conditioning, reference solver error, candidate precision, residual calculation,
and unit/display conversion. It must define separate quantity-specific absolute and/or
relative tolerances for node voltage, branch current, Kirchhoff residuals, and Ohm-law
residuals, including behavior near zero. A single epsilon or tolerance chosen from one
candidate implementation is unacceptable.

Required properties and controls include:

- independently calculated series, parallel, and nested series/parallel positive vectors;
- node-current conservation and loop-voltage residuals;
- resistance/voltage scaling and orientation/sign properties;
- swapped polarity, omitted branch, series-as-parallel, wrong-unit, and sign-error
  negative controls;
- singular, disconnected, irreducible topology, minimum/maximum value, and topology-size
  boundary controls; and
- deterministic results across component declaration order when identity is preserved.

## Accessible adapter requirements

One normalized circuit state must produce both a non-executable application-owned
diagram scene and a visible equivalent representation. The latter must list every node,
component, endpoints, polarity/orientation, value/unit, node voltage, branch current,
and unsatisfied or singular condition. It must expose topology relationships that a
pure value table would omit, support keyboard selection of the same components as the
diagram, and never use wire color or arrow direction alone to convey meaning.

## Gate to implementation

Implementation remains blocked until a recorded scientific audit accepts the bounded
claim, source set, topology/singularity semantics, solver-independence plan, and
tolerance-calibration protocol; a separate pedagogical/accessibility audit accepts the
learning scope and topology representation; and the maintainer accepts schema limits
and the non-executable boundary. Each audit must identify whether it is automated,
human, or both without claiming an absent credential. Only then may a TDD
implementation add code, fixtures, a manifest, or an explicit registry entry.
