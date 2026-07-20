import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
} from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { createOperationalError, OperationalError } from './errors.js'
import {
  type LocalLogReadResult,
  type LocalNdjsonLogConfig,
  localNdjsonLogConfigSchema,
} from './local-file-store.js'
import { type OperationalSignal, operationalSignalSchema } from './signals.js'

const readQuerySchema = z.object({ limit: z.number().int().min(1).max(1_000) }).strict()
const currentFilename = 'operational.ndjson'
const unsafeStorageErrorId = 'logging.storage-unsafe' as const
const filename = (index: number): string =>
  index === 0 ? currentFilename : `operational-${index}.ndjson`

const freezeSignal = (signal: OperationalSignal): OperationalSignal => {
  if (signal.correlation !== undefined) Object.freeze(signal.correlation)
  if (signal.attributes !== undefined) Object.freeze(signal.attributes)
  return Object.freeze(signal)
}

const lines = (content: string): readonly string[] => {
  if (content.length === 0) return []
  const withoutTerminator = content.endsWith('\n') ? content.slice(0, -1) : content
  return withoutTerminator.split('\n')
}

const parseLine = (line: string): OperationalSignal | undefined => {
  try {
    const parsed = operationalSignalSchema.safeParse(JSON.parse(line) as unknown)
    return parsed.success ? freezeSignal(parsed.data) : undefined
  } catch {
    return undefined
  }
}

export class LocalNdjsonLogReader {
  readonly #config: LocalNdjsonLogConfig
  readonly #allowedNames: ReadonlySet<string>

  constructor(config: LocalNdjsonLogConfig) {
    this.#config = localNdjsonLogConfigSchema.parse(config)
    this.#allowedNames = new Set(
      Array.from({ length: this.#config.maxFiles }, (_, index) => filename(index)),
    )
  }

  readRecent(query: { readonly limit: number }): LocalLogReadResult {
    const { limit } = readQuerySchema.parse(query)
    try {
      return this.#read(limit)
    } catch (cause: unknown) {
      if (cause instanceof OperationalError) throw cause
      throw createOperationalError(unsafeStorageErrorId, { cause })
    }
  }

  #read(limit: number): LocalLogReadResult {
    if (!existsSync(this.#config.root)) {
      return Object.freeze({
        available: false,
        events: Object.freeze([]),
        rejectedLineCount: 0,
        truncated: false,
      })
    }
    const rootStatus = lstatSync(this.#config.root)
    if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
      throw createOperationalError(unsafeStorageErrorId)
    }
    const entries = readdirSync(this.#config.root)
    if (entries.some((entry) => !this.#allowedNames.has(entry))) {
      throw createOperationalError(unsafeStorageErrorId)
    }

    const events: OperationalSignal[] = []
    let rejectedLineCount = 0
    for (let index = this.#config.maxFiles - 1; index >= 0; index -= 1) {
      const path = join(this.#config.root, filename(index))
      if (!existsSync(path)) continue
      for (const line of lines(this.#readFile(path))) {
        if (Buffer.byteLength(line, 'utf8') > this.#config.maxEventBytes) {
          rejectedLineCount += 1
          continue
        }
        const parsed = parseLine(line)
        if (parsed === undefined) rejectedLineCount += 1
        else events.push(parsed)
      }
    }
    const truncated = events.length > limit
    return Object.freeze({
      available: true,
      events: Object.freeze(events.slice(-limit)),
      rejectedLineCount,
      truncated,
    })
  }

  #readFile(path: string): string {
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const status = fstatSync(descriptor)
      if (!status.isFile() || status.size > this.#config.maxFileBytes) {
        throw createOperationalError(unsafeStorageErrorId)
      }
      const bytes = Buffer.alloc(this.#config.maxFileBytes + 1)
      let offset = 0
      while (offset < bytes.length) {
        const read = readSync(descriptor, bytes, offset, bytes.length - offset, null)
        if (read === 0) break
        offset += read
      }
      if (offset > this.#config.maxFileBytes) {
        throw createOperationalError(unsafeStorageErrorId)
      }
      return bytes.toString('utf8', 0, offset)
    } finally {
      closeSync(descriptor)
    }
  }
}
