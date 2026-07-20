# ADR 0002: Supported self-hosted deployment

## Status

Accepted

## Context

The demonstration specification allowed a local run and left production deployment
open. A maintained product needs one reproducible topology with explicit security and
support boundaries. Generated code is hostile input: process-level language features
alone do not provide the isolation boundary required to execute it safely.

The seed experience must remain useful before a deployer configures model providers,
while live generation requires provider credentials.

## Decision

- Docker Compose is the supported self-hosted deployment for the initial product.
  Other deployment targets are not supported release profiles.
- Generated code executes only inside the isolated runner container. It never executes
  in the web or orchestrator process. Node permission controls are defense-in-depth and
  are not the primary security boundary.
- OpenAI and Codex credentials are supplied by the deployer and remain server-side.
  They are not embedded in browser assets, returned through application APIs, written
  into generated artifacts, or exposed to the generated-code runner.
- Bundled verified examples work without model credentials. Creating or repairing a
  generated simulation requires the applicable configured credentials.
- The supported deployment includes local structured diagnostics. Export to an
  external observability service is optional and disabled by default.

## Consequences

- Release and recovery testing can target one documented Compose topology instead of
  several environments with different security properties.
- Operators need a container runtime, persistent storage, secret configuration, and a
  documented backup and recovery procedure.
- Runner isolation must be tested as a security boundary. A passing Node permission
  check alone is insufficient evidence.
- A fresh installation can demonstrate and inspect verified content without contacting
  a model provider; generation controls must clearly explain missing configuration.
- Kubernetes, hosted SaaS, and platform-specific packages may be community experiments,
  but they cannot be represented as supported deployments under this ADR.

## Rejected alternatives

- **Local development commands as the production profile:** rejected because they do
  not define isolation, persistence, recovery, or upgrade behavior.
- **Several initial deployment targets:** rejected because multiple partial profiles
  dilute security, smoke-test, documentation, and recovery coverage.
- **Node permissions as the sole sandbox:** rejected because they are defense-in-depth,
  not a sufficient boundary for malicious generated code.
- **Browser-side or runner-visible model credentials:** rejected because untrusted code
  and client assets must not gain access to deployment secrets.
- **Credentials required to view the product:** rejected because the bundled seed
  library is an intentional credential-free experience.

## Conditions for revisiting

Add another supported target only after it has equivalent isolation, secret handling,
persistence, migration, backup, recovery, upgrade, and smoke-test evidence. Replacing
the runner boundary requires a reviewed threat model and adversarial tests demonstrating
at least the same isolation guarantees. Changing credential placement requires a
separate security decision.
