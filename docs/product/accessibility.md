# Educator experience accessibility contract

## Status and acceptance target

SimProof targets WCAG 2.2 Level AA for every teacher workflow. Accessibility is a
correctness property: a feature, domain, renderer, or lifecycle state is incomplete
until its keyboard, programmatic, nonvisual, contrast, reflow, and reduced-motion
behavior passes this contract.

This document supplements the [educator workflow contract](educator-workflows.md),
[`PRODUCT_SPEC.md`](../../PRODUCT_SPEC.md), and
[ADR 0001](../decisions/0001-trusted-verification.md). Where an automated tool and a
manual inspection disagree, the user-observable failure remains a defect; an empty
automated report is not conformance evidence by itself.

## Semantic structure and names

- Each route has one descriptive `h1`, a unique document title, and landmark regions
  for header, navigation, main content, and supporting content when present.
- Native elements and reviewed shadcn/ui primitives provide names, roles, values,
  descriptions, validation, and disabled state. Feature code does not recreate
  buttons, inputs, dialogs, tables, labels, progress indicators, or separators.
- Headings reflect the information hierarchy without skipping levels for visual size.
  Tables use captions and header associations. Lists of versions, findings, and checks
  retain list or table semantics.
- Link text and control names identify their destination or action in context. Repeated
  simulation actions include the simulation or version in their accessible name.
- Required fields, units, bounds, help, errors, and disclosure text are programmatically
  associated with their controls. Placeholder text is never the only label.
- Icons are hidden when redundant and named when they communicate information.
  Verification, stale, and failure state is always present as text.

## Keyboard operation and focus

Every workflow is completable with a keyboard alone, without path-dependent timing or
pointer gestures. Tab order follows reading order. There are no positive `tabindex`
values, keyboard traps, or focusable inactive controls.

- All actions use native keyboard activation. Custom SVG marks are not controls unless
  they implement the complete expected keyboard and name/role/value behavior; domain
  controls should normally remain HTML primitives outside the SVG.
- Skip navigation moves to the main heading. Repeated library cards expose a
  predictable order without forcing navigation through decorative content.
- Focus is visibly distinguishable in light, dark, high-contrast, zoomed, and
  reduced-motion presentations. Sticky regions and dialogs do not obscure it.
- Opening a modal dialog moves focus inside it, labels and describes it, contains focus
  while open, closes with Escape unless doing so would discard an irreversible action,
  and returns focus to the invoking control or a logical successor.
- Route navigation focuses the new page heading. Background loading, polling,
  generation progress, and animation never move focus.
- Form submission with errors focuses a linked error summary. Activating a summary
  link focuses the invalid control. Corrected errors are removed programmatically.
- When the focused item is removed, focus moves to the closest logical surviving item;
  after archive or deletion it moves to the library heading, not the browser body.
- Drag, hover, or motion-based interaction has a single-pointer and keyboard
  alternative. Parameter controls expose exact values and step behavior.

## Lifecycle, status, and errors

