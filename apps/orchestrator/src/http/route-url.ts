import type { RouteDefinition, RouteParameterKind } from './routes.js'

const MAX_TARGET_LENGTH = 4_096
const MAX_PATH_LENGTH = 2_048
const MAX_QUERY_LENGTH = 2_048
const MAX_QUERY_KEY_LENGTH = 64
const MAX_QUERY_VALUE_LENGTH = 500
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const IDENTIFIER = /^[a-z][a-z0-9.-]{0,99}$/u
const PARAMETER = /^:([a-z][A-Za-z0-9]*)$/u

export interface RouteMatch {
  readonly route: RouteDefinition
  readonly parameters: Readonly<Record<string, string>>
  readonly query: Readonly<Record<string, string>>
}

export type RouteMatchResult =
  | { readonly ok: true; readonly match: RouteMatch | undefined }
  | { readonly ok: false; readonly errorId: 'http.invalid-request-target' }

interface ParsedTarget {
  readonly segments: readonly string[]
  readonly query: Readonly<Record<string, string>>
}

export function matchRequestTarget(
  method: string,
  target: string,
  routes: readonly RouteDefinition[],
): RouteMatchResult {
  const parsed = parseTarget(target)
  if (parsed === undefined) return invalidTarget()
  for (const route of routes) {
    if (route.method !== method) continue
    const match = matchSegments(route, parsed.segments)
    if (match === null) continue
    if (match === undefined || !allowedQuery(route, parsed.query)) return invalidTarget()
    return { ok: true, match: { route, parameters: match, query: parsed.query } }
  }
  return { ok: true, match: undefined }
}

export function validateRouteInventory(routes: readonly RouteDefinition[]): void {
  for (const [index, route] of routes.entries()) {
    const segments = templateSegments(route.path)
    const declared = Object.keys(route.parameters ?? {}).sort()
    const present = segments.flatMap((segment) => PARAMETER.exec(segment)?.[1] ?? []).sort()
    if (new Set(present).size !== present.length || !sameStrings(present, declared)) {
      throw new TypeError(`Route parameter declaration does not match template: ${route.path}`)
    }
    const queryKeys = route.queryKeys ?? []
    if (
      new Set(queryKeys).size !== queryKeys.length ||
      queryKeys.some((key) => !/^[a-z][A-Za-z0-9]*$/u.test(key))
    ) {
      throw new TypeError(`Route query declaration is invalid: ${route.path}`)
    }
    for (const other of routes.slice(0, index)) {
      if (other.method === route.method && templatesOverlap(other.path, route.path)) {
        throw new TypeError(`Route templates are ambiguous: ${other.path} and ${route.path}`)
      }
    }
  }
}

function parseTarget(target: string): ParsedTarget | undefined {
  if (invalidTargetShape(target)) return undefined
  const question = target.indexOf('?')
  const rawPath = question === -1 ? target : target.slice(0, question)
  const rawQuery = question === -1 ? '' : target.slice(question + 1)
  if (invalidPathAndQueryShape(rawPath, rawQuery, question !== -1)) return undefined
  const segments = rawPath.slice(1).split('/').map(decodeCanonicalComponent)
  if (segments.some((segment) => segment === undefined || unsafePathSegment(segment))) {
    return undefined
  }
  const query = parseQuery(rawQuery)
  if (query === undefined) return undefined
  return { segments: segments as string[], query }
}

function parseQuery(raw: string): Readonly<Record<string, string>> | undefined {
  if (raw.length === 0) return {}
  const query = new Map<string, string>()
  for (const pair of raw.split('&')) {
    const separator = pair.indexOf('=')
    if (separator < 1 || pair.indexOf('=', separator + 1) !== -1) return undefined
    const key = decodeCanonicalComponent(pair.slice(0, separator))
    const value = decodeCanonicalComponent(pair.slice(separator + 1))
    if (
      key === undefined ||
      value === undefined ||
      unsafeComponent(key) ||
      unsafeComponent(value) ||
      key.length > MAX_QUERY_KEY_LENGTH ||
      value.length > MAX_QUERY_VALUE_LENGTH ||
      query.has(key)
    ) {
      return undefined
    }
    query.set(key, value)
  }
  return Object.fromEntries(query)
}

function decodeCanonicalComponent(value: string): string | undefined {
  if (value.includes('+')) return undefined
  try {
    const decoded = decodeURIComponent(value)
    return encodeURIComponent(decoded) === value ? decoded : undefined
  } catch {
    return undefined
  }
}

function unsafePathSegment(segment: string | undefined): boolean {
  return (
    segment === undefined ||
    segment.length === 0 ||
    segment === '.' ||
    segment === '..' ||
    /[\\/]/u.test(segment) ||
    unsafeComponent(segment)
  )
}

function unsafeComponent(value: string): boolean {
  return /\p{C}/u.test(value)
}

function matchSegments(
  route: RouteDefinition,
  actual: readonly string[],
): Readonly<Record<string, string>> | null | undefined {
  const expected = templateSegments(route.path)
  if (actual.length !== expected.length) return null
  const parameters: Array<readonly [string, string]> = []
  for (const [index, segment] of expected.entries()) {
    const value = actual.at(index)
    if (value === undefined) return null
    const name = PARAMETER.exec(segment)?.[1]
    if (name === undefined) {
      if (segment !== value) return null
      continue
    }
    const kind = Object.entries(route.parameters ?? {}).find(([key]) => key === name)?.[1]
    if (kind === undefined || !validParameter(kind, value)) return undefined
    parameters.push([name, value])
  }
  return Object.fromEntries(parameters)
}

function validParameter(kind: RouteParameterKind, value: string): boolean {
  return kind === 'uuid' ? UUID.test(value) : IDENTIFIER.test(value)
}

function allowedQuery(route: RouteDefinition, query: Readonly<Record<string, string>>): boolean {
  const allowed = new Set(route.queryKeys ?? [])
  return Object.keys(query).every((key) => allowed.has(key))
}

function templateSegments(path: string): readonly string[] {
  if (!path.startsWith('/') || path === '/' || path.endsWith('/') || path.includes('//')) {
    throw new TypeError(`Route template is invalid: ${path}`)
  }
  return path.slice(1).split('/')
}

function templatesOverlap(left: string, right: string): boolean {
  const leftSegments = templateSegments(left)
  const rightSegments = templateSegments(right)
  return (
    leftSegments.length === rightSegments.length &&
    leftSegments.every(
      (segment, index) =>
        segment === rightSegments.at(index) ||
        PARAMETER.test(segment) ||
        PARAMETER.test(rightSegments.at(index) ?? ''),
    )
  )
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right.at(index))
}

function invalidTargetShape(target: string): boolean {
  return (
    target.length === 0 ||
    target.length > MAX_TARGET_LENGTH ||
    !target.startsWith('/') ||
    target.startsWith('//') ||
    target.includes('#')
  )
}

function invalidPathAndQueryShape(
  rawPath: string,
  rawQuery: string,
  hasQuestionMark: boolean,
): boolean {
  return (
    rawPath.length > MAX_PATH_LENGTH ||
    rawQuery.length > MAX_QUERY_LENGTH ||
    rawPath === '/' ||
    rawPath.endsWith('/') ||
    rawPath.includes('//') ||
    (hasQuestionMark && rawQuery.length === 0)
  )
}

function invalidTarget(): RouteMatchResult {
  return { ok: false, errorId: 'http.invalid-request-target' }
}
