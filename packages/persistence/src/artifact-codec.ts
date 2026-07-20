import { createHash } from 'node:crypto'

import type { Sha256 } from './types.js'

export function normalizedBytes(content: string): Buffer {
  return Buffer.from(content.replaceAll('\r\n', '\n').replaceAll('\r', '\n'), 'utf8')
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) {
      throw new TypeError('Sparse JSON arrays are invalid.')
    }
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  throw new TypeError('Artifact JSON must contain only finite JSON values.')
}

export function parseJson(content: string): unknown {
  return JSON.parse(content) as unknown
}

export function hashBytes(content: Uint8Array): Sha256 {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}
