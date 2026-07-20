import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DOMAIN_PACK_CONFORMANCE_IDS } from '@simproof/domain-pack-sdk'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const domainDocs = [
  'docs/domains/domain-pack-contract.md',
  'docs/domains/scientific-review.md',
  'docs/domains/authoring.md',
  'docs/domains/circuits-requirements.md',
  'docs/domains/graphing-requirements.md',
] as const

const authoritativeExternalLocators = new Set([
  'https://dlmf.nist.gov/',
  'https://dlmf.nist.gov/22.19.i',
  'https://openstax.org/books/college-physics/pages/16-4-the-simple-pendulum',
  'https://openstax.org/books/university-physics-volume-2/pages/10-2-resistors-in-series-and-parallel',
  'https://openstax.org/books/university-physics-volume-2/pages/10-3-kirchhoffs-rules',
  'https://www.bipm.org/en/publications/si-brochure',
  'https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8',
  'https://www.w3.org/WAI/WCAG21/Techniques/html/H51',
])

interface MarkdownLink {
  readonly destination: string
  readonly label: string
}

const loadDocs = async (): Promise<ReadonlyMap<string, string>> =>
  new Map(
    await Promise.all(
      domainDocs.map(async (path) => [path, await readFile(resolve(root, path), 'utf8')] as const),
    ),
  )

const linksIn = (markdown: string): readonly MarkdownLink[] =>
  [...markdown.matchAll(/\[([^\]]+)\]\(([^)]+)\)/gu)].map((match) => ({
    label: match[1] ?? '',
    destination: match[2] ?? '',
  }))

