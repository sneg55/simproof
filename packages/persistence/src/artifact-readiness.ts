import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { hashBytes } from './artifact-codec.js'
import { err, ok, type Result } from './types.js'

const PROBE_BYTES = Buffer.from('simproof-artifact-readiness-v2', 'utf8')
const MAX_PROBE_BYTES = 64
const OPERATION_FAILED = 'Artifact storage operation failed.'

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

async function ensureSafeDirectory(path: string): Promise<void> {
  try {
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new TypeError('Artifact readiness encountered an unsafe directory.')
    }
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error
    try {
      await mkdir(path, { mode: 0o700 })
    } catch (mkdirError) {
      if (!hasCode(mkdirError, 'EEXIST')) throw mkdirError
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new TypeError('Artifact readiness encountered an unsafe directory.')
      }
    }
  }
}

export interface ArtifactReadinessProbeOptions {
  readonly probeBytes?: Uint8Array
  readonly afterWrite?: () => Promise<void>
}

export type ArtifactRootProbe = (root: string) => Promise<Result<true>>

async function prepareProbePath(root: string, digest: string): Promise<string> {
  const algorithmRoot = join(root, 'sha256')
  const prefixRoot = join(algorithmRoot, digest.slice(0, 2))
  const parent = await lstat(dirname(root))
  if (parent.isSymbolicLink() || !parent.isDirectory()) {
    throw new TypeError('Artifact readiness encountered an unsafe parent.')
  }
  await ensureSafeDirectory(root)
  await ensureSafeDirectory(algorithmRoot)
  await ensureSafeDirectory(prefixRoot)
  return join(prefixRoot, `${digest.slice(2)}.${randomUUID()}.tmp`)
}

async function writeAndVerifyProbe(
  path: string,
  bytes: Buffer,
  digest: string,
  afterWrite: (() => Promise<void>) | undefined,
): Promise<boolean> {
  let created = false
  let failed = false
  try {
    const writer = await open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    )
    created = true
    try {
      await writer.writeFile(bytes)
      await writer.sync()
    } finally {
      await writer.close()
    }
    await afterWrite?.()
    const reader = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const metadata = await reader.stat()
      const content = await reader.readFile()
      failed =
        !metadata.isFile() ||
        metadata.size !== bytes.byteLength ||
        !content.equals(bytes) ||
        hashBytes(content) !== `sha256:${digest}`
    } finally {
      await reader.close()
    }
  } catch {
    failed = true
  } finally {
    if (created) {
      try {
        await rm(path)
      } catch {
        failed = true
      }
    }
  }
  return !failed
}

export async function probeArtifactRoot(
  root: string,
  options: ArtifactReadinessProbeOptions = {},
): Promise<Result<true>> {
  const bytes = Buffer.from(options.probeBytes ?? PROBE_BYTES)
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROBE_BYTES) {
    return err('database-error', OPERATION_FAILED)
  }
  const digest = hashBytes(bytes).slice('sha256:'.length)
  try {
    const path = await prepareProbePath(root, digest)
    const verified = await writeAndVerifyProbe(path, bytes, digest, options.afterWrite)
    return verified ? ok(true) : err('database-error', OPERATION_FAILED)
  } catch {
    return err('database-error', OPERATION_FAILED)
  }
}
