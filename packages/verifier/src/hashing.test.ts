import { describe, expect, it } from 'vitest'

import { hashCanonicalJson, hashNormalizedSource, normalizeSource } from './hashing.js'

describe('verification binding hashes', () => {
  it('normalizes transport-only source differences before hashing', () => {
    expect(normalizeSource('\uFEFFexport const value = 1\r\n')).toBe('export const value = 1\n')
    expect(hashNormalizedSource('\uFEFFexport const value = 1\r\n')).toBe(
      hashNormalizedSource('export const value = 1\n'),
    )
  })

  it('hashes object keys canonically while preserving array order', () => {
    expect(hashCanonicalJson({ beta: 2, alpha: 1 })).toBe(hashCanonicalJson({ alpha: 1, beta: 2 }))
    expect(hashCanonicalJson({ values: [1, 2] })).not.toBe(hashCanonicalJson({ values: [2, 1] }))
    expect(hashCanonicalJson({ value: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/u)
  })
})
