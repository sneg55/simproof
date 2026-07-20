# ADR 0005: Code, bundled content, and generated-artifact licensing

## Status

Accepted

## Context

SimProof distributes application code, bundled educational examples, and artifacts
created through user-directed model workflows. Those categories can have different
licensing and ownership considerations. The repository needs a clear intended release
posture, but an architecture record cannot determine copyrightability, interpret
third-party terms, or grant rights a contributor, deployer, or user does not hold.

## Decision

- SimProof code is licensed under Apache License 2.0.
- Bundled educational examples are licensed under Creative Commons Attribution 4.0
  International (CC BY 4.0).
- User-generated artifacts retain deployer/user ownership and record a configurable
  content license for export.
- Generated artifacts retain that recorded, configurable content-license metadata with
  their provenance. The metadata records the selected export posture; it is not itself
  proof of copyright ownership, copyrightability, or authority to license the content.
- The project will reproduce the selected license texts and keep code, bundled-content,
  and generated-artifact notices distinguishable in release materials.

This is the operator-approved licensing policy, not legal advice or a legal
interpretation. Genuine uncertainty remains around jurisdiction-specific ownership and
copyrightability of model-assisted output, provider terms, third-party inputs, and
whether a particular deployer or user has sufficient rights to select an export
license. Those questions require qualified legal review; the implementation must not
invent answers to them.

## Consequences

- Source distributions need the Apache-2.0 license and required notices; bundled
  educational content needs CC BY 4.0 attribution and a clearly separated content
  notice.
- Generated-artifact exports must carry their recorded license metadata and provenance
  without presenting that metadata as a legal warranty.
- Contributors and operators remain responsible for ensuring they have rights to
  material they contribute, bundle, prompt with, generate, or distribute.
- Dependencies, assets, example inputs, and model-provider terms require license and
  attribution review before release; this ADR does not declare them compatible.
- Ownership is not transferred to SimProof merely because an artifact is stored or
  verified by the application.

## Rejected alternatives

- **One license for code, examples, and generated artifacts:** rejected because software,
  curated educational content, and user-controlled output have different intended uses
  and rights holders.
- **Project ownership of all generated artifacts:** rejected because user-generated
  artifacts retain deployer/user ownership under the approved product posture.
- **A fixed generated-content license:** rejected because exports require configurable
  license metadata.
- **Treating a selected metadata value as legal authority:** rejected because software
  cannot establish ownership, copyrightability, or permission to license.
- **Interpreting ambiguous provider or third-party terms in this ADR:** rejected because
  those are legal questions requiring qualified review.

## Conditions for revisiting

Revisit this ADR before changing any license, bundling third-party educational content,
adopting provider terms that conflict with the intended posture, or making claims about
ownership or copyrightability of generated output. Legal review may require narrower
export choices, additional notices, attribution, or provenance. Until uncertainty is
resolved, the product must disclose it rather than infer rights or silently broaden a
license grant.
