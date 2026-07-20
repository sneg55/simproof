import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { err, ok, type Result, type Sha256 } from './types.js'

const CORRUPT_ARTIFACT = 'corrupt-artifact'
const MAX_STORE_ENTRIES = 100_000

export interface OwnedTemporaryFile {
  readonly path: string
  readonly mtimeMs: number
}

export interface ArtifactInventory {
  readonly identities: readonly Sha256[]
  readonly temporaryFiles: readonly OwnedTemporaryFile[]
}

function safePrefix(entry: {
  isSymbolicLink(): boolean
  isDirectory(): boolean
  name: string
}): boolean {
  return !entry.isSymbolicLink() && entry.isDirectory() && /^[a-f\d]{2}$/u.test(entry.name)
}

function isIdentity(
  entry: { isSymbolicLink(): boolean; isFile(): boolean; name: string },
  prefix: string,
) {
  return (
    !entry.isSymbolicLink() && entry.isFile() && /^[a-f\d]{64}$/u.test(`${prefix}${entry.name}`)
  )
}

function isOwnedTemporary(entry: {
  isSymbolicLink(): boolean
  isFile(): boolean
  name: string
}): boolean {
  return (
    !entry.isSymbolicLink() &&
    entry.isFile() &&
    /^[a-f\d]{62}\.[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\.tmp$/u.test(
      entry.name,
    )
  )
}

async function scanPrefix(prefix: string, directory: string): Promise<Result<ArtifactInventory>> {
  const identities: Sha256[] = []
  const temporaryFiles: OwnedTemporaryFile[] = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (isOwnedTemporary(entry)) {
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        return err(CORRUPT_ARTIFACT, 'Artifact temporary entry changed during inspection.')
      }
      temporaryFiles.push({ path, mtimeMs: metadata.mtimeMs })
      continue
    }
    if (!isIdentity(entry, prefix)) {
      return err(CORRUPT_ARTIFACT, 'Artifact store contains an unexpected path.')
    }
    identities.push(`sha256:${prefix}${entry.name}`)
  }
  return ok({ identities, temporaryFiles })
}

export async function scanArtifactInventory(
  algorithmRoot: string,
): Promise<Result<ArtifactInventory>> {
  const identities: Sha256[] = []
  const temporaryFiles: OwnedTemporaryFile[] = []
  const prefixes = await readdir(algorithmRoot, { withFileTypes: true })
  if (prefixes.length > 256) {
    return err(CORRUPT_ARTIFACT, 'Artifact store contains too many hash prefixes.')
  }
  for (const prefix of prefixes) {
    if (!safePrefix(prefix)) {
      return err(CORRUPT_ARTIFACT, 'Artifact store contains an unexpected path.')
    }
    const directory = join(algorithmRoot, prefix.name)
    const scanned = await scanPrefix(prefix.name, directory)
    if (!scanned.ok) return scanned
    const total =
      identities.length +
      temporaryFiles.length +
      scanned.value.identities.length +
      scanned.value.temporaryFiles.length
    if (total > MAX_STORE_ENTRIES) {
      return err(CORRUPT_ARTIFACT, 'Artifact store contains too many entries.')
    }
    identities.push(...scanned.value.identities)
    temporaryFiles.push(...scanned.value.temporaryFiles)
  }
  return ok({ identities: identities.sort(), temporaryFiles })
}
