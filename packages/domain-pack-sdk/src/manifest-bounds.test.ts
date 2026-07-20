import { describe, expect, it } from 'vitest'

import { domainPackManifestSchema } from './manifest.js'
import { completeManifest } from './test-fixtures.js'

describe('domain-pack manifest bounded rejection', () => {
  it('rejects unknown top-level and ordinary nested keys', () => {
    const base = completeManifest()
    expect(domainPackManifestSchema.safeParse({ ...base, unknown: true }).success).toBe(false)
    expect(
      domainPackManifestSchema.safeParse({
        ...base,
        capabilities: { ...base.capabilities, unknown: true },
      }).success,
    ).toBe(false)
  })

  it.each([
    [
      'bounded text',
      (base: ReturnType<typeof completeManifest>) => ({ ...base, title: 'a'.repeat(161) }),
    ],
    [
      'bounded arrays',
      (base: ReturnType<typeof completeManifest>) => ({
        ...base,
        learningScope: Array.from({ length: 51 }, (_, index) => `Scope ${index}`),
      }),
    ],
    [
      'control arrays',
      (base: ReturnType<typeof completeManifest>) => ({
        ...base,
        controls: {
          ...base.controls,
          positive: Array.from({ length: 101 }, (_, index) => ({
            ...base.controls.positive[0],
            id: `example-positive-${index}`,
            path: `fixtures/positive-${index}.json`,
          })),
        },
      }),
    ],
    [
      'finding arrays',
      (base: ReturnType<typeof completeManifest>) => ({
        ...base,
        findings: Array.from({ length: 201 }, (_, index) => ({
          ...base.findings[0],
          id: `example.finding.${index}`,
        })),
      }),
    ],
    [
      'inventory arrays',
      (base: ReturnType<typeof completeManifest>) => ({
        ...base,
        contentInventory: Array.from({ length: 501 }, (_, index) => `file-${index}.ts`),
      }),
    ],
  ])('rejects max plus one for %s', (_label, mutate) => {
    expect(domainPackManifestSchema.safeParse(mutate(completeManifest())).success).toBe(false)
  })
})
