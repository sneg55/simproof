# Educator workflows and lifecycle presentation

## Document status

This document defines the implemented teacher experience and its release acceptance
contract for Plan 008. [`PRODUCT_SPEC.md`](../../PRODUCT_SPEC.md) is authoritative. The accepted
[architecture decisions](../decisions/) govern verification, deployment, storage,
privacy, and licensing.

The initial product has one teacher-administrator, two supported domains (projectile
and pendulum), and no student accounts or records. Generated code never executes in
the browser or orchestrator. Application-owned renderers may consume only validated,
non-executable scene and simulation data.

## Information architecture

The web application uses these teacher-facing areas. The paths are client routing
choices; they do not imply server endpoints.

| Area | Purpose | Primary destination after completion |
|---|---|---|
| Sign in and first run | Bootstrap the sole administrator or establish a session | Library |
| Library | Browse bundled and teacher-owned simulations; search and filter by domain and status | Simulation detail |
| New simulation | Enter a prompt, review provider disclosure, and confirm the recognized domain and parameter bounds | Generation detail |
| Generation detail | Follow the current attempt, cancel, inspect failures, and review repair outcomes | Preview or report |
| Simulation detail | Preview, inspect the report, publish, reverify, compare versions, export, archive, or delete | Library |
| Settings | Review privacy defaults and provider-configuration diagnostics | Previous page |

One persistent page heading identifies the current area. Breadcrumbs or an equivalent
landmark expose the simulation and version context. A status badge is supporting text,
not the sole status indicator, and never uses color as its only distinction.

## Capability boundary

The browser must use schema-validated API responses. It must not infer a durable
lifecycle transition from a button click or keep a browser-only substitute for server
state.

