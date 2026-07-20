import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { z } from 'zod'

import { createOperationalError, OperationalError } from './errors.js'
import type { OperationalSignalSink } from './logger.js'
import { type OperationalSignal, operationalSignalSchema } from './signals.js'

export const localNdjsonLogConfigSchema = z
  .object({
    root: z.string().min(1).max(4_096).refine(isAbsolute, {
      message: 'The local diagnostic log root must be absolute.',
    }),
    maxEventBytes: z.number().int().min(128).max(65_536),
    maxFileBytes: z.number().int().min(512).max(16_777_216),
    maxFiles: z.number().int().min(1).max(10),
  })
  .strict()
  .refine(({ maxEventBytes, maxFileBytes }) => maxFileBytes >= maxEventBytes, {
    message: 'The file byte limit must accommodate one maximum-sized event.',
  })

export type LocalNdjsonLogConfig = z.infer<typeof localNdjsonLogConfigSchema>

const readQuerySchema = z.object({ limit: z.number().int().min(1).max(1_000) }).strict()
export interface LocalLogReadResult {
  readonly available: boolean
  readonly events: readonly OperationalSignal[]
  readonly rejectedLineCount: number
  readonly truncated: boolean
}

const currentFilename = 'operational.ndjson'
const unsafeStorageErrorId = 'logging.storage-unsafe' as const
const filename = (index: number): string =>
  index === 0 ? currentFilename : `operational-${index}.ndjson`

const freezeSignal = (signal: OperationalSignal): OperationalSignal => {
  if (signal.correlation !== undefined) Object.freeze(signal.correlation)
  if (signal.attributes !== undefined) Object.freeze(signal.attributes)
  return Object.freeze(signal)
}

export class LocalNdjsonLogStore implements OperationalSignalSink {
  readonly #config: LocalNdjsonLogConfig
  readonly #allowedNames: ReadonlySet<string>

  constructor(config: LocalNdjsonLogConfig) {
    this.#config = localNdjsonLogConfigSchema.parse(config)
    this.#allowedNames = new Set(
      Array.from({ length: this.#config.maxFiles }, (_, index) => filename(index)),
    )
    this.#guard(() => this.#prepareStorage())
  }

  write(input: unknown): void {
    const signal = operationalSignalSchema.parse(input)
    const line = `${JSON.stringify(signal)}\n`
    if (Buffer.byteLength(line, 'utf8') > this.#config.maxEventBytes) {
      throw createOperationalError(
        'logging.event-too-large',
        signal.correlation === undefined ? {} : { correlation: signal.correlation },
      )
    }
    this.#guard(() => this.#append(line), signal)
  }

  readRecent(query: { readonly limit: number }): LocalLogReadResult {
    const { limit } = readQuerySchema.parse(query)
    return this.#guard(() => this.#read(limit))
  }

  #guard<Result>(operation: () => Result, signal?: OperationalSignal): Result {
    try {
      return operation()
    } catch (cause: unknown) {
      if (cause instanceof OperationalError) throw cause
      const correlation = signal?.correlation
      throw createOperationalError(unsafeStorageErrorId, {
        cause,
        ...(correlation === undefined ? {} : { correlation }),
      })
    }
  }

  #prepareStorage(): void {
    if (!existsSync(this.#config.root)) {
      mkdirSync(this.#config.root, { mode: 0o700, recursive: true })
    }
    const rootStatus = lstatSync(this.#config.root)
    if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
      throw createOperationalError(unsafeStorageErrorId)
    }
    chmodSync(this.#config.root, 0o700)
    const entries = readdirSync(this.#config.root)
    if (entries.some((entry) => !this.#allowedNames.has(entry))) {
      throw createOperationalError(unsafeStorageErrorId)
    }
    for (const entry of entries) this.#validateFile(join(this.#config.root, entry))
  }

  #validateFile(path: string): number {
    const status = lstatSync(path)
    if (status.isSymbolicLink() || !status.isFile() || status.size > this.#config.maxFileBytes) {
      throw createOperationalError(unsafeStorageErrorId)
    }
    chmodSync(path, 0o600)
    return status.size
  }

  #append(line: string): void {
    this.#prepareStorage()
    const current = join(this.#config.root, currentFilename)
    const currentBytes = existsSync(current) ? this.#validateFile(current) : 0
    if (currentBytes + Buffer.byteLength(line, 'utf8') > this.#config.maxFileBytes) {
      this.#rotate()
    }
    const descriptor = openSync(
      current,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      const status = fstatSync(descriptor)
      if (!status.isFile()) throw createOperationalError(unsafeStorageErrorId)
      fchmodSync(descriptor, 0o600)
      writeSync(descriptor, line, undefined, 'utf8')
    } catch (cause: unknown) {
      if (cause instanceof OperationalError) throw cause
      throw createOperationalError('logging.write-failed', { cause })
    } finally {
      closeSync(descriptor)
    }
  }

  #rotate(): void {
    if (this.#config.maxFiles === 1) {
      const only = join(this.#config.root, currentFilename)
      if (existsSync(only)) rmSync(only)
      return
    }
    for (let index = this.#config.maxFiles - 1; index >= 1; index -= 1) {
      const target = join(this.#config.root, filename(index))
      const source = join(this.#config.root, filename(index - 1))
      if (existsSync(target)) {
        this.#validateFile(target)
        rmSync(target)
      }
      if (existsSync(source)) {
        this.#validateFile(source)
        renameSync(source, target)
      }
    }
  }

  #read(limit: number): LocalLogReadResult {
    this.#prepareStorage()
    const events: OperationalSignal[] = []
    let rejectedLineCount = 0
    for (let index = this.#config.maxFiles - 1; index >= 0; index -= 1) {
      const path = join(this.#config.root, filename(index))
      if (!existsSync(path)) continue
      this.#validateFile(path)
      for (const line of this.#lines(readFileSync(path, 'utf8'))) {
        if (Buffer.byteLength(line, 'utf8') > this.#config.maxEventBytes) {
          rejectedLineCount += 1
          continue
        }
        const parsed = this.#parseLine(line)
        if (parsed === undefined) rejectedLineCount += 1
        else events.push(parsed)
      }
    }
    const truncated = events.length > limit
    const retained = Object.freeze(events.slice(-limit))
    return Object.freeze({
      available: true,
      events: retained,
      rejectedLineCount,
      truncated,
    })
  }

  #lines(content: string): readonly string[] {
    if (content.length === 0) return []
    const withoutTerminator = content.endsWith('\n') ? content.slice(0, -1) : content
    return withoutTerminator.split('\n')
  }

  #parseLine(line: string): OperationalSignal | undefined {
    try {
      const parsed = operationalSignalSchema.safeParse(JSON.parse(line) as unknown)
      return parsed.success ? freezeSignal(parsed.data) : undefined
    } catch {
      return undefined
    }
  }
}
