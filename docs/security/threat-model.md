# Generated-code runner threat model

## Scope and security objective

This threat model covers the boundary from a teacher prompt or model response through
execution of a candidate `SimulationCore` and validation of the runner response. It
does not treat generated code as cooperative. The objective is to let SimProof obtain
bounded observations from hostile code without exposing application secrets, the
repository, persistent data, the host, other workspaces, or an unrestricted network.

The isolated container or equivalent operating-system boundary is the primary
security control. Node permissions, static source inspection, import restrictions,
schemas, and language-level timeouts are defense in depth. None of those controls
alone is a sandbox for malicious JavaScript.

This document implements the deployment and verification boundaries accepted in
[ADR 0001](../decisions/0001-trusted-verification.md) and
[ADR 0002](../decisions/0002-supported-deployment.md). The concrete runner controls
are specified in [generated-code-runner.md](generated-code-runner.md).

## Assets to protect

- OpenAI, Codex, administrator, session, deployment, and diagnostics-export secrets.
- The application repository, trusted verifier policy, negative controls, and runner
  image contents.
- SQLite metadata, content-addressed artifacts, backups, exports, and local
  diagnostics.
- Host files, processes, devices, container runtime, Docker socket, and network
  identity.
- Availability of the teacher application and capacity available to concurrent runs.
- Integrity of each request, artifact hash, deterministic input set, normalized
  observation, diagnostic, and exit classification.
- Isolation between the temporary workspace of one run and every other run.

## Trust boundaries and actors

| Boundary | Trust position | Permitted crossing |
|---|---|---|
| Teacher/browser to orchestrator | Prompts and parameters are attacker-controlled input, even for an authenticated teacher. | Size-bounded, schema-validated teacher intent. |
| Model provider to orchestrator | Every model response, filename, manifest, and source byte is hostile. Prompt injection can shape all of them. | A strictly validated candidate artifact; never an executed module. |
| Orchestrator to runner control plane | The orchestrator is trusted for lifecycle and secrets, but candidate content inside its request is hostile. | A versioned, size-bounded runner request with an expected artifact hash and fixed limits. |
| Runner control plane to generated process | This is the primary hostile-code boundary. The wrapper and image are trusted; the candidate process is not. | Only the documented simulation inputs and capped stdout/stderr/result channels. |
| Runner response to verifier | Output is attacker-controlled even when execution exited successfully. | A schema-valid, finite, bounded response whose observed artifact hash matches the request. |
| Container to host and other containers | The container runtime, kernel, image, and launch policy are trusted computing base. | No application data crossing; only the bounded protocol through the deployment's dedicated transport. |

The deployer is trusted to use the supported image and launch profile without
weakening it. A compromised host, container runtime, kernel, runner image, or
orchestrator is outside the protection offered to generated code.

## Attacker-controlled inputs

- Teacher prompts, recognized parameters, cancellation timing, and repeated requests.
- Model-generated source, comments, strings, module specifiers, manifests, filenames,
  object keys, numeric values, and encoded or obfuscated content.
- Candidate stdout, stderr, thrown values, returned objects, numeric samples, process
  exit behavior, and timing.
- Artifact metadata or stored bytes that have been corrupted or substituted before a
  run.

All attacker-controlled input is rejected on unknown fields, invalid paths, malformed
encoding, non-finite values, protocol-version mismatch, or configured size limits.
Validation does not make generated source trusted; valid source still runs only inside
the isolation boundary.

## Threats and required controls

