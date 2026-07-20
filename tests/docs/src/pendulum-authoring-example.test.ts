import { DOMAIN_PACK_CONFORMANCE_IDS } from '@simproof/domain-pack-sdk'
import { describe, expect, it } from 'vitest'

import { inspectPendulumAuthoringExample } from './pendulum-authoring-example.js'

describe('compile-checked pendulum authoring example', () => {
  it('validates and explicitly registers the real reviewed built-in pack', () => {
    const example = inspectPendulumAuthoringExample()

    expect(example.currentSdkVersion).toBe('1.0.0')
    expect(example.isCompatible).toBe(true)
    expect(example.registry.ids).toEqual(['pendulum'])
    expect(example.registry.get('pendulum')).toBeDefined()
    expect(example.registry.get('circuits')).toBeUndefined()
    expect(example.registry.get('graphing')).toBeUndefined()
    expect(example.manifest.scientificReview.subject).toEqual({
      pack: { id: 'pendulum', version: '1.0.0' },
      policies: [{ id: 'pendulum.small-angle', version: '1.0.0' }],
    })
    expect(example.manifest.scientificReview.audits.map(({ kind }) => kind).sort()).toEqual([
      'accessibility',
      'maintainer',
      'pedagogical',
      'scientific',
    ])
    expect(
      example.manifest.scientificReview.audits.every(({ actor }) => !actor.humanCredentialClaim),
    ).toBe(true)
    expect(example.manifest.scientificReview.reviewArtifact.baseRevision).toEqual({
      kind: 'git-commit',
      reference: '34255b495c2e01b66c44942b3ec9568c12f6de9b',
    })
    expect(example.conformance).toEqual({
      ok: true,
      failures: [],
      passed: Object.values(DOMAIN_PACK_CONFORMANCE_IDS),
    })
  })

  it('exposes every required reviewed pack component through the real manifest', () => {
    const { manifest } = inspectPendulumAuthoringExample()

    expect(manifest).toMatchObject({
      id: 'pendulum',
      version: '1.0.0',
      sdkCompatibility: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
      capabilities: {
        renderer: 'pendulum-bob',
        accessibleRepresentation: { summary: true, table: true },
      },
    })
    expect(manifest.learningScope.length).toBeGreaterThan(0)
    expect(manifest.citations.length).toBeGreaterThan(0)
    expect(manifest.units.map(({ quantity }) => quantity)).toEqual(
      expect.arrayContaining(['length', 'amplitude', 'period']),
    )
    expect(manifest.applicability.bounds.map(({ quantity }) => quantity)).toEqual([
      'length',
      'amplitude',
    ])
    expect(manifest.applicability.singularities).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'pendulum.zero-length' })]),
    )
    expect(manifest.policies).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'pendulum.small-angle' })]),
    )
    expect(manifest.findings.length).toBeGreaterThan(0)
    for (const controls of [
      manifest.controls.positive,
      manifest.controls.negative,
      manifest.controls.property,
      manifest.controls.boundary,
    ]) {
      expect(controls.length).toBeGreaterThan(0)
    }
    expect(manifest.contentInventory.length).toBeGreaterThan(0)
    expect(manifest.scientificReview.maintainers.length).toBeGreaterThan(0)
  })

  it('binds precise pendulum source metadata to review evidence', () => {
    const { citationsById } = inspectPendulumAuthoringExample()
    const openStax = citationsById.get('pendulum.openstax.simple-period')
    const nonlinear = citationsById.get('pendulum.nist.nonlinear-period')
    const units = citationsById.get('units.bipm.si-9')
    const standardGravity = citationsById.get('gravity.nist.sp811')

    expect(openStax).toMatchObject({
      authors: ['Paul Peter Urone', 'Roger Hinrichs'],
      edition: '2012 edition',
      locator: {
        source: 'https://openstax.org/books/college-physics/pages/16-4-the-simple-pendulum',
        section: 'Section 16.4',
        equation: 'Equations 16.23–16.29',
      },
    })
    expect(nonlinear).toMatchObject({
      issuingBody: 'National Institute of Standards and Technology',
      edition: 'DLMF version 1.2.7',
      locator: { source: 'https://dlmf.nist.gov/22.19.i' },
    })
    expect(units).toMatchObject({
      issuingBody: 'Bureau International des Poids et Mesures',
      edition: '9th edition, version 4.01',
      locator: {
        source: 'https://www.bipm.org/en/publications/si-brochure',
        section: 'Sections 2.3.3–2.3.4',
      },
    })
    expect(standardGravity).toMatchObject({
      authors: ['Ambler Thompson', 'Barry N. Taylor'],
      edition: '2008 edition',
      locator: {
        source:
          'https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8',
        section: 'Appendix B.8, acceleration of free fall, standard',
      },
    })
  })
})
