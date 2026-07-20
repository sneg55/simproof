import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { MAX_PERSISTED_ARTIFACT_BYTES } from '@simproof/contracts'
import { type ArtifactCleanupResult, collectTemporaryFiles } from './artifact-cleanup.js'
import { canonicalJson, hashBytes, normalizedBytes, parseJson } from './artifact-codec.js'
import { scanArtifactInventory } from './artifact-inventory.js'
import { type ArtifactRootProbe, probeArtifactRoot } from './artifact-readiness.js'
import { err, ok, type Result, type Sha256 } from './types.js'

const SHA256_PATTERN = /^sha256:[a-f\d]{64}$/u
const DATABASE_ERROR = 'database-error'
const CORRUPT_ARTIFACT = 'corrupt-artifact'
const INVALID_INPUT = 'invalid-input'
const ARTIFACT_OPERATION_FAILED = 'Artifact storage operation failed.'

export type { ArtifactCleanupResult } from './artifact-cleanup.js'

function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function exists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

export interface StoredObjectResult {
  readonly hash: Sha256
  readonly byteLength: number
  readonly created: boolean
}

export class ArtifactStore {
  readonly root: string
  readonly #probeRoot: ArtifactRootProbe

  constructor(root: string, probeRoot: ArtifactRootProbe = probeArtifactRoot) {
    this.root = resolve(root)
    this.#probeRoot = probeRoot
  }

  pathForHash(hash: Sha256): string {
    if (!SHA256_PATTERN.test(hash)) throw new TypeError('Artifact hash is invalid.')
    const digest = hash.slice('sha256:'.length)
    return join(this.root, 'sha256', digest.slice(0, 2), digest.slice(2))
  }

