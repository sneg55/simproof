import { createHash } from 'node:crypto'

import type { Sha256 } from '@simproof/contracts'

function sha256(value: string): Sha256 {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('Canonical JSON cannot contain non-finite numbers.')
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    if (Object.prototype.toString.call(value) !== '[object Object]') {
      throw new TypeError('Canonical JSON accepts only plain objects.')
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value}.`)
}

export function hashCanonicalJson(value: unknown): Sha256 {
  return sha256(JSON.stringify(canonicalize(value)))
}

export function normalizeSource(source: string): string {
  const withoutBom = source.startsWith('\uFEFF') ? source.slice(1) : source
  return withoutBom.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

export function hashNormalizedSource(source: string): Sha256 {
  return sha256(normalizeSource(source))
}
