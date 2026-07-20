# Model orchestration

## Trust boundary

The orchestrator is the only component that can access model-provider credentials. The
browser receives no key or provider client, and the generated-code runner receives no
credential, provider environment, prompt, or Codex session state. Provider adapters
return schema-validated data or stable operational errors; they never decide scientific
truth.

Teacher text first crosses the OpenAI Responses adapter. The adapter requests Structured
Outputs using the shared strict `ConceptSpec` schema and validates the parsed value again
at the application boundary. A refusal, unsupported domain, invalid unit or range,
unknown property, malformed response, or executable-code-shaped field is rejected. No
model response is evaluated or imported to interpret the concept.

Codex then produces candidate files through `@openai/codex-sdk`. The TypeScript SDK is
server-only and wraps the Codex CLI. Each generation run owns one Codex thread so a repair
can resume the same bounded context without mixing runs.

## Codex workspace controls

Every run gets a fresh disposable directory that is not the application repository. A
thread starts or resumes with all of these controls:

- the disposable directory is the absolute working directory;
- sandbox mode is `workspace-write` and approval policy is `never`;
- command network access and web search are disabled;
- no additional writable directories are supplied;
- the child process receives an allowlisted environment rather than inheriting the
  orchestrator environment; and
- the active `AbortSignal` is attached to every turn.

Codex's documented local sandbox uses operating-system enforcement and limits writes to
the active workspace. SimProof also treats the result as untrusted: after every turn it
walks the workspace without following symbolic links and accepts only the declared core,
renderer, manifest, and test-adapter paths. Links, special files, unexpected paths,
oversized files, and path traversal fail the attempt. Generated code still executes only
inside the separate isolated runner; the Codex workspace is a generation boundary, not
an execution boundary.

The adapter records the SDK/CLI model identifier and thread ID, but never raw reasoning.
It replaces rather than extends the child environment so unrelated server secrets cannot
reach Codex commands. Provider API credentials remain confined to the SDK transport.

## Durable state machine

```text
queued -> compiling -> generating -> executing -> verifying -> verified
                                  ^                    |
                                  |                    v
                                  +---- repairing <- rejected

any active state -> cancelled | provider_failed | runner_failed
any budgeted action -> budget_exhausted
rejected at the attempt cap -> rejected
```

`rejected` means trusted scientific verification found a mismatch. It is not an alias for
an outage, invalid provider response, runner denial, cancellation, or exhausted budget.
Only a rejected candidate may enter `repairing`; repair receives stable structured
findings and bounded diagnostics. The trusted policy, reference equations, verification
inputs, negative controls, and prior findings remain immutable.

The generation request requires an idempotency key. Creation and lookup occur in one
database transaction, so concurrent replays select the same durable run. Every state
transition, attempt start/completion, usage increment, Codex thread binding, and terminal
classification is persisted transactionally. A run may use fewer attempts when configured
but can never exceed three total generation/repair attempts.

Candidate persistence also updates the authoritative `SimulationVersion`: each accepted
candidate binds its exact concept and artifact bundle while the version remains
`generating`. The trusted verifier writes an immutable report, findings, policy,
domain-pack, runner, dependency, and observation binding. Only then can the version move
through `verifying` to `verified` or `rejected`. Operational terminals return the version
to `draft` and clear active evidence; a pipeline label alone never grants verified state.

Cancellation uses one signal from the coordinator through the Responses request, Codex
turn, runner, and persistence finalization. A cancellation observed after an external
action still wins before the next action begins. Terminal rows are immutable.

On process startup, the repository does not replay an external side effect whose outcome
may have been lost. It atomically marks every interrupted active run and pending attempt
`invariant_failed` with `orchestration.interrupted`, preserves calls, reservations, and
artifact provenance, and returns its generating version to a clean draft. Reusing the old
idempotency key returns that terminal run; an explicit retry uses a new key. This is the
durable fail-and-requeue policy rather than an unsafe claim of in-process resumption.

## Budgets and provenance

The run budget bounds provider requests, input tokens, output tokens, estimated cost, and
generated bytes. Before dispatch, one durable local reservation atomically claims all five
dimensions. A concept call reserves zero artifact bytes; a code call reserves the
remaining artifact allowance. Successful and failed dispatched calls reconcile the
reservation to actual usage. A proven pre-dispatch failure releases it without inventing
an external-call row. Actual usage that exceeds a declared reservation is still retained
as provenance and immediately produces `budget_exhausted`; it is never dropped or
clamped in the immutable external-call ledger. The run's aggregate `consumed` fields are
clamped to their configured limits so the shared response contract remains valid; exact
overage is recovered from that ledger. Pending reservations survive interruption so an
ambiguous call cannot be silently repeated.

Allowlisted provenance includes run and attempt IDs, provider and model identifiers,
prompt-template versions, provider request IDs, Codex thread ID, redacted aggregate usage,
artifact hashes, runner binding, policy/domain-pack binding, report ID, stable findings,
and terminal error ID. Credentials, authorization headers, raw reasoning, unrestricted
host diagnostics, and prompts when retention is disabled are forbidden.

## Provider test strategy

The authenticated `POST /api/generation` boundary validates the shared request schema and
server prompt limit. Concurrent requests with one idempotency key share one coordinator
promise, and `POST /api/generation/cancel` aborts that key's active signal. Deployments
without an explicitly composed provider/runner runtime return a stable unavailable error;
they never fall back to a client-side key or implicit network provider.

The executable server intentionally does not compose that runtime yet. Plan 003 keeps
Docker authority out of the application process, while Plan 010 owns the separately
trusted, bounded runner control plane and final provider/runner deployment assembly.
Until that control plane passes its security gates, the production entrypoint fails
closed at the generation route even when model credentials are configured. The
orchestration composition seam and its authenticated integration path are complete here;
Plan 010 must replace the unavailable production composition without granting the
orchestrator direct Docker authority.

The deterministic fake provider is the default. Scripted scenarios cover valid output,
malformed concept output, authentication/quota/transient failures, a rejected candidate
that converges after repair, and exhaustion at the attempt cap. OpenAI and Codex adapter
tests replace their transports and make no network calls. The pipeline integration test
uses the fake provider plus runner/verifier test ports and proves transition order,
idempotent replay, cancellation cleanup, budget enforcement, provenance redaction, and
the distinction between operational failure and scientific rejection. Its integration
path uses the real trusted runner/verifier adapters and asserts the final immutable
verification run and authoritative `SimulationVersion` lifecycle, not only pipeline
hashes.

## Official interface basis

The implementation follows the [OpenAI Codex SDK documentation](https://developers.openai.com/codex/sdk/)
for server-side TypeScript
threads, working-directory control, resumption, structured turn output, and cancellation.
It uses the documented Codex `workspace-write` operating-system sandbox and the
[OpenAI Structured Outputs guidance](https://platform.openai.com/docs/guides/structured-outputs)
for the Responses `text.format`/Zod integration. Provider or model upgrades
must replay all fake fixtures and review provenance compatibility before changing the
production default.
