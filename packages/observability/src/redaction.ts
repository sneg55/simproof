import { z } from 'zod'

export const REDACTED = '[REDACTED]'
const TRUNCATED = '[TRUNCATED]'

const valueListSchema = z.array(z.string().min(1).max(100_000)).max(100)
const sensitiveValuesSchema = z
  .object({
    apiKeys: valueListSchema.optional(),
    accessTokens: valueListSchema.optional(),
    passwords: valueListSchema.optional(),
    cookies: valueListSchema.optional(),
    prompts: valueListSchema.optional(),
    generatedContent: valueListSchema.optional(),
  })
  .strict()

export interface SensitiveValues {
  readonly apiKeys?: readonly string[]
  readonly accessTokens?: readonly string[]
  readonly passwords?: readonly string[]
  readonly cookies?: readonly string[]
  readonly prompts?: readonly string[]
  readonly generatedContent?: readonly string[]
}

const redactionOptionsSchema = z
  .object({
    maxDepth: z.number().int().min(1).max(20).default(8),
    maxCollectionEntries: z.number().int().min(1).max(1_000).default(100),
  })
  .strict()

type RedactionOptions = z.input<typeof redactionOptionsSchema>

const sensitiveFieldNames = new Set([
  'apikey',
  'accesstoken',
  'authorization',
  'cookie',
  'csrftoken',
  'generatedcontent',
  'idtoken',
  'password',
  'prompt',
  'refreshtoken',
  'secret',
  'sessionid',
  'sessiontoken',
  'setcookie',
  'token',
])

const normalizeFieldName = (value: string) => value.toLowerCase().replaceAll(/[^a-z]/gu, '')
const isSensitiveField = (value: string) => sensitiveFieldNames.has(normalizeFieldName(value))

const applySyntaxRedaction = (value: string): string =>
  value
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/giu, `Bearer ${REDACTED}`)
    .replaceAll(
      /\b(password|api_key|api-key|apikey|token|access_token|access-token|accesstoken|refresh_token|refresh-token|refreshtoken|id_token|id-token|idtoken|csrf_token|csrf-token|csrftoken|session|sessionid|sessiontoken|cookie|set-cookie)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      `$1=${REDACTED}`,
    )
    .replaceAll(/sk-[A-Za-z0-9_-]{12,}/gu, REDACTED)

const flattenSensitiveValues = (values: z.output<typeof sensitiveValuesSchema>): string[] =>
  Object.values(values)
    .flatMap((entries) => entries ?? [])
    .sort((left, right) => right.length - left.length)

export class Redactor {
  readonly #literals: readonly string[]
  readonly #maxDepth: number
  readonly #maxCollectionEntries: number

  constructor(values: SensitiveValues = {}, options: RedactionOptions = {}) {
    const parsedValues = sensitiveValuesSchema.parse(values)
    const parsedOptions = redactionOptionsSchema.parse(options)
    this.#literals = flattenSensitiveValues(parsedValues)
    this.#maxDepth = parsedOptions.maxDepth
    this.#maxCollectionEntries = parsedOptions.maxCollectionEntries
  }

  redactText(value: string): string {
    let redacted = value
    for (const literal of this.#literals) redacted = redacted.split(literal).join(REDACTED)
    return applySyntaxRedaction(redacted)
  }

  redactValue(value: unknown): unknown {
    return this.#visit(value, 0, new WeakSet<object>())
  }

  #visit(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (typeof value === 'string') return this.redactText(value)
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value !== 'object') return REDACTED
    if (depth >= this.#maxDepth || seen.has(value)) return TRUNCATED
    seen.add(value)
    if (Array.isArray(value)) return this.#array(value, depth, seen)
    if (Object.getPrototypeOf(value) !== Object.prototype) return REDACTED
    return this.#object(value as Record<string, unknown>, depth, seen)
  }

  #array(values: readonly unknown[], depth: number, seen: WeakSet<object>): unknown[] {
    const result = values
      .slice(0, this.#maxCollectionEntries)
      .map((value) => this.#visit(value, depth + 1, seen))
    if (values.length > this.#maxCollectionEntries) result.push(TRUNCATED)
    return result
  }

  #object(
    value: Readonly<Record<string, unknown>>,
    depth: number,
    seen: WeakSet<object>,
  ): Readonly<Record<string, unknown>> {
    const entries = Object.entries(value).slice(0, this.#maxCollectionEntries)
    const redactedEntries: [string, unknown][] = []
    for (const [key, entry] of entries) {
      redactedEntries.push([
        key,
        isSensitiveField(key) ? REDACTED : this.#visit(entry, depth + 1, seen),
      ])
    }
    if (Object.keys(value).length > entries.length) redactedEntries.push(['truncated', TRUNCATED])
    return Object.fromEntries(redactedEntries)
  }
}

export const createRedactor = (values?: SensitiveValues, options?: RedactionOptions): Redactor =>
  new Redactor(values, options)
