# ADR 0004: Initial identity and privacy posture

## Status

Accepted

## Context

Student identity and educational records would introduce consent, retention,
institutional policy, and regulatory obligations unrelated to the initial teacher
workflow. The initial product is a self-hosted tool for one teacher/operator, not a
school identity platform. Model credentials, prompts, diagnostics, and generated
artifacts can still contain sensitive information and need explicit local defaults.

## Decision

- SimProof is a single-tenant, teacher-only product. It has no student accounts and
  stores no student records.
- The initial product has one local administrator account using secure server-side
  sessions. OIDC, school SSO, and multiple users are outside the initial product.
- OpenAI and Codex credentials are supplied by the deployer, stored and used only on
  the server side, and never exposed to browsers, generated artifacts, or generated
  code.
- Product telemetry is disabled by default.
- Local structured diagnostics are included. External observability export is optional
  and disabled by default.
- Bundled verified examples remain usable without model credentials. Model-provider
  communication occurs only for generation or repair that requires configured
  credentials.

## Consequences

- Product flows, schemas, logs, examples, and support documentation must not solicit or
  depend on student identity or records.
- The deployment owner controls the local application data and explicitly opts into any
  external diagnostics export.
- Starting a configured generation or repair can send required prompt and workflow data
  to the selected model provider; the UI and deployment documentation must not imply
  that such a request remains entirely local.
- Server-side sessions need secure cookie, expiry, rotation, invalidation, and secret
  handling appropriate to the supported Compose deployment.
- The application is not an OIDC relying party, school roster system, classroom LMS, or
  multi-user authorization platform in the initial release.

## Rejected alternatives

- **Student accounts or student records:** rejected because they expand identity,
  privacy, consent, and data-governance scope without strengthening the teacher
  workflow.
- **Multiple local users, OIDC, or school SSO initially:** rejected because they require
  broader authorization and identity-administration guarantees.
- **Telemetry or external diagnostics enabled by default:** rejected because a
  self-hosted deployment should not silently export operational or content data.
- **Client-side provider credentials:** rejected because browser delivery cannot keep a
  deployer secret and would widen exposure.
- **Claiming all configured generation is local:** rejected because provider-backed
  generation necessarily crosses the deployment boundary.

## Conditions for revisiting

Student use, additional users, OIDC, school SSO, rosters, or educational records require
a new privacy, identity, authorization, retention, deletion, audit, and regulatory
review before implementation. Default-on telemetry or observability export requires a
separate opt-in and data-minimization decision; it cannot be introduced as an incidental
operational change.