| Threat or abuse case | Security impact | Required prevention, containment, and detection |
|---|---|---|
| Prompt injection instructs a model to disclose secrets, weaken policy, add tools, or escape the runner. | Secret disclosure, policy corruption, or hostile code generation. | Give providers the minimum context and no unrelated secrets; constrain outputs with schemas and path/size allowlists; never accept model-defined verifier truth; execute every candidate in isolation regardless of apparent intent. |
| Import escape uses relative traversal, absolute paths, package subpaths, URL imports, dynamic `import()`, `require`, or loader hooks. | Reads trusted code or executes unapproved dependencies. | Accept one fixed entrypoint; reject traversal and all non-allowlisted module forms before launch; provide only fixed image dependencies; apply Node permissions secondarily; keep repository and application packages out of the runtime filesystem. |
| Filesystem access reads credentials, image files, `/proc`, device nodes, or another workspace, or writes persistent state. | Disclosure, tampering, or cross-run influence. | Read-only root filesystem; a fresh private temporary workspace containing only the candidate; no host, repository, persistence, home, or Docker-socket mounts; unprivileged numeric user; bounded tmpfs; destroy the workspace on every exit path. |
| Network access performs exfiltration, scans internal services, fetches code, or reaches metadata endpoints. | Secret/data disclosure, dependency injection, and lateral movement. | Start the generated-code isolation boundary with no network namespace or interfaces beyond loopback as required by the runtime; do not pass proxy configuration; reject network modules; test DNS, TCP, UDP, HTTP, and metadata-address attempts. |
| Process spawning invokes shells, other interpreters, workers, cluster children, or privileged tools. | Bypasses module policy, multiplies resource use, or probes the container. | Reject process, child-process, worker, cluster, and native-loading APIs; ship no shell or toolchain in the minimal runtime; drop capabilities; cap PIDs; kill the full process group on completion, failure, timeout, or cancellation. |
| Native addons, WebAssembly system interfaces, inspector hooks, or runtime loader flags reach capabilities outside reviewed JavaScript. | Memory-unsafe execution or policy bypass. | No dynamic package installation or addon build toolchain; reject `.node` modules, native addons, WASI, inspector, preload, and custom-loader flags; use fixed entry arguments and environment; review every runtime dependency added to the image. |
| Environment access discovers credentials, configuration, host paths, or proxy endpoints. | Disclosure and network pivoting. | Construct an explicit minimal non-secret environment; never inherit the orchestrator or host environment; reject environment APIs in candidate source; include secret-name and sentinel checks in security tests. |
| Output flooding fills memory, pipes, logs, or storage with stdout, stderr, diagnostics, or oversized sample arrays. | Availability loss or accidental persistence of hostile data. | Cap stdout, stderr, diagnostic count/length, sample count, nesting, and total response bytes while streaming; terminate at the first cap; classify with a stable denial ID; do not forward raw output into trusted logs. |
| Infinite loops, recursive work, timer storms, or memory pressure exhaust CPU, memory, or PIDs. | Runner or host denial of service. | Enforce wall-clock, CPU, address-space/memory, PID, file-size, and temporary-storage limits outside the candidate process; terminate the full process group; bound concurrency and queueing. Language-level timeouts are not sufficient. |
| Dependency confusion or runtime package installation introduces attacker-selected code. | Supply-chain execution inside the runner and possible sandbox attack. | Use a pinned, reproducibly built image and lockfile; install production dependencies during image build only; provide no package manager or network at runtime; reject undeclared imports; scan and review dependency/image changes. |
| Stale workspace reuse exposes a previous artifact or lets one run influence another. | Cross-run disclosure, nondeterminism, or forged evidence. | Create a unique private workspace per request with restrictive permissions; never cache generated modules or mutable state across runs; verify cleanup after success, failure, crash, cancellation, and forced termination; test concurrent runs with distinct sentinels. |
| Path traversal or crafted filenames overwrite wrapper files or escape the workspace. | Control-plane tampering or host/container file access. | Do not extract arbitrary directory trees; use application-chosen filenames; reject absolute paths, separators, dot segments, links, devices, and unknown manifest fields; open files without following links where applicable. |
| Malformed JSON, prototype-shaped objects, non-finite numbers, hash mismatch, or forged exit data reaches verification. | Verifier confusion or false evidence. | Parse only the framed protocol; validate strict shared schemas and byte/count/depth limits; normalize finite values; compute the observed hash inside the runner; reject mismatches and invalid output as runner failure, never scientific rejection. |
| Signals, crashes, cancellation races, or orphaned descendants bypass cleanup. | Leaked workspaces/processes or ambiguous outcomes. | Give each request one lifecycle owner; make cleanup idempotent; kill and reap the process group; remove the workspace in a finalizer; return a stable operational exit classification; verify no active process or workspace remains. |
| Container escape exploits the runtime or kernel. | Host compromise. | Keep the runtime and kernel patched; use an unprivileged user, read-only root, no privileged mode, no host namespaces/devices/mounts, no Docker socket, dropped capabilities, and restrictive seccomp/AppArmor where supported. Treat this as residual platform risk, not solved by source validation. |

