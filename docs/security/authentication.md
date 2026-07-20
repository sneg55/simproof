# Authentication and request security

## Supported identity model

SimProof supports one local teacher/administrator account. It has no student accounts,
rosters, roles, OIDC integration, or multi-user authorization model. Every non-loopback
deployment requires the administrator session; client-side state is never accepted as
authorization.

The first-run bootstrap secret is deployer-supplied server configuration. Production
startup fails unless it is at least 32 characters with sufficient character diversity.
The bootstrap flow replaces it with a password-derived credential and records one-way
completion; it cannot remain a default login credential. Password hashes and salts are
stored locally. Neither passwords nor bootstrap values are logged, exported, backed up
as plaintext, returned to the browser, or sent to model providers.

## Sessions

Sessions are server-side records addressed by an opaque, high-entropy cookie token.
Only token and CSRF hashes are stored. Login and privilege changes rotate the session;
logout, credential replacement, expiry, or explicit revocation invalidates it. Cookie
delivery uses `HttpOnly`, `Secure` in production, `SameSite=Strict`, a narrow path, no
`Domain`, and bounded expiry and idle limits.

Each authenticated request enforces the configured idle boundary while preserving the
absolute expiry. Activity timestamps refresh at a bounded interval to avoid a database
write per request. Login and rotation enforce the configured active-session cap in the
same transaction as stale-session cleanup, so concurrent connections cannot exceed it.
Revoked and expired metadata is pruned oldest-first to a 256-row total bound. Pruning
may clear an obsolete rotation link before deleting its inactive predecessor, while
preserving active sessions and referential integrity.

Active session records are operational credentials, not durable user content. Backups
include the administrator credential and bootstrap-completion settings but exclude
active sessions. Restore starts with no active sessions and never revives a previously
issued cookie. The administrator must authenticate again after restore.

## Request authenticity

Every state-changing request requires all of the following:

- a valid non-expired server-side administrator session;
- an exact allowed `Origin`;
- a session-bound CSRF token supplied outside the cookie;
- `application/json` for JSON endpoints;
- strict boundary-schema validation with unknown fields rejected; and
- configured request, prompt, rate, and concurrency bounds.

The configured JSON request-body limit cannot be lower than 16 KiB. This keeps every accepted
maximum-length bootstrap secret and administrator password representable even after UTF-8 encoding
and JSON escaping; operators may set a stricter limit only above that floor.

Production origins are exact HTTPS origins with no wildcard, credentials, path, query,
or fragment. TLS may terminate at the immediate Compose reverse proxy. Forwarded client
information is trusted only when the direct peer equals the one optional configured
proxy IP; SimProof never enables blanket `X-Forwarded-*` trust.

Authentication failures use stable classifications and do not distinguish whether a
credential, session ID, or account state was close to valid. Logs may contain a bounded
request/correlation ID and failure class, but not cookies, CSRF values, passwords,
bootstrap secrets, provider credentials, or raw request bodies.

## Configuration boundary

`apps/orchestrator/src/config` is the only process-environment parsing boundary.
Production requires explicit deployment mode, absolute database and artifact paths,
bootstrap and session secrets, and at least one exact HTTPS origin. Provider credentials
remain optional so bundled examples work without external generation.

Telemetry and external diagnostics are disabled unless their exact boolean flags and
HTTPS destinations are explicitly configured. Configuration failures name invalid
fields but never echo their values. Browser configuration is built from an explicit
public allowlist and cannot contain server secrets.
