import type { CurrentVerificationBindings, VerificationReport } from '@simproof/contracts'
import { describe, expect, it } from 'vitest'

import { assessReportValidity, isPublishable } from './report-validity.js'

const a = `sha256:${'a'.repeat(64)}` as const
const b = `sha256:${'b'.repeat(64)}` as const

const bindings: CurrentVerificationBindings = {
  conceptSpecHash: a,
  artifactHash: a,
  observationHash: a,
  policy: { id: 'projectile.standard', version: '1.0.0', contentHash: a },
  domainPack: { id: 'projectile', version: '1.0.0', contentHash: a },
  runner: { version: '1.0.0', protocolVersion: '1' },
}

const report = {
  conceptSpecHash: a,
  artifact: { hash: a },
  observationHash: a,
  policy: bindings.policy,
  domainPack: bindings.domainPack,
  runner: bindings.runner,
  verdict: 'verified',
} as VerificationReport

describe('verification report validity', () => {
  it('keeps currentness separate from the immutable verifier verdict', () => {
    const validity = assessReportValidity(report, bindings)

    expect(validity).toEqual({ status: 'current' })
    expect(isPublishable(report, validity)).toBe(true)
  })

  it('reports every changed verification binding once', () => {
    const validity = assessReportValidity(report, {
      ...bindings,
      conceptSpecHash: b,
      artifactHash: b,
      observationHash: b,
      policy: { ...bindings.policy, contentHash: b },
      domainPack: { ...bindings.domainPack, version: '1.1.0' },
      runner: { ...bindings.runner, version: '1.1.0' },
    })

    expect(validity).toEqual({
      status: 'stale',
      reasons: [
        'concept-changed',
        'artifact-changed',
        'observations-changed',
        'policy-changed',
        'domain-pack-changed',
        'runner-changed',
      ],
    })
    expect(isPublishable(report, validity)).toBe(false)
  })

  it('never publishes rejected or inapplicable reports', () => {
    expect(isPublishable({ ...report, verdict: 'rejected' }, { status: 'current' })).toBe(false)
    expect(isPublishable({ ...report, verdict: 'inapplicable' }, { status: 'current' })).toBe(false)
  })
})
