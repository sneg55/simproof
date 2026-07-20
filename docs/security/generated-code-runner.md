# Generated-code runner security design

## Purpose

The runner is the only SimProof component permitted to execute generated source. It
accepts one versioned, schema-validated request, executes one candidate pure
`SimulationCore` within an OS-isolated boundary, and returns one bounded,
schema-validated response. It has no authority over scientific correctness; the
trusted verifier evaluates normalized observations after the runner succeeds.

This design is subordinate to the [runner threat model](threat-model.md),
[`PRODUCT_SPEC.md`](../../PRODUCT_SPEC.md), and accepted ADRs. Node permissions are
defense in depth. A Node process, `vm` context, or worker is never the primary
security boundary.

## Implementation status

Checkpoint 003 implements the strict protocol, installed-policy binding, host-side
isolation service, scratch-based runner image, fixed entrypoint, bounded admission,
cleanup, and actual-container adversarial tests. The Docker CLI launcher is host/test
isolation machinery only. It must not be imported into a containerized orchestrator or
used to justify mounting a Docker socket into an application container.

The supported Compose deployment adds a separately trusted `runner-launcher` control
plane as the sole Docker-daemon client. The orchestrator receives only its
authenticated, strict runner-protocol endpoint. The launcher requires an immutable
allowlisted runner image, clamps request limits and concurrency, constructs the fixed
isolation profile, and owns cancellation and cleanup. Neither the orchestrator nor a
generated request container receives Docker authority or a runtime socket. See the
[deployment runbook](../operations/deployment.md).

## Component and data flow

```text
orchestrator (trusted, secret-bearing)
    |
    | strict runner request: protocol, artifact bytes/hash,
    | policy/domain references, deterministic inputs, hard limits
    v
isolation launcher / runner wrapper (trusted, no provider secrets)
    |
    | fixed entrypoint + minimal environment + framed input
    v
generated process (hostile, unprivileged, bounded workspace)
    |
    | capped framed samples and diagnostics
    v
runner wrapper -> strict runner response -> orchestrator -> trusted verifier
```

Candidate source never loads in the orchestrator, web app, verifier, launcher, or
host Node process. The runner wrapper treats successful process exit and returned
values as untrusted until response validation and artifact-hash comparison complete.

The supported Compose web edge joins a non-internal network for portable host-loopback
publication and therefore has generic egress capability. It receives no provider
configuration or credentials and proxies only to the fixed orchestrator upstream;
provider exclusivity is enforced by application configuration and credential
authority, not by claiming exclusive network reachability. The generated runner
boundary remains `network=none`.

## Launch profile

The supported launcher must fail closed unless all of these properties are active:

- a separately isolated container or equivalent reviewed OS boundary for generated
  execution;
- a pinned minimal image and fixed, numeric, non-root runtime user;
- read-only root filesystem plus a fresh private size-bounded temporary workspace;
- no privileged mode, host PID/IPC/user namespace sharing, added capabilities,
  devices, repository, host paths, application persistence, or Docker socket;
- all Linux capabilities dropped and a restrictive no-new-privileges/seccomp/AppArmor
  profile where the platform supports them;
- network disabled for the generated-code boundary, with no proxy variables or
  inherited resolver/service credentials;
- hard CPU, memory/address-space, PID, file-size, open-file, temporary-storage,
  wall-clock, and output limits enforced outside generated code;
- a constructed allowlist environment containing only non-secret runner configuration.

Production wiring must use a dedicated bounded protocol transport without making the
repository, persistent volumes, container-runtime control socket, or application
secrets visible to the runner. A transport that requires weakening any launch
property is invalid. The runner must not fall back to local Node execution when the
container runtime or isolation controls are unavailable.

## Request handling

The wrapper performs these operations in order:

1. Read a byte-capped frame and reject unsupported protocol versions, malformed data,
   unknown fields, oversized source, excessive inputs, or invalid limits.
2. Recompute the artifact hash from the exact accepted bytes and compare it with the
   request before creating an execution workspace.
3. Check that the domain and policy references identify installed application-owned
   policy. Do not load policy into the candidate process or permit the request to
   define equations, tolerances, or acceptance criteria.
4. Create a unique private workspace using an application-chosen path and filenames.
   Never extract model-chosen paths, links, or archive entries.
5. Apply the static module/capability policy, then launch only the fixed
   `SimulationCore` adapter with trusted arguments and configured resource limits.

Request limits may become stricter than trusted server maxima but can never expand
them. Invalid requests produce a stable operational denial without starting generated
code.

## Module and capability policy

Candidate code may implement only the documented pure `SimulationCore` surface and
use explicitly approved deterministic language features. It may not:

- import application, verifier, runner, filesystem, network, process, worker, cluster,
  inspector, test, package-manager, native addon, WASI, DOM, or renderer modules;
