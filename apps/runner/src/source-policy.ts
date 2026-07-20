import type { RunnerErrorId } from '@simproof/contracts'

export type SourcePolicyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errorId: RunnerErrorId; readonly message: string }

interface Token {
  readonly kind: 'punctuation' | 'string' | 'word'
  readonly value: string
}

const ENVIRONMENT_DENIAL = 'runner.denied.environment'
const NETWORK_DENIAL = 'runner.denied.network'
const NONDETERMINISM_DENIAL = 'runner.denied.nondeterminism'

const CAPABILITY_IDS = new Map<string, RunnerErrorId>([
  ['Bun', ENVIRONMENT_DENIAL],
  ['Deno', ENVIRONMENT_DENIAL],
  ['EventSource', NETWORK_DENIAL],
  ['WebAssembly', 'runner.denied.native-addon'],
  ['WebSocket', NETWORK_DENIAL],
  ['Worker', 'runner.denied.worker'],
  ['XMLHttpRequest', NETWORK_DENIAL],
  ['child_process', 'runner.denied.subprocess'],
  ['console', 'runner.denied.output'],
  ['fetch', NETWORK_DENIAL],
  ['global', ENVIRONMENT_DENIAL],
  ['globalThis', ENVIRONMENT_DENIAL],
  ['navigator', NETWORK_DENIAL],
  ['process', ENVIRONMENT_DENIAL],
  ['setInterval', NONDETERMINISM_DENIAL],
  ['setTimeout', NONDETERMINISM_DENIAL],
])

function readQuoted(source: string, start: number, quote: string): number {
  let position = start + 1
  while (position < source.length) {
    if (source.charAt(position) === '\\') position += 2
    else if (source.charAt(position) === quote) return position + 1
    else position += 1
  }
  return source.length
}

interface TokenRead {
  readonly nextPosition: number
  readonly token?: Token
}

function readToken(source: string, position: number): TokenRead {
  const character = source.charAt(position)
  const next = source.charAt(position + 1)
  if (/\s/u.test(character)) return { nextPosition: position + 1 }
  if (character === '/' && next === '/') {
    const lineEnd = source.indexOf('\n', position + 2)
    return { nextPosition: lineEnd === -1 ? source.length : lineEnd }
  }
  if (character === '/' && next === '*') {
    const blockEnd = source.indexOf('*/', position + 2)
    return { nextPosition: blockEnd === -1 ? source.length : blockEnd + 2 }
  }
  if (character === '"' || character === "'") {
    const end = readQuoted(source, position, character)
    return {
      nextPosition: end,
      token: { kind: 'string', value: source.slice(position + 1, end - 1) },
    }
  }
  if (character === '`') {
    return {
      nextPosition: readQuoted(source, position, character),
      token: { kind: 'punctuation', value: '`' },
    }
  }
  if (/[A-Za-z_$]/u.test(character)) {
    const value = /^[\w$]+/u.exec(source.slice(position))?.[0] ?? character
    return { nextPosition: position + value.length, token: { kind: 'word', value } }
  }
  return { nextPosition: position + 1, token: { kind: 'punctuation', value: character } }
}

function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = []
  let position = 0
  while (position < source.length) {
    const read = readToken(source, position)
    if (read.token !== undefined) tokens.push(read.token)
    position = read.nextPosition
  }
  return tokens
}

const denied = (errorId: RunnerErrorId, message: string): SourcePolicyResult => ({
  ok: false,
  errorId,
  message,
})

function inspectWord(tokens: readonly Token[], index: number, token: Token): SourcePolicyResult {
  const next = tokens.at(index + 1)
  if (token.value === 'import') {
    return next?.value === '('
      ? denied('runner.denied.dynamic-import', 'Dynamic import is forbidden.')
      : denied('runner.denied.forbidden-import', 'Generated cores must be self-contained.')
  }
  if (token.value === 'from' && next?.kind === 'string') {
    return denied('runner.denied.forbidden-import', 'Re-exported modules are forbidden.')
  }
  if (['constructor', 'eval', 'Function', 'require'].includes(token.value)) {
    return denied('runner.denied.dynamic-code', 'Runtime code construction is forbidden.')
  }
  const capabilityId = CAPABILITY_IDS.get(token.value)
  if (capabilityId !== undefined) {
    return denied(capabilityId, `Forbidden capability reference: ${token.value}.`)
  }
  const random =
    token.value === 'Math' && next?.value === '.' && tokens.at(index + 2)?.value === 'random'
  if (['Date', 'Temporal', 'performance'].includes(token.value) || random) {
    return denied(NONDETERMINISM_DENIAL, 'Generated cores must be deterministic.')
  }
  return { ok: true }
}

export function inspectGeneratedSource(source: string): SourcePolicyResult {
  const tokens = tokenize(source)
  for (const [index, token] of tokens.entries()) {
    if (token.value === '`') {
      return denied('runner.denied.dynamic-code', 'Template literals are not allowed.')
    }
    if (token.kind === 'punctuation' && token.value === '\\') {
      return denied('runner.denied.dynamic-code', 'Escaped identifiers are not allowed.')
    }
    if (token.kind !== 'word') continue
    const result = inspectWord(tokens, index, token)
    if (!result.ok) return result
  }
  return { ok: true }
}