const headingAnchor = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[`*_]/gu, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/gu, '-')

const anchorsIn = (markdown: string): ReadonlySet<string> =>
  new Set(
    markdown
      .split('\n')
      .filter((line) => /^#{1,6}\s/u.test(line))
      .map((line) => headingAnchor(line.replace(/^#{1,6}\s+/u, ''))),
  )

const localTarget = (
  sourcePath: string,
  destination: string,
): Readonly<{ anchor?: string; path: string }> => {
  const [path = '', anchor] = destination.split('#', 2)
  return {
    path: path === '' ? resolve(root, sourcePath) : resolve(root, dirname(sourcePath), path),
    ...(anchor === undefined ? {} : { anchor }),
  }
}

const completeEllipticIntegralFirstKind = (modulus: number): number => {
  const intervals = 4_096
  const step = Math.PI / 2 / intervals
  let weightedSum = 0
  for (let index = 0; index <= intervals; index += 1) {
    const angle = index * step
    const integrand = 1 / Math.sqrt(1 - modulus ** 2 * Math.sin(angle) ** 2)
    const weight = index === 0 || index === intervals ? 1 : index % 2 === 0 ? 2 : 4
    weightedSum += weight * integrand
  }
  return (weightedSum * step) / 3
}

describe('domain governance documentation', () => {
  it('keeps every relative document link and heading anchor valid', async () => {
    const docs = await loadDocs()
    for (const [sourcePath, markdown] of docs) {
      for (const { destination, label } of linksIn(markdown)) {
        if (/^https:\/\//u.test(destination)) continue
        expect(destination, `${sourcePath}: ${label}`).not.toMatch(/^[a-z]+:/u)
        const target = localTarget(sourcePath, destination)
        await expect(access(target.path), `${sourcePath}: ${destination}`).resolves.toBeUndefined()
        if (target.anchor !== undefined) {
          const targetMarkdown = await readFile(target.path, 'utf8')
          expect(anchorsIn(targetMarkdown), `${sourcePath}: ${destination}`).toContain(
            target.anchor,
          )
        }
      }
    }
  })

  it('pins every external link to a reviewed authoritative locator', async () => {
    const docs = await loadDocs()
    const actual = new Set(
      [...docs.values()].flatMap((markdown) =>
        linksIn(markdown)
          .map(({ destination }) => destination)
          .filter((destination) => /^https:\/\//u.test(destination)),
      ),
    )
    expect(actual).toEqual(authoritativeExternalLocators)
    expect([...docs.values()].join('\n')).not.toContain('10-3-kirchoffs-rules')
    expect([...docs.values()].join('\n')).not.toContain('physics.nist.gov/cuu/pdf/sp811.pdf')
  })

  it('maps the review checklist to machine evidence and executable commands', async () => {
    const docs = await loadDocs()
    const contract = docs.get('docs/domains/domain-pack-contract.md') ?? ''
    const review = docs.get('docs/domains/scientific-review.md') ?? ''
    const authoring = docs.get('docs/domains/authoring.md') ?? ''
    const normalizedReview = review.replace(/\s+/gu, ' ')

    for (const required of [
      'stable citation/evidence IDs',
      'Hidden verifier thresholds are prohibited',
      'ordered finding sequence',
      'artifact, policy, domain-pack, runner protocol, runner image, dependency, and report',
      'compile-time',
      'runtime plugin',
    ]) {
      expect(contract.toLowerCase()).toContain(required.toLowerCase())
    }
    for (const required of [
      'Scientific validation',
      'Pedagogical review',
      'automated scientific',
      'no human subject-matter-expert or educator',
      'credential. The automated scientific audit',
      'A later human review may be appended',
      'Review checklist and evidence map',
      'below/equal/above controls',
      'domain-pack-changed',
      'policy-changed',
      'Projectile dead-threshold migration decision',
      'apex absolute floor of `0.02 m`',
      'dead policy for the supported grid',
      '`PACK-001`',
      '`PACK-024`',
    ]) {
      expect(normalizedReview).toContain(required)
    }
    expect(authoring).toContain('pnpm --filter @simproof/docs test')
    expect(`${contract}\n${authoring}`).not.toContain('pnpm test --filter docs')

    const documentedGateIds = [...review.matchAll(/^\| `(PACK-\d{3})` \|/gmu)].map(
      (match) => match[1],
    )
    expect(documentedGateIds).toEqual(Object.values(DOMAIN_PACK_CONFORMANCE_IDS))
  })

  it('documents every required domain-pack artifact and governance owner', async () => {
    const contract = (await loadDocs()).get('docs/domains/domain-pack-contract.md') ?? ''
    const normalized = contract.replace(/\s+/gu, ' ').toLowerCase()

    for (const required of [
      'stable lower-case namespaced id and semantic pack version',
      'human title, description, learning objectives, and explicit exclusions',
      'shared strict `conceptspec` schema',
      'unique quantity ids, unambiguous canonical unit symbols, and dimensions',
      'inclusive/exclusive bounds, model conditions, assumptions, limitations, and singularities',
      'pure, deterministic, finite trusted calculations over the supported range',
      'stable policy id, semantic version, immutable checks, sampling, tolerances, assumptions, and limitations',
      'stable namespaced ids, categories, quantities, and explanations',
      'known-correct, realistic negative, property, and boundary controls',
      'both visual scene data and equivalent text/table data',
      'supported sdk semantic-version range',
      'named maintainer team and completed scientific-review record',
    ]) {
      expect(normalized).toContain(required)
    }
  })

  it('reproduces the documented pendulum endpoint calibration independently', async () => {
    const review = (await loadDocs()).get('docs/domains/scientific-review.md') ?? ''
    const amplitudeRadians = (15 * Math.PI) / 180
    const modulus = Math.sin(amplitudeRadians / 2)
    const exactToSmallAngleRatio = (2 * completeEllipticIntegralFirstKind(modulus)) / Math.PI
    const relativeDifference = exactToSmallAngleRatio - 1

    expect(exactToSmallAngleRatio).toBeCloseTo(1.004_300_579, 9)
    expect(relativeDifference * 100).toBeCloseTo(0.430_057_917, 8)
    expect(review).toContain('T_exact / T_small ~= 1.004300579')
    expect(review).toContain('about `0.4301%` below')
    expect(review).toContain('`9.80665 m/s^2`')
    for (const sourceMetadata of [
      'Paul Peter Urone and Roger Hinrichs',
      'Equations 16.23–16.29',
      'NIST Digital Library of Mathematical Functions, version 1.2.7',
      'Equations 22.19.1–22.19.2',
      '9th edition, version 4.01',
      'Ambler Thompson and Barry N. Taylor',
      'Appendix B.8',
    ]) {
      expect(review).toContain(sourceMetadata)
    }
  })

  it('accounts for every required error source in the filled pendulum review', async () => {
    const review = (await loadDocs()).get('docs/domains/scientific-review.md') ?? ''
    const pendulumReview = review
      .split('## Pendulum review example', 2)[1]
      ?.split('## Projectile dead-threshold migration decision', 1)[0]

    expect(pendulumReview).toBeDefined()
    for (const required of [
      'Model approximation',
      'Trusted reference numerical error',
      'Candidate numerical error',
      'Floating-point and platform variation',
      'Input/display rounding',
      'False-reject analysis',
      'False-accept analysis',
    ]) {
      expect(pendulumReview).toContain(required)
    }
  })

  it('keeps future circuits and graphing work explicitly unimplemented and unregistered', async () => {
    const docs = await loadDocs()
    for (const path of [
      'docs/domains/circuits-requirements.md',
      'docs/domains/graphing-requirements.md',
    ]) {
      const markdown = docs.get(path) ?? ''
      expect(markdown).toContain('**not implemented, registered, or supported**')
      expect(markdown).toContain('Implementation remains blocked')
      expect(markdown.toLowerCase()).toContain('non-executable')
      expect(markdown).not.toMatch(/status:\s*accepted/iu)
    }

    const circuits = docs.get('docs/domains/circuits-requirements.md') ?? ''
    for (const required of [
      'Candidate bounded claim',
      'Required concept and units',
      'Required trusted behavior',
      'Policy and calibration evidence still required',
      'Accessible adapter requirements',
    ]) {
      expect(circuits).toContain(required)
    }

    const graphing = docs.get('docs/domains/graphing-requirements.md') ?? ''
    for (const required of [
      'Scope decision required',
      'Non-executable concept representation',
      'Trusted reference and applicability requirements',
      'Calibration and controls still required',
      'Accessible adapter requirements',
    ]) {
      expect(graphing).toContain(required)
    }
  })
})