- use absolute imports, path traversal, URL imports, dynamic imports, `require`, module
  loader hooks, preload flags, evaluation of constructed source, or runtime package
  resolution outside the fixed entrypoint;
- read environment variables, clocks, randomness, host state, files, devices, process
  metadata, or another request's state;
- create subprocesses, workers, sockets, servers, timers that outlive the call, or
  native executable code.

Static rejection provides fast, stable diagnostics but is not trusted to recognize
every hostile program. The container/OS boundary and external limits must contain
code even if obfuscation bypasses a static check. Node permission flags should deny
filesystem, process, inspector, worker, and addon capabilities supported by the
pinned Node release, but a missing or changed flag must never convert direct Node
execution into an acceptable fallback.

## Output and exit handling

The candidate communicates only through its fixed adapter. The wrapper incrementally
caps and validates:

- total stdout and stderr bytes;
- total protocol-response bytes and nesting depth;
- sample and diagnostic counts;
- string, field, collection, and numeric bounds;
- finite numeric values and normalized unit-bearing observations.

Raw stdout, stderr, exceptions, stack traces, source, and host paths are not copied to
trusted application logs or returned to the browser. Capped, redacted diagnostics may
be attached to a stable runner classification. A malformed frame, unknown field,
oversized result, non-finite value, observed artifact-hash mismatch, crash, signal,
timeout, cancellation, or resource violation is a runner failure. It is never sent to
the verifier and never labeled as scientific rejection.

Each denial and terminal class has a stable namespaced identifier. Identifiers remain
stable across wording changes and disclose capability categories rather than sensitive
implementation detail.

## Lifecycle and cleanup

One request owns one workspace and one generated process group. Cleanup is idempotent
and runs after success, denial, crash, signal, timeout, cancellation, lost client, and
wrapper error:

1. stop accepting candidate output;
2. terminate and then forcibly kill the entire generated process group as needed;
3. reap every descendant visible to the boundary;
4. close request-scoped descriptors and protocol streams;
5. recursively remove the private workspace without following links; and
6. emit only the bounded terminal response.

The runner never pools generated module instances or reuses a mutable workspace.
Concurrent requests receive distinct workspaces, process groups, byte budgets, and
resource accounting. Shutdown drains or cancels requests through the same cleanup
path and must leave no candidate processes or workspaces.

## Secrets and diagnostics

The runner image and request contain no OpenAI, Codex, administrator, session,
database, storage, telemetry, proxy, cloud metadata, or container-runtime credentials.
The environment is built from an empty base rather than filtered from an inherited
environment. Artifact bytes and teacher prompts are not diagnostics metadata.

Security tests use sentinel secret names and values to prove they are absent from
environment, filesystem, output, and logs. Error details are length-capped and
redacted before leaving the wrapper. External telemetry remains disabled by default,
and generated output is never exported as telemetry.

## Image and dependency policy

- Pin the base image and production dependency graph; builds use the repository
  lockfile and must be reproducible from reviewed source.
- Keep only the runner wrapper, fixed adapter, approved runtime dependencies, and
  non-secret configuration in the final image. Do not include a shell, package
  manager, compiler, source-control client, repository, tests, or provider SDKs.
- Never install packages at runtime. Dynamic package installation and runtime-loaded
  plugins are unsupported.
- Treat a Node version, image base, dependency, native component, loader flag, or
  container configuration change as security-sensitive review scope.

## Required adversarial evidence

Security fixtures must attempt prompt-directed policy changes, import traversal,
filesystem read/write, environment access, DNS/TCP/UDP/HTTP network access, process
and worker creation, native addon/WASI loading, inspector or loader hooks, path
traversal, malformed protocol output, output flooding, infinite computation, memory
and PID pressure, crash/signal behavior, cancellation races, stale workspace reads,
and concurrent sentinel crossing.

For each denied attempt, tests assert:

- the expected stable identifier and operational exit class;
- no host, repository, persistence, secret, or network side effect;
- no response reaches the trusted verifier;
- no generated process or private workspace remains; and
- the response and logs stay within their byte caps and redaction rules.

Container integration evidence must also inspect the effective user, mounts,
capabilities, privileges, network mode, filesystem mutability, resource limits, and
secret-free environment. Unit tests of source inspection or Node permissions alone do
not satisfy the boundary.

## Failure and unsupported-operation policy

If the required OS isolation, cleanup, limits, image identity, or protocol validation
cannot be established, the runner reports unavailable and generation is disabled. It
must not execute locally with weaker controls. A deployment with host mounts,
container-runtime sockets, unrestricted network, root/privileged execution, writable
root, shared workspaces, runtime package installation, or Node permissions as its only
sandbox is outside the supported profile.