Stable public denial identifiers must reveal the category, not host paths, source
snippets, secrets, stack dumps, or raw attacker output. Scientific verification is
not invoked after a runner denial, crash, malformed response, resource limit, or hash
mismatch.

## Control invariants

The following conditions must hold for every run, including tests and local
development that claim to exercise generated code:

1. The web app, orchestrator, verifier, and host Node process never import or evaluate
   candidate source.
2. The isolation launcher rejects a run unless the required OS/container controls are
   active. It never silently falls back to local execution.
3. The candidate receives no secret-bearing environment, host path, persistent volume,
   repository mount, Docker socket, or unrestricted network.
4. Limits and output caps are fixed by trusted configuration and the validated request;
   generated code cannot raise them.
5. A response is accepted only when its protocol version and observed artifact hash
   match and all values pass the shared schema.
6. Workspaces and descendant processes are request-scoped and absent after every
   terminal outcome.

## Residual risks

- A container-runtime or kernel vulnerability could escape the boundary. Hardening,
  patching, and least privilege reduce but do not eliminate this risk.
- CPU, memory, disk, and process limits reduce denial of service but cannot guarantee
  fair service under every host-pressure or runtime failure mode.
- Static import and capability inspection can miss obfuscated behavior. Isolation and
  runtime limits must remain effective even when inspection misses it.
- Timing, CPU usage, exit classification, and capped diagnostics are observable side
  channels. No cross-tenant confidentiality claim is made because the supported
  product is single-tenant, but secrets and prior-workspace data must still be absent.
- Vulnerabilities in fixed runtime dependencies remain possible. The runner image and
  dependency changes require security review and reproducible rebuilds.
- A malicious or compromised local administrator can weaken Compose settings or alter
  images. Such a deployment no longer satisfies the supported security profile.

## Unsupported platforms and configurations

The initial supported profile is the documented self-hosted Docker Compose topology.
The following must not be represented as secure or production-supported:

- direct execution with `node`, a test worker, `vm`, worker threads, or Node
  permissions as the only boundary;
- browser-side, web-process, orchestrator-process, verifier-process, or host-process
  execution of generated source;
- rootful or privileged runner execution, shared host namespaces, unrestricted
  network, writable root filesystems, or relaxed process/resource limits;
- mounting the repository, application persistence, home directories, host paths,
  devices, container-runtime sockets, or secrets into the generated-code boundary;
- runtime dependency installation, native addons, unreviewed custom images, or
  runtime-downloadable scientific plugins;
- Kubernetes, hosted SaaS, desktop-only sandboxing, or other deployment profiles that
  lack separately reviewed equivalent isolation and adversarial evidence.

If the environment cannot enforce the required boundary, generated execution must be
disabled. Bundled verified examples may remain available without enabling the runner.

## Verification and review triggers

Adversarial tests must cover every threat category above and assert both a stable
classification and absence of host/cross-workspace effects. Review this threat model
when the runner protocol, image base, runtime version, dependency set, import policy,
container privileges, transport, resource limits, workspace lifecycle, or supported
deployment profile changes.
