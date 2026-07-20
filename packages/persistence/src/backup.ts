import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { ArtifactStore } from './artifact-store.js'
import {
  type BackupManifest,
  CURRENT_SCHEMA_VERSION,
  MAX_BACKUP_ARTIFACTS,
  MAX_BACKUP_BYTES,
  MAX_MANIFEST_BYTES,
  parseManifest,
  readBounded,
  sha256,
} from './backup-manifest.js'
import { removeSessionsFromBackupSnapshot } from './backup-session-sanitizer.js'
import { createPersistence, type PersistenceDatabase } from './database.js'
import { validateOperationPath } from './path-scope.js'
import { err, ok, type Result } from './types.js'

export type { BackupManifest } from './backup-manifest.js'
export { restorePersistence } from './restore.js'

const INVALID_BACKUP = 'invalid-backup'
const failure = () => err(INVALID_BACKUP, 'Backup operation failed.')

export interface BackupLimits {
  readonly maxArtifacts: number
  readonly maxDatabaseBytes: number
  readonly maxTotalBytes: number
}

export interface BackupDurability {
  syncFile(path: string): Promise<void>
  syncDirectory(path: string): Promise<void>
}

export interface BackupInput {
  readonly database: PersistenceDatabase
  readonly artifacts: ArtifactStore
  readonly destination: string
  readonly createdAt: string
  readonly operationRoot?: string
  readonly limits?: BackupLimits
  readonly durability?: BackupDurability
}

const DEFAULT_LIMITS: BackupLimits = {
  maxArtifacts: MAX_BACKUP_ARTIFACTS,
  maxDatabaseBytes: MAX_BACKUP_BYTES,
  maxTotalBytes: MAX_BACKUP_BYTES,
}

const DEFAULT_DURABILITY: BackupDurability = {
  async syncFile(path) {
    const handle = await open(path, constants.O_RDONLY)
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
  async syncDirectory(path) {
    const handle = await open(path, constants.O_RDONLY)
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
}

async function absent(path: string): Promise<boolean> {
  return await lstat(path).then(
    () => false,
    (error: unknown) =>
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT',
  )
}

export async function backupPersistence(input: BackupInput): Promise<Result<BackupManifest>> {
  return await input.database.withBackupLock(() => createBackup(input))
}

async function createBackup(input: BackupInput): Promise<Result<BackupManifest>> {
  if (!Number.isFinite(Date.parse(input.createdAt))) {
    return err(INVALID_BACKUP, 'Backup creation date is invalid.')
  }
  const limits = input.limits ?? DEFAULT_LIMITS
  if (!validLimits(limits)) return err(INVALID_BACKUP, 'Backup limits are invalid.')
  const scoped = await validateOperationPath(input.operationRoot, input.destination)
  if (!scoped.ok) return scoped
  if (!(await absent(input.destination))) {
    return err('conflict', 'Backup destination already exists.')
  }
  const staging = `${input.destination}.staging-${randomUUID()}`
  const durability = input.durability ?? DEFAULT_DURABILITY
  let snapshot: PersistenceDatabase | undefined
  let published = false
  let succeeded = false
  try {
    await mkdir(staging, { recursive: false, mode: 0o700 })
    const snapshotPath = join(staging, 'metadata.sqlite')
    await input.database.snapshot(snapshotPath)
    snapshot = createPersistence(snapshotPath)
    const prepared = await prepareSnapshot(snapshot, input.artifacts, staging, limits)
    if (!prepared.ok) return prepared
    snapshot.close()
    snapshot = undefined
    const databaseBytes = await readBounded(snapshotPath, limits.maxDatabaseBytes)
    const manifest: BackupManifest = {
      schemaVersion: '1',
      createdAt: input.createdAt,
      database: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        sha256: sha256(databaseBytes),
        byteLength: databaseBytes.byteLength,
      },
      artifacts: prepared.value,
    }
    const validated = validateManifestWithinLimits(manifest, limits)
    if (!validated.ok) return validated
    const manifestBytes = Buffer.from(JSON.stringify(manifest))
    if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
      return err(INVALID_BACKUP, 'Backup manifest exceeds its size limit.')
    }
    const manifestPath = join(staging, 'manifest.json')
    await writeFile(manifestPath, manifestBytes, {
      flag: 'wx',
      mode: 0o600,
    })
    await durability.syncFile(snapshotPath)
    await durability.syncFile(manifestPath)
    await syncBackupDirectories(staging, durability)
    if (!(await absent(input.destination))) {
      return err('conflict', 'Backup destination appeared concurrently.')
    }
    const destinationParent = dirname(input.destination)
    await mkdir(destinationParent, { recursive: true })
    await durability.syncDirectory(destinationParent)
    await rename(staging, input.destination)
    published = true
    await durability.syncDirectory(destinationParent)
    succeeded = true
    return ok(manifest)
  } catch {
    return failure()
  } finally {
    snapshot?.close()
    if (published && !succeeded) {
      await rm(input.destination, { force: true, recursive: true }).catch(() => undefined)
    }
    await rm(staging, { force: true, recursive: true }).catch(() => undefined)
  }
}

