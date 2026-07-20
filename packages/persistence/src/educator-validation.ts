import { Buffer } from 'node:buffer'

import type { SimulationLifecycleState } from '@simproof/contracts'

import { exactKeys, validTimestamp } from './generation-validation.js'

const STATES: readonly SimulationLifecycleState[] = [
  'draft',
  'generating',
  'verifying',
  'rejected',
  'verified',
  'stale',
  'published',
  'archived',
]

export interface EducatorListInput {
  readonly limit: number
  readonly cursor: { readonly updatedAt: string; readonly id: string } | null
  readonly search: string | null
  readonly domain: 'projectile' | 'pendulum' | null
  readonly states: readonly SimulationLifecycleState[]
  readonly ownership: 'teacher' | 'bundled' | null
}

// eslint-disable-next-line complexity -- This strict query boundary rejects unknown keys and validates every optional filter independently.
export function parseEducatorList(input: unknown): EducatorListInput | null {
  if (typeof input !== 'object' || input === null) return null
  const allowed = ['limit', 'cursor', 'search', 'domain', 'states', 'ownership']
  if (Object.keys(input).some((key) => !allowed.includes(key))) return null
  const value = input as Record<string, unknown>
  const limit = value.limit ?? 20
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 50) return null
  const search = value.search ?? null
  if (
    search !== null &&
    (typeof search !== 'string' || search.trim().length < 1 || search.trim().length > 120)
  )
    return null
  const domain = value.domain ?? null
  if (domain !== null && domain !== 'projectile' && domain !== 'pendulum') return null
  const ownership = value.ownership ?? null
  if (ownership !== null && ownership !== 'teacher' && ownership !== 'bundled') return null
  const states = value.states ?? []
  if (
    !Array.isArray(states) ||
    states.length > STATES.length ||
    states.some((state) => !STATES.includes(state as SimulationLifecycleState)) ||
    new Set(states).size !== states.length
  )
    return null
  const cursor = value.cursor === undefined ? null : decodeCursor(value.cursor)
  if (value.cursor !== undefined && cursor === null) return null
  return {
    limit: Number(limit),
    cursor,
    search: search === null ? null : search.trim(),
    domain,
    states: states as SimulationLifecycleState[],
    ownership,
  }
}

export function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt, id }), 'utf8').toString('base64url')
}

function decodeCursor(input: unknown): { readonly updatedAt: string; readonly id: string } | null {
  if (typeof input !== 'string' || input.length < 1 || input.length > 500) return null
  try {
    const decoded: unknown = JSON.parse(Buffer.from(input, 'base64url').toString('utf8'))
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !exactKeys(decoded, ['updatedAt', 'id'])
    ) {
      return null
    }
    const value = decoded as Record<string, unknown>
    return validTimestamp(value.updatedAt) && typeof value.id === 'string' && value.id.length > 0
      ? { updatedAt: value.updatedAt, id: value.id }
      : null
  } catch {
    return null
  }
}