Visible lifecycle text and programmatic status use the same server-confirmed state.
The state-specific announcement and focus behavior is defined in the
[lifecycle matrix](educator-workflows.md#lifecycle-and-operational-state-matrix).

- One `aria-live="polite"` region handles meaningful progress changes and success
  confirmations. One `role="alert"` region handles terminal failure or invalidation
  requiring immediate awareness.
- Loading state uses a named status; indeterminate progress is not announced as a
  percentage. Repeated polling and animation frames are not announced.
- Provider failure, runner failure, cancellation, budget exhaustion, invariant failure,
  and scientific rejection remain distinct in visible and accessible text.
- Error messages state the problem and a valid next action, retain stable support IDs
  when supplied, and never expose secrets, raw provider payloads, generated source, or
  unbounded diagnostics.
- Disabled actions include a visible, programmatically associated reason. Publishing
  a stale or non-verified version is unavailable by server policy, not merely by a
  disabled client button.
- Status indicators combine text with an icon, pattern, or shape. Color never carries
  verdict, comparison difference, required-field, focus, or error meaning alone.

## Reflow, text, contrast, and target size

- Core workflows support browser text resizing to 200 percent and page zoom/reflow at
  400 percent without loss of content or functionality and without two-dimensional
  scrolling at a 320 CSS-pixel viewport, except for intrinsically two-dimensional data
  such as a wide comparison table.
- Intrinsically wide tables use a labeled scroll region and also provide a stacked or
  summary representation for the essential comparison. Page-level controls and
  status never require horizontal scrolling.
- Text spacing overrides do not clip, overlap, hide controls, or detach labels from
  values. Content is not baked into images.
- Normal text has at least 4.5:1 contrast and large text at least 3:1. User-interface
  components, meaningful graphics, and focus indicators have at least 3:1 contrast
  against adjacent colors in each supported theme.
- Focus remains clearly visible, satisfies applicable non-text contrast, and is not
  fully obscured when components overlap or scroll.
- Pointer targets meet the WCAG 2.2 AA target-size requirement or a documented
  spacing/equivalent-control exception. Frequently used simulation controls should use
  comfortably larger design-system sizing.
- Layout does not lock orientation. Content works in portrait and landscape except
  where a specific simulation orientation is essential and an equivalent nonvisual
  representation remains available.

## Motion, timing, and sensory characteristics

- The application honors `prefers-reduced-motion: reduce`. Essential state changes
  become immediate or use a restrained opacity change; decorative parallax, spring,
  path, auto-scroll, and continuous simulation motion are disabled.
- Animation has Pause/Resume and Reset controls. Pausing preserves exact state values
  and keeps the equivalent representation usable.
- No task depends on observing movement, color, position, shape, sound, or timing.
  Instructions name controls and values rather than “the red object on the right.”
- Flashing content is prohibited. Auto-updating status is coalesced and can be paused
  when it would otherwise interfere with reading.
- Time limits are not used for teacher work. Session expiry is communicated when the
  server requires reauthentication and preserves non-secret navigation context.

## Accessible simulation renderer contract

Every supported domain must render the same validated normalized state through both
an application-owned SVG view and an equivalent table/text view. Neither view owns or
reimplements physics. Generated material crossing into the browser is constrained,
schema-validated, non-executable data; arbitrary HTML, script, event attributes, URLs,
CSS, or SVG markup are rejected.

### Shared requirements

For any parameter selection or simulation step, both representations expose:

- the simulation title, supported domain, current lifecycle/verification status, and
  whether the evidence is current;
- every adjustable parameter's name, exact value, canonical unit, allowed minimum and
  maximum, and step or input constraint;
- the current independent variable or sample index and all meaningful observed
  quantities with exact values and units;
- meaningful events or state changes represented visually, such as launch, apex,
  impact, left/right turning point, or equilibrium crossing;
- the applicable verification scope, assumptions, limitations, and a link to the full
  report; and
- validation or out-of-range messages before a value is sent to the server/renderer.

Changing a control updates the SVG and equivalent representation from one validated
state object. A test must compare the values exposed by both outputs. Hidden tables,
off-screen prose that cannot be reached, an image-only description, or a generated
`aria-label` that omits current data does not satisfy equivalence.

### SVG view

- The SVG has a concise accessible name and a description of its purpose and current
  meaningful state. Decorative grid lines, trails, axes ticks, and shapes are hidden
  from the accessibility tree unless they convey information absent elsewhere.
- Axes and reference markers have visible labels and units. Lines, points, and
  trajectories use non-color cues such as dash, marker, label, or shape.
- The SVG scales without clipping labels or focus indicators. Meaningful graphics meet
  non-text contrast in all themes.
- HTML controls outside the SVG provide Play/Pause, Reset, step backward/forward when
  discrete inspection is supported, and parameter adjustment. Focus does not chase the
  animated object.
- The SVG does not expose each animation frame through a live region. Teacher-driven
  steps update a concise status; continuous playback updates the equivalent table at a
  readable, bounded cadence without announcements.

### Equivalent table and text

- A visible “Data and description” view is adjacent to or tab-associated with the SVG
  and reachable with a standard control. It is not an accessibility-only mode.
- A concise text description explains the current physical state and named events.
  Data tables have captions, row/column headers, units in header text, and exact values.
- Large sample sets are paginated or virtualized without losing table semantics,
  keyboard access, current-row context, downloadable data, or total sample information.
- Verification context clearly distinguishes observed values from trusted expected
  ranges/tolerances and does not overstate the verdict.

### Domain minimums

Projectile views expose initial speed, launch angle, time, horizontal position,
vertical position, horizontal/vertical velocity when available, ground reference,
apex, and impact. Pendulum views expose length, amplitude, time, angular displacement,
turning points, equilibrium crossings, and period evidence when available. Units and
bounds come from the concept/policy contracts, never renderer constants.

## Destructive and sensitive flows

- Cancel generation, archive, delete, privacy-setting changes, password changes, and
  export are explicit named actions. Archive is never labeled Delete; cancellation is
  never announced complete before the server records the terminal outcome.
- Destructive confirmations name the simulation/version and consequences. The default
  focused action is Cancel or another safe action. Destructive buttons use text and do
  not depend on red styling.
- Permanent deletion requires the server contract's literal confirmation and current
  administrator password. Password and bootstrap fields disable spelling assistance
  where appropriate, are never echoed into summaries or live regions, and are cleared
  after submission.
- Export confirms scope. Until a per-simulation endpoint exists, the implemented
  privacy export is labeled “Export all SimProof data.” Export copy states that
  credentials and sessions are excluded and license metadata is not a legal warranty.
- A mutation conflict leaves the dialog/form open, focuses the error summary, refetches
  current state, and requires renewed confirmation. The client never reports success
  optimistically for publish, archive, export, or delete.

## Automated acceptance gates

The authoritative repository gates include the web build, component suite, browser
journeys, and accessibility scans added by Plan 008. At minimum, automated coverage
must prove:

- typed component tests for every lifecycle/operational state, accessible name, action
  guard, error association, and live-region message;
- browser journeys for first run/sign-in, credential-free seeds, successful generation,
  rejection, each operational failure class, cancellation, attempt exhaustion,
  preview/report, publish/stale guards, comparison, export, archive, and deletion;
- keyboard-only completion of each journey, including dialogs, simulation controls,
  report navigation, table scrolling, and recovery;
- automated WCAG scans of every page template, dialog, theme, renderer, lifecycle
  outcome, 320 CSS-pixel reflow view, and reduced-motion mode with no serious or
  critical violations;
- assertions for focus destination, focus visibility, live announcements, heading and
  landmark structure, non-color status text, contrast tokens, text resizing, and
  pointer target sizing;
- renderer conformance comparing SVG-visible normalized values with the table/text
  representation for projectile and pendulum fixtures;
- security tests proving renderer input cannot inject HTML, scripts, event handlers,
  executable SVG, external URLs, CSS, or generated code; and
- production-build and no-credential seed smoke tests with provider requests blocked.

Automated checks use deterministic fake providers and fixtures. They do not require
live credentials or network access.

## Manual acceptance gates

Before release, a reviewer records evidence for:

1. Complete keyboard-only use of every core journey at default zoom, 200 percent text,
   400 percent zoom/reflow, and both supported themes.
2. Screen-reader use of sign-in, generation progress/outcomes, the verification report,
   projectile and pendulum controls, equivalent data, dialogs, and recovery messages
   in at least one browser/screen-reader combination documented by the project.
3. Visible focus, reading order, error-summary links, dialog focus return, and focus
   recovery after archive/delete or removed list items.
4. High-contrast or forced-colors behavior, non-color verdict/difference cues, contrast,
   target spacing, orientation, and text-spacing overrides.
5. Reduced-motion playback, pause/reset/step behavior, and confirmation that no state or
   instruction depends on animation or sensory characteristics.
6. Comparison of SVG and data/text outputs for representative defaults, bounds, named
   events, stale evidence, and report limitations in both supported domains.

The review records browser, assistive technology, route/state, result, and defect link.
Waivers cannot redefine a required core workflow as inaccessible; a failing core
journey blocks release.

## Implemented adapter boundary and release evidence

The server-owned lifecycle and browser-safe seed, preview, report, and library contracts
described in the [workflow document](educator-workflows.md#browser-api-boundary) are the
only sources of educator state. The web client must not fabricate live generation
status, badge validity, preview observations, report scope, or version history. Generated
source is never a renderer input in the host page.

The release gate records automated accessibility results and browser smoke evidence for
the supported flows. That tooling choice cannot narrow WCAG 2.2 AA acceptance. Provider
secret setup remains an operator workflow; the browser exposes only safe configuration
diagnostics and the disclosure required before a teacher submits a generation prompt.