function validLimits(limits: BackupLimits): boolean {
  return (
    Number.isSafeInteger(limits.maxArtifacts) &&
    limits.maxArtifacts >= 0 &&
    limits.maxArtifacts <= MAX_BACKUP_ARTIFACTS &&
    Number.isSafeInteger(limits.maxDatabaseBytes) &&
    limits.maxDatabaseBytes >= 1 &&
    limits.maxDatabaseBytes <= MAX_BACKUP_BYTES &&
    Number.isSafeInteger(limits.maxTotalBytes) &&
    limits.maxTotalBytes >= 0 &&
    limits.maxTotalBytes <= MAX_BACKUP_BYTES
  )
}

function validateManifestWithinLimits(
  manifest: BackupManifest,
  limits: BackupLimits,
): Result<BackupManifest> {
  const parsed = parseManifest(manifest)
  if (!parsed.ok) return parsed
  const artifactBytes = manifest.artifacts.reduce((sum, artifact) => sum + artifact.byteLength, 0)
  if (
    manifest.artifacts.length > limits.maxArtifacts ||
    manifest.database.byteLength > limits.maxDatabaseBytes ||
    artifactBytes > limits.maxTotalBytes
  ) {
    return err(INVALID_BACKUP, 'Backup exceeds its configured limits.')
  }
  return parsed
}

async function syncBackupDirectories(staging: string, durability: BackupDurability): Promise<void> {
  const artifacts = join(staging, 'artifacts')
  const algorithm = join(artifacts, 'sha256')
  const prefixes = await readdir(algorithm, { withFileTypes: true })
  for (const prefix of prefixes) {
    if (prefix.isDirectory() && !prefix.isSymbolicLink()) {
      await durability.syncDirectory(join(algorithm, prefix.name))
    }
  }
  await durability.syncDirectory(algorithm)
  await durability.syncDirectory(artifacts)
  await durability.syncDirectory(staging)
}

async function prepareSnapshot(
  snapshot: PersistenceDatabase,
  sourceStore: ArtifactStore,
  staging: string,
  limits: BackupLimits,
): Promise<Result<BackupManifest['artifacts']>> {
  const migrations = snapshot.migrate()
  if (!migrations.ok) return migrations
  const sessions = removeSessionsFromBackupSnapshot(snapshot.path)
  if (!sessions.ok) return sessions
  const formats = snapshot.records.storedArtifactFormats()
  const integrity = snapshot.integrityCheck()
  if (!formats.ok) return formats
  if (!integrity.ok) return integrity
  if (formats.value.length > limits.maxArtifacts) {
    return err(INVALID_BACKUP, 'Backup contains too many artifacts.')
  }
  const records = await snapshot.validateStoredRecords(sourceStore)
  if (!records.ok) return records
  const destinationStore = new ArtifactStore(join(staging, 'artifacts'))
  const initialized = await destinationStore.identities()
  if (!initialized.ok) return initialized
  const artifacts: BackupManifest['artifacts'][number][] = []
  let totalBytes = 0
  for (const { hash } of formats.value) {
    const copied = await copyArtifact(hash, formats.value, sourceStore, destinationStore)
    if (!copied.ok) return copied
    totalBytes += copied.value.byteLength
    if (totalBytes > limits.maxTotalBytes) {
      return err(INVALID_BACKUP, 'Backup artifacts exceed their total size limit.')
    }
    artifacts.push(copied.value)
  }
  return ok(artifacts)
}

async function copyArtifact(
  hash: BackupManifest['artifacts'][number]['hash'],
  formats: readonly {
    hash: BackupManifest['artifacts'][number]['hash']
    roles: readonly string[]
    normalizationVersions: readonly number[]
  }[],
  source: ArtifactStore,
  destination: ArtifactStore,
): Promise<Result<BackupManifest['artifacts'][number]>> {
  const content = await source.get(hash)
  if (!content.ok) return content
  const stored = await destination.restore(content.value, hash)
  if (!stored.ok) return stored
  const format = formats.find((candidate) => candidate.hash === hash)
  if (format === undefined) return err(INVALID_BACKUP, 'Referenced artifact format is missing.')
  return ok({
    hash,
    archiveSha256: hash.slice(7),
    byteLength: content.value.byteLength,
    roles: format.roles,
    normalizationVersions: format.normalizationVersions,
  })
}