  async #ensureSafeDirectory(path: string): Promise<void> {
    try {
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new TypeError('Artifact store contains an unsafe path component.')
      }
    } catch (error) {
      if (!missing(error)) throw error
      try {
        await mkdir(path, { mode: 0o700 })
      } catch (mkdirError) {
        if (!exists(mkdirError)) throw mkdirError
        const metadata = await lstat(path)
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
          throw new TypeError('Artifact store contains an unsafe path component.')
        }
      }
    }
  }

  async #prepare(hash: Sha256): Promise<string> {
    const parent = await lstat(dirname(this.root))
    if (parent.isSymbolicLink() || !parent.isDirectory()) {
      throw new TypeError('Artifact store parent is an unsafe path component.')
    }
    await this.#ensureSafeDirectory(this.root)
    const unexpected = (await readdir(this.root, { withFileTypes: true })).find(
      (entry) => entry.name !== 'sha256' || entry.isSymbolicLink() || !entry.isDirectory(),
    )
    if (unexpected !== undefined) {
      throw new TypeError('Artifact store contains an unexpected root entry.')
    }
    const algorithmRoot = join(this.root, 'sha256')
    await this.#ensureSafeDirectory(algorithmRoot)
    const path = this.pathForHash(hash)
    await this.#ensureSafeDirectory(dirname(path))
    return path
  }

  async #readSafe(hash: Sha256): Promise<Buffer> {
    const path = await this.#prepare(hash)
    const metadata = await lstat(path)
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.size > MAX_PERSISTED_ARTIFACT_BYTES
    ) {
      throw new TypeError('Artifact identity resolved to an unsafe file.')
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || opened.size > MAX_PERSISTED_ARTIFACT_BYTES) {
        throw new TypeError('Artifact exceeds the persisted object limit.')
      }
      const content = await handle.readFile()
      if (content.byteLength > MAX_PERSISTED_ARTIFACT_BYTES) {
        throw new TypeError('Artifact exceeds the persisted object limit.')
      }
      return content
    } finally {
      await handle.close()
    }
  }

  async #putBytes(bytes: Uint8Array, expectedHash?: Sha256): Promise<Result<StoredObjectResult>> {
    if (bytes.byteLength > MAX_PERSISTED_ARTIFACT_BYTES) {
      return err(INVALID_INPUT, 'Artifact exceeds the persisted object limit.')
    }
    const hash = hashBytes(bytes)
    if (
      expectedHash !== undefined &&
      (!SHA256_PATTERN.test(expectedHash) || expectedHash !== hash)
    ) {
      return err('hash-mismatch', 'Artifact content does not match the expected hash.')
    }
    let path: string | undefined
    try {
      path = await this.#prepare(hash)
      const existing = await this.#readSafe(hash)
      if (hashBytes(existing) !== hash) {
        return err(CORRUPT_ARTIFACT, 'Existing artifact bytes do not match their identity.')
      }
      return ok({ hash, byteLength: bytes.byteLength, created: false })
    } catch (error) {
      if (!missing(error)) return err(DATABASE_ERROR, ARTIFACT_OPERATION_FAILED)
    }
    if (path === undefined) return err(DATABASE_ERROR, 'Artifact path preparation failed.')

    const temporary = `${path}.${randomUUID()}.tmp`
    let created = false
    try {
      const temporaryHandle = await open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      )
      try {
        await temporaryHandle.writeFile(bytes)
        await temporaryHandle.sync()
      } finally {
        await temporaryHandle.close()
      }
      try {
        await link(temporary, path)
        const directoryHandle = await open(dirname(path), constants.O_RDONLY)
        try {
          await directoryHandle.sync()
        } finally {
          await directoryHandle.close()
        }
        created = true
      } catch (error) {
        if (!exists(error)) throw error
        const existing = await this.#readSafe(hash)
        if (hashBytes(existing) !== hash) throw error
      }
      return ok({ hash, byteLength: bytes.byteLength, created })
    } catch {
      return err(DATABASE_ERROR, ARTIFACT_OPERATION_FAILED)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  async putSource(
    content: string,
    options: { readonly normalizationVersion: number; readonly expectedHash?: Sha256 },
  ): Promise<Result<StoredObjectResult>> {
    if (options.normalizationVersion !== 1) {
      return err(INVALID_INPUT, 'Source normalization version is unsupported.')
    }
    return await this.#putBytes(normalizedBytes(content), options.expectedHash)
  }

  async putJson(
    content: unknown,
    options: { readonly normalizationVersion: number; readonly expectedHash?: Sha256 },
  ): Promise<Result<StoredObjectResult>> {
    if (options.normalizationVersion !== 1) {
      return err(INVALID_INPUT, 'JSON normalization version is unsupported.')
    }
    try {
      const value = typeof content === 'string' ? parseJson(content) : content
      return await this.#putBytes(normalizedBytes(canonicalJson(value)), options.expectedHash)
    } catch {
      return err(INVALID_INPUT, 'Artifact JSON is invalid.')
    }
  }

  async restore(content: Uint8Array, expectedHash: Sha256): Promise<Result<StoredObjectResult>> {
    return await this.#putBytes(content, expectedHash)
  }

  async get(hash: string): Promise<Result<Buffer>> {
    if (!SHA256_PATTERN.test(hash)) return err('invalid-hash', 'Artifact hash is invalid.')
    const identity = hash
    try {
      const content = await this.#readSafe(identity)
      return hashBytes(content) === identity
        ? ok(content)
        : err(CORRUPT_ARTIFACT, 'Artifact bytes do not match their identity.')
    } catch (error) {
      return missing(error)
        ? err('not-found', 'Artifact was not found.')
        : err(DATABASE_ERROR, ARTIFACT_OPERATION_FAILED)
    }
  }

  async verifyMetadata(input: {
    role: string
    contentHash: Sha256
    byteLength: number
    normalizationVersion: number
  }): Promise<Result<true>> {
    if (input.normalizationVersion !== 1) {
      return err(INVALID_INPUT, 'Artifact normalization version is unsupported.')
    }
    const content = await this.get(input.contentHash)
    if (!content.ok) return content
    if (content.value.byteLength !== input.byteLength) {
      return err(CORRUPT_ARTIFACT, 'Artifact byte length does not match metadata.')
    }
    const text = content.value.toString('utf8')
    try {
      const canonical =
        input.role === 'core-source' || input.role === 'renderer-source'
          ? normalizedBytes(text)
          : normalizedBytes(canonicalJson(parseJson(text)))
      return Buffer.compare(content.value, canonical) === 0
        ? ok(true)
        : err(CORRUPT_ARTIFACT, 'Artifact bytes are not canonically normalized.')
    } catch {
      return err(CORRUPT_ARTIFACT, 'Artifact bytes do not match their role encoding.')
    }
  }

  async delete(hash: Sha256): Promise<Result<boolean>> {
    try {
      const path = await this.#prepare(hash)
      const existed = await lstat(path).then(
        (metadata) => {
          if (metadata.isSymbolicLink() || !metadata.isFile()) {
            throw new TypeError('Artifact identity resolved to an unsafe file.')
          }
          return true
        },
        (error: unknown) => {
          if (missing(error)) return false
          throw error
        },
      )
      await rm(path, { force: true })
      return ok(existed)
    } catch {
      return err(DATABASE_ERROR, ARTIFACT_OPERATION_FAILED)
    }
  }

  async identities(): Promise<Result<readonly Sha256[]>> {
    try {
      const algorithmRoot = join(this.root, 'sha256')
      const parent = await lstat(dirname(this.root))
      if (parent.isSymbolicLink() || !parent.isDirectory()) {
        return err(CORRUPT_ARTIFACT, 'Artifact store parent is an unsafe path component.')
      }
      await this.#ensureSafeDirectory(this.root)
      const rootEntries = await readdir(this.root, { withFileTypes: true })
      if (
        rootEntries.some(
          (entry) => entry.name !== 'sha256' || entry.isSymbolicLink() || !entry.isDirectory(),
        )
      ) {
        return err(CORRUPT_ARTIFACT, 'Artifact store contains an unexpected root entry.')
      }
      try {
        await this.#ensureSafeDirectory(algorithmRoot)
      } catch {
        return err(CORRUPT_ARTIFACT, 'Artifact store integrity validation failed.')
      }
      const inventory = await scanArtifactInventory(algorithmRoot)
      return inventory.ok ? ok(inventory.value.identities) : inventory
    } catch (error) {
      return missing(error)
        ? ok([])
        : err(CORRUPT_ARTIFACT, 'Artifact store integrity validation failed.')
    }
  }

  async readiness(): Promise<Result<true>> {
    return await this.#probeRoot(this.root)
  }

  async #collectOrphans(
    orphanedArtifacts: readonly Sha256[],
    minimumAgeMs: number,
    nowMs: number,
  ): Promise<
    Pick<ArtifactCleanupResult, 'deletedArtifacts' | 'skippedArtifacts' | 'deferredArtifacts'>
  > {
    const deletedArtifacts: Sha256[] = []
    const skippedArtifacts: Sha256[] = []
    const deferredArtifacts: Sha256[] = []
    for (const hash of orphanedArtifacts) {
      const metadata = await this.#prepare(hash)
        .then(async (path) => await lstat(path))
        .catch(() => undefined)
      if (metadata === undefined) {
        deferredArtifacts.push(hash)
      } else if (nowMs - metadata.mtimeMs < minimumAgeMs) {
        skippedArtifacts.push(hash)
      } else {
        const deleted = await this.delete(hash)
        if (!deleted.ok) deferredArtifacts.push(hash)
        else if (deleted.value) deletedArtifacts.push(hash)
        else skippedArtifacts.push(hash)
      }
    }
    return { deletedArtifacts, skippedArtifacts, deferredArtifacts }
  }

  async auditAndCollect(
    referenced: readonly Sha256[],
    options: {
      readonly dryRun?: boolean
      readonly minimumAgeMs?: number
      readonly nowMs?: number
    } = {},
  ): Promise<Result<ArtifactCleanupResult>> {
    if (referenced.some((hash) => !SHA256_PATTERN.test(hash))) {
      return err('invalid-hash', 'Referenced artifact hash is invalid.')
    }
    const algorithmRoot = join(this.root, 'sha256')
    const identities = await this.identities()
    if (!identities.ok) return identities
    const inventory = await scanArtifactInventory(algorithmRoot)
    if (!inventory.ok) return inventory
    const referencedSet = new Set(referenced)
    for (const hash of referencedSet) {
      const validated = await this.get(hash)
      if (!validated.ok) return validated
    }
    const orphanedArtifacts = identities.value.filter((hash) => !referencedSet.has(hash))
    const emptyTemporaryFiles = {
      found: inventory.value.temporaryFiles.length,
      deleted: 0,
      skipped: 0,
      deferred: 0,
    }
    if (options.dryRun ?? true) {
      return ok({
        orphanedArtifacts,
        deletedArtifacts: [],
        skippedArtifacts: orphanedArtifacts,
        deferredArtifacts: [],
        temporaryFiles: { ...emptyTemporaryFiles, skipped: emptyTemporaryFiles.found },
      })
    }
    const minimumAgeMs = options.minimumAgeMs ?? 60_000
    const nowMs = options.nowMs ?? Date.now()
    const artifacts = await this.#collectOrphans(orphanedArtifacts, minimumAgeMs, nowMs)
    const temporaryFiles = await collectTemporaryFiles(
      inventory.value.temporaryFiles,
      minimumAgeMs,
      nowMs,
    )
    return ok({
      orphanedArtifacts,
      ...artifacts,
      temporaryFiles,
    })
  }
}
