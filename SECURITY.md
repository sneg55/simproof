# Security policy

## Private reporting path

Do not report a suspected vulnerability in a public issue, discussion, pull request,
commit message, chat, or diagnostic attachment.

Before this repository is made public, the operator must enable GitHub private
vulnerability reporting. Once enabled, open the repository's **Security** tab, choose
**Advisories**, then **Report a vulnerability**. That private advisory is the supported
reporting path. Include only the information needed to reproduce and assess the issue,
and remove credentials, student-identifying information, prompts, generated content,
provider responses, and unrelated production data.

Private reporting is a pre-publication release prerequisite; this document does not
claim that the repository-host setting is currently enabled. If **Report a
vulnerability** is unavailable, do not disclose the issue publicly. Contact a
maintainer through a previously established private channel and ask them to enable or
provide the repository's private security-reporting path before sending details.

The public security issue template is redirect-only and collects no vulnerability
details.

## What to include privately

- affected source revision or release and deployment profile;
- affected component and stable error ID, if one was safely emitted;
- minimal reproduction conditions and observed impact;
- whether generated code, a provider, authentication, persistence, export, or the
  launcher/runner boundary is involved; and
- any suggested mitigation, without including live credentials or third-party data.

Do not attach raw `.env` files, databases, artifacts, backups, cookies, authorization
headers, provider payloads, prompts, stack traces, or unredacted logs. Use the bounded
local diagnostic workflow in [observability.md](docs/operations/observability.md) only
when it can be reviewed before sharing.

## Maintainer response and disclosure

Maintainers will acknowledge the private report, reproduce it in an isolated
environment, determine affected supported versions, and coordinate a fix and advisory.
Reporter and maintainers should keep details private until a corrected release or
documented mitigation is available. Publication, CVE requests, release sequencing, and
credit are coordinated in the private advisory; no contributor should promise them on
the project's behalf.

A security fix must preserve evidence. Do not delete migrations, overwrite artifacts,
weaken scientific controls, bypass authentication, disable runner isolation, or publish
secrets to demonstrate that a symptom disappeared. Backports must pass the release
line's full security and compatibility gates.

## Supported versions

No public SimProof release has been published yet. Vulnerability reports against the
default branch are accepted, but the branch is not itself a production release.

After the first authorized release, this table must be updated as part of every release:

| Version | Security support |
|---|---|
| Latest explicitly supported release line | Supported |
| Older release lines named in current release notes | Supported only as stated there |
| Unnamed older releases, forks, and modified deployment profiles | Not supported |

Support never extends beyond the documented single-tenant Linux Docker Compose
profile merely because a deployment can start. See the [release and support
policy](docs/operations/releases-and-support.md) and [supported
deployment](docs/operations/deployment.md).

## Security-sensitive areas

Generated model output is hostile input. Important report classes include sandbox or
import escape, host filesystem access, network access, secret exposure, process or
resource-limit bypass, launcher authority abuse, stale workspace reuse, cleanup
failure, authentication/session/CSRF bypass, unsafe proxy trust, SQLite or artifact
integrity failure, backup/restore confusion, traversal, diagnostic leakage, and
dependency or image provenance problems.

A verifier bypass is also security-sensitive when it permits malformed or undeclared
generated content to cross a trusted boundary. A scientific correction without a
security impact can use the public scientific-correction template.

## Safe testing

Test only systems and data you own or are explicitly authorized to assess. Do not test
against a teacher's deployment, cause denial of service, access data, contact model
providers, or execute generated code outside the isolated runner. The project does not
authorize activity that violates law, provider terms, or third-party rights.