The canonical HTTP inventory exposes the complete browser boundary summarized under
[Browser API boundary](#browser-api-boundary). Internal persistence records, generated
source, credentials, and artifact-store locations are never browser APIs.

## Educator journeys

### First run and sign-in

The first-run page explains that this is a single-teacher instance and asks the
deployer for the administrator bootstrap secret and a new password. Submitting calls
`POST /api/auth/bootstrap`. The bootstrap secret is never retained in browser storage.
After bootstrap, the teacher signs in through `POST /api/auth/login`; subsequent
session checks use `GET /api/session`.

An invalid or already-used bootstrap secret leaves focus on the error summary, links
the field error to its input, and offers sign-in. Session expiry preserves non-secret
navigation context, moves focus to the sign-in heading, and returns to the intended
page after authentication. Password change uses `POST /api/auth/password`, invalidates
sessions, and requires a fresh sign-in.

`GET /api/bootstrap-capability` selects first-run or sign-in without submitting a
secret. It exposes only whether the one-time bootstrap is still available.

### Seed library

After sign-in, the library lists bundled verified projectile and pendulum examples.
The teacher can search, filter by domain, open an example, change parameters within
the stated bounds, use the visual or equivalent data representation, and inspect its
verification report. This path must not require or contact OpenAI or Codex.

An empty search result says “No simulations match these filters” and offers “Clear
filters.” A fresh installation with no bundled examples is an installation error, not
the ordinary empty state. Loading placeholders have accessible names and are replaced
by a single “Library loaded” polite announcement.

Seed metadata, detail, preview, and report routes read the immutable bundled catalog.
They perform no provider request and require no model credential.

### Credential setup and configuration diagnostics

Provider credentials are deployer-owned server environment configuration. The web UI
never accepts, displays, stores, or returns an API key. Settings may show only a
boolean diagnostic such as “Generation is configured” or “Generation is unavailable;
ask the instance operator to configure model providers.”

Before every generation, the UI states that the prompt and minimum generation context
will be sent to configured external OpenAI/Codex services. The teacher explicitly
accepts that disclosure and chooses the prompt-retention preference. Browsing seeds is
still available when providers are not configured.

The authenticated runtime-config route returns the safe diagnostic fields, including
`providerConfigured`. Credential validation and mutation remain deployment-adapter
concerns; a credential form must not be added without a new security decision and
server-only secret-storage design.

### Generation and parameter/unit review

The teacher starts from an existing draft version, enters a prompt, reviews the
external-provider disclosure and retention choice, then submits generation. The
recognized `ConceptSpec` must be shown before the teacher treats the result as ready:

- supported domain and title;
- each parameter's name, canonical unit, default value, and requested minimum and
  maximum;
- requested controls; and
- an explicit warning when the request cannot be represented by projectile or
  pendulum policy.

Projectile units are metres per second and degrees; pendulum units are metres and
degrees. The client displays units from the validated concept specification and does
not convert or invent bounds. Unsupported domains fail closed.

Starting uses `POST /api/generations` with the server contract's version ID, version
revision, idempotency key, attempt cap (never more than three), and budget. Repeating the same
teacher action reuses its idempotency key. The page exposes cancellation while work is
active. A cancellation acknowledgement means “Cancellation requested,” not “Cancelled,”
until durable terminal state confirms it.

Acceptance returns a durable run ID before provider compilation. Status polling and
refresh recovery use that ID. Candidate generation cannot start until the teacher
accepts the exact concept hash with both current run and review revisions.

### Preview

A verified version may be previewed with its validated parameter controls, accessible
SVG, equivalent data table/text, verification scope, and limitations. Preview never
executes generated source and never interprets generated HTML. A rejected or failed
candidate may be inspected as evidence, but it is labeled “Not verified,” has no
active Verified badge, and cannot be published.

Changing only a preview control within the verified bounds does not rewrite the
artifact. Changing artifact content or a verification-relevant binding creates or
selects a new version and requires verification. Preview routes return only strict,
bounded declarative observations, events, renderer data, and verification evidence.

### Verification report and repair

The report names the verdict, artifact hash, concept-spec hash, policy and domain-pack
identity/version, runner version, checks, tested parameter ranges, sample counts,
units and tolerances represented by the policy/findings, assumptions, limitations,
and stable findings. “Verified” is always qualified as passing that named policy over
the recorded bounded scope; it is not a universal correctness or pedagogy claim.

Scientific rejection uses “Verification found scientific problems” and shows stable,
plain-language findings. Provider, runner, budget, cancellation, malformed-output,
and invariant failures use separate operational copy. A repair is an orchestrator
attempt against the immutable prior artifact/findings and trusted policy; the teacher
does not edit policy or tolerances. Attempt history shows generation versus repair and
stops after three total attempts.

Report, finding, and attempt history are server projections. Repair is pipeline-owned
and automatic; there is no separate teacher-triggered repair route.

### Publish

“Publish” is enabled only for a version with current passing evidence bound to its
exact artifact and governing dependencies. The confirmation names the version and
scope, then the server atomically records publication. Success reads “Version N is
published” and moves focus to the simulation heading. A concurrent change returns a
conflict, refreshes server state, and explains why publication is no longer available.

Rejected, stale, operationally failed, cancelled, draft, and active versions cannot
be published. Publication binds the report's exact verification-run ID and version
revision.

### Version comparison

History lists immutable versions and generation/verification records in order. The
teacher selects two versions and compares lifecycle status, artifact hash, concept
parameters and units, policy/domain-pack/runner bindings, verdict, findings,
assumptions, limitations, publication, and recorded export-license metadata. Changed
values use text and table semantics in addition to visual highlighting.

Comparison is read-only. It never treats a newer version as verified because an older
version passed. The server returns bounded left/right values for every comparison
category from exact version evidence; the client does not reconstruct those values.

### Blank versions, duplication, and lineage

“Start blank next version” creates an evidence-free draft in the same simulation.
“Duplicate selected version” creates a separate draft and transactionally clones the
selected version's editable concept specification and candidate artifact records. The
destination records may reuse immutable content-addressed object bytes, but receive new
record ownership and explicit source-version/source-revision lineage.

Duplication never copies a verification run, report, verdict, finding, publication, or
public trust state. The destination is visibly Draft and Unverified even when its source
was verified or published, and must pass verification independently. Internal ownership
metadata for the cloned candidate is marked cancelled/non-verifying and cannot be
interpreted as verification evidence.

### Export

An export review names its contents, selected content-license metadata, provenance,
and the limitation that license metadata is not a legal warranty. Credentials,
sessions, and authentication records are excluded. The teacher confirms with the
current administrator password and receives success or a specific recoverable error.

Selected-simulation export uses its aggregate route and requires password confirmation.
The existing privacy export remains the explicitly labeled all-data operation.

### Archive

Archiving removes a retained version from active use without deleting its evidence.
The confirmation names the simulation, success returns to the library with
`Archived <title>`, and an Archived filter exposes it. Restoring from archive is offered only if
the server defines a valid transition and current evidence remains truthful.

Archive is implemented with revision CAS. There is no unarchive contract;
restore-from-archive remains intentionally absent rather than inferred.

### Delete

Deletion is a final, password-confirmed privacy operation, distinct from archive. The
dialog names the simulation, says that metadata and unshared artifact content will be
removed, requires the literal confirmation represented by the request schema, and
requires the administrator password. Focus starts on the dialog heading or safe
cancel action, never the destructive button. On success, focus moves to the library
heading and a polite message confirms deletion.

`DELETE /api/privacy/simulation` implements the deletion operation. Deletion is not a
persisted lifecycle state, and deleted content cannot be recovered through the product
UI. A request conflict or password failure keeps the dialog open, preserves
non-secret input, and focuses the error summary. The UI clears password fields after
every response.

### Failure and recovery

Every failure view shows what happened, what remains safe, and the next valid action.
Retries create or resume server-authorized work and never rewrite immutable evidence.
After refresh or reconnect, the client must fetch the current version, run, attempt,
and evidence state before enabling actions. It must not reconstruct progression from
cached announcements or elapsed client state.

| Outcome | Recovery offered |
|---|---|
| Provider authentication or configuration failure | Keep the draft; direct the operator to server-side configuration; retry only after the diagnostic changes |
| Provider quota or transient failure | Keep the draft and attempt evidence; retry with a new server-authorized run |
| Runner failure | Keep the draft and stable error ID; allow retry after the isolation service is healthy |
| Scientific rejection | Show findings; allow the bounded orchestrator repair path or a new teacher draft, never policy editing |
| Budget exhaustion or attempt cap | Show consumed limits and retained findings; require a new run decision rather than silent continuation |
| Cancellation | Confirm the durable cancelled outcome and offer return to the draft/version |
| Invariant or malformed-output failure | Fail closed, show a stable support identifier, and do not offer publish |
| Session expiry | Sign in again, then refetch server state before restoring the intended route |
| Network interruption | Preserve non-secret draft text locally only with explicit teacher awareness; refetch before retrying an idempotent mutation |

## Lifecycle and operational state matrix

### Durable simulation-version states

| Contract state | Visible copy and allowed actions | Announcement | Focus policy | Recovery or next transition |
|---|---|---|---|---|
| Loading (view state) | “Loading simulation…”; controls disabled, cancel navigation remains available | One polite message when loading begins and one when the result replaces it | Keep current focus; never focus a skeleton | Resolve to server state or an actionable load error |
| Empty (view state) | “No simulations yet” or filter-specific empty copy; browse bundled examples, clear filters, or create draft | Polite when caused by a teacher action | Focus stays on triggering control; heading is discoverable | Clear filters, open seed, or create draft |
| `draft` | “Draft — generation has not started”; edit prompt, review privacy, start generation, delete | Polite after draft creation | Focus the draft heading after navigation | Start generation or delete |
| `generating` | “Generation in progress”; show current detailed operational state and cancel | Polite changes, with repeated progress coalesced | Do not move focus; keep Cancel reachable | Advance, cancel, or terminate with an explicit outcome |
| `verifying` | “Checking against trusted policy”; inspect scope summary and cancel when supported | Polite on entry | Do not move focus | Verified, rejected, cancellation, budget, or invariant outcome |
| `rejected` | “Not verified — scientific checks failed”; inspect report/findings, bounded repair when available, create new draft, delete | Assertive once when terminal | Focus the outcome heading only after teacher-initiated navigation; otherwise preserve focus | Repair/new run, new version, or delete |
| `verified` | “Verified for the recorded scope”; preview, inspect report, publish, export, duplicate editable content, archive | Polite once | Preserve focus; after direct navigation focus heading | Publish, become stale on relevant change, archive, start a blank version, or duplicate into an unverified draft |
| `stale` | “Verification is out of date”; no active badge or publish; inspect reason, reverify, export with stale label | Assertive when invalidation affects the current page | Focus stays on the changed control; stale summary receives programmatic description | Reverify under current bindings or create version |
| `published` | “Published and verified for the recorded scope”; preview, report, version, export, archive | Polite after publish | Focus simulation heading after publish confirmation | Become stale on relevant change or archive |
| `archived` | “Archived — removed from active use”; inspect, export, delete, restore only if server supports it | Polite after archive | Focus library heading after leaving detail | Server-defined restore, export, or delete |
| Deleted (operation result) | “Simulation deleted”; no detail actions | Polite after confirmed deletion | Focus library heading, then make confirmation discoverable | None; deletion is final, not a lifecycle state |

### Generation operational states and outcomes

Detailed generation state is server-owned. UI labels use spaces even where schema
values use underscores.

| API state | Durable mapping | Visible copy and actions | `aria-live` | Focus and recovery |
|---|---|---|---|---|
| `queued` | `generating` | “Queued for generation”; Cancel | Polite | Preserve focus; wait or cancel |
| `compiling` | `generating` | “Reviewing your request”; Cancel | Polite | Preserve focus; wait or cancel |
| `generating` | `generating` | “Generating simulation core”; attempt number, Cancel | Polite, coalesced | Preserve focus; wait or cancel |
| `executing` | `generating` | “Running candidate in the isolated runner”; Cancel | Polite | Preserve focus; wait or cancel |
| `verifying` | `verifying` | “Checking candidate against trusted policy”; Cancel when still accepted | Polite | Preserve focus; await verdict |
| `repairing` | `generating` | “Repairing generated artifact”; immutable policy note, attempt number, Cancel | Polite | Preserve focus; await execution or outcome |
| `verified` | `verified` | “Verification passed for the recorded scope”; Preview, Report, Publish | Polite once | Preserve focus unless the teacher followed a completion link |
| `rejected` (generation state and run status) | `rejected` | “Verification found scientific problems”; Findings, New draft | Assertive once | Make outcome heading programmatically focusable; do not steal focus during unrelated work |
| `provider_failed` | Version returns to `draft`; run is `operational-failure` and retains provider-failure classification | “Model provider failed”; stable category, Retry when valid, Configuration help | Assertive once | Preserve focus; error summary is next in reading order |
| `runner_failed` | Version returns to `draft`; run is `operational-failure` and retains runner-failure classification | “Isolated runner failed”; stable error ID, Retry when healthy | Assertive once | Preserve focus; no preview/publish |
| `cancelled` (generation state and run status) | Version returns to `draft`; run and pipeline retain cancellation | “Generation cancelled”; Return to version, Start new run | Polite once | If cancellation was requested here, focus outcome heading after confirmation |
| `budget_exhausted` / run `budget-exhausted` | Version returns to `draft`; run retains budget exhaustion | “Generation budget reached”; consumed limits, Start new run | Assertive once | Preserve focus; never continue silently |
| `invariant_failed` | Version returns to `draft`; run is `operational-failure` and retains invariant-failure classification | “Generation stopped safely”; stable support ID, Return | Assertive once | Preserve focus; fail closed |
| `invalid-output` (attempt outcome) | Version returns to `draft`; run is `operational-failure` | “Generated output was invalid”; stable error ID, retry only if run policy allows | Assertive once | Preserve focus; no execution in browser |
| `pending` / `running` (attempt outcomes) | current `generating` or `verifying` lifecycle | Attempt status plus kind and number | Polite only on meaningful change | Preserve focus |
| `running` (run status) | Current `generating` or `verifying` lifecycle | Use the more specific pipeline state above | Polite only on meaningful change | Preserve focus and refetch detailed state |
| `operational-failure` (run status) | terminal non-scientific outcome | Specific provider, runner, or invalid-output copy; never “rejected” | Assertive once | Recovery depends on recorded stable error |
| `succeeded` (run status) | `verified` | Passing scope summary and next actions | Polite once | Preserve focus |

The generation contract also distinguishes provider authentication, quota, transient,
and malformed-response categories. Those categories refine `provider_failed`; they do
not create scientific findings.

## Status, focus, and action rules

- Use one dedicated polite status region for progress and confirmations and one
  assertive alert region for terminal failures that require immediate awareness.
- Announce state changes, not timers, animation frames, percentage guesses, or every
  streamed token. Updating visible text and the live region must describe the same
  server-confirmed state.
- Do not move focus on background polling, progress, repair transitions, or report
  refresh. Move focus after navigation, an opened dialog, a submitted form with
  errors, or a teacher-triggered destructive completion.
- On validation failure, focus an error summary whose links target each invalid field.
  Preserve all non-secret input and clear passwords and bootstrap secrets.
- Disable actions only when their reason is also visible. Prefer removing impossible
  actions only when the surrounding context still explains the lifecycle.
- “Verified” and “Published” always include text; stale and failure indicators include
  an icon or shape plus text and never rely on red/green alone.
- Any response conflict causes a refetch before the action can be submitted again.

## Browser API boundary

The Plan 008 STOP-condition audit is resolved by strict shared schemas and canonical
orchestrator routes for bootstrap capability, safe runtime diagnostics, bundled seeds,
teacher simulations, version history and comparison, durable generation status,
concept review, cancellation, constrained preview data, verification reports,
publication, re-verification, new versions, duplication, archive, selected-simulation
export, and confirmed deletion.

Generation acceptance returns a durable handle before provider work. The browser reads
subsequent states and exact attempt evidence by run ID, and concept acceptance binds the
run revision, review revision, and concept hash. Preview and report responses contain
validated data only; they never expose generated source, provider credentials, request
IDs, coding-thread IDs, SQLite records, or artifact-store paths.

Archive is intentionally one-way in this product contract. An archived version remains
available for inspection, duplication, and export; no client invents an unarchive action
without a server contract. Permanent deletion remains a separate password-confirmed
privacy operation.
