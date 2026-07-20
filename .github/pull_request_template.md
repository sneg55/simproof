## Summary

<!-- What problem does this solve? State the scope and what intentionally remains unchanged. -->

## Verification

<!-- List exact commands and results. Do not paste secrets, raw logs, prompts, provider responses, generated content, or vulnerability details. -->

- [ ] Focused tests for the changed behavior pass.
- [ ] `pnpm check` passes, or the exact blocking gate is explained.
- [ ] Separate browser gates (`pnpm test:e2e` and `pnpm test:a11y`) pass when web behavior changes.
- [ ] Deployment/recovery gates pass when configuration, images, persistence, launcher, runner, or operations change.

## Trust and compatibility impact

<!-- For each row, describe the impact or write “none” with a reason. -->

### Scientific policy and domain packs

- [ ] Equations, constants, applicability, samples, tolerances, numerical methods, finding meaning, and check order are unchanged; or policy/pack versions, quantitative calibration, controls, stale-report analysis, fingerprints, and exact-content review bindings are updated.
- [ ] Citation, unit, singularity, accessible representation, and renderer capability evidence remains complete.
- [ ] Generated metadata was reviewed against its source inputs and is not presented as approval by itself.

### Schemas, persistence, and artifacts

- [ ] Boundary-schema/protocol compatibility and unknown/oversized input behavior are covered.
- [ ] Applied migrations remain unchanged; any schema change uses a new numbered migration with fresh-install and supported-upgrade evidence.
- [ ] Artifact hashing/normalization, backup format, export, deletion, and rollback compatibility are unchanged or explicitly versioned and tested.

### Generated-code security

- [ ] Generated code still executes only through the isolated runner with no host fallback.
- [ ] Import policy, image identity, launcher authority, network, secrets, mounts, privileges, limits, output bounds, cancellation, and cleanup are unchanged or covered by adversarial tests.
- [ ] No application or generated container gains the Docker socket.

### Privacy, authentication, and diagnostics

- [ ] The privacy inventory and redaction fixtures are updated for every persisted or externally transmitted field change.
- [ ] Credentials, sessions, CSRF values, prompts, generated content, provider responses, raw causes, and stack traces cannot enter logs, browser config, exports, or diagnostics.
- [ ] External telemetry/diagnostic transmission remains disabled by default.

### Accessibility and UI

- [ ] Shared shadcn/ui primitives and semantic tokens are used.
- [ ] Keyboard operation, visible focus, status announcements, contrast/reflow, reduced motion, and equivalent visible data/text are preserved.
- [ ] Relevant unit, browser, and WCAG 2.2 AA gates pass.

### Licensing and release operations

- [ ] New dependencies, assets, examples, provider terms, and third-party material have license/attribution review.
- [ ] Code/documentation, bundled CC BY 4.0 content, and user-generated artifact metadata remain distinguishable.
- [ ] `CHANGELOG.md`, operator guidance, compatibility notes, and supported-version information are updated when behavior changes.
- [ ] This change does not publish a package, image, repository, advisory, or release without explicit operator authorization.

## Reviewer notes

<!-- Call out the highest-risk files, unresolved choices, migrations, generated files, or manual evidence. Security-sensitive details belong only in the private advisory. -->
