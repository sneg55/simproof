import { randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { ArtifactStore } from './artifact-store.js'
import {
  type BackupManifest,
  CURRENT_SCHEMA_VERSION,
  MAX_BACKUP_BYTES,
  MAX_MANIFEST_BYTES,
  parseManifest,
  readBounded,
  sha256,
} from './backup-manifest.js'
import { validateBackupSessionAbsence } from './backup-session-sanitizer.js'
import { createPersistence, type PersistenceDatabase } from './database.js'
import { validateOperationPath } from './path-scope.js'
import { err, ok, type Result } from './types.js'

const INVALID_BACKUP = 'invalid-backup'
const UNEXPECTED_ENTRIES = 'Backup contains unexpected entries.'
const ARTIFACTS_DIRECTORY = 'artifacts'
const MANIFEST_FILE = 'manifest.json'
const DATABASE_FILE = 'metadata.sqlite'

async function absent(path: string): Promise<boolean> {
  return await lstat(path).then(
    () => false,
    (error: unknown) =>
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT',
  )
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join('\0') === [...right].sort().join('\0')
}

async function inspectBackup(backup: string): Promise<Result<BackupManifest>> {
  const entries = await readdir(backup, { withFileTypes: true })
  if (entries.length !== 3 || entries.some((entry) => entry.isSymbolicLink())) {
    return err(INVALID_BACKUP, UNEXPECTED_ENTRIES)
  }
  const artifacts = entries.find((entry) => entry.name === ARTIFACTS_DIRECTORY)
  const manifestFile = entries.find((entry) => entry.name === MANIFEST_FILE)
  const databaseFile = entries.find((entry) => entry.name === DATABASE_FILE)
  if (!artifacts?.isDirectory() || !manifestFile?.isFile() || !databaseFile?.isFile()) {
    return err(INVALID_BACKUP, UNEXPECTED_ENTRIES)
  }
  const manifestBytes = await readBounded(join(backup, MANIFEST_FILE), MAX_MANIFEST_BYTES)
  const manifest = parseManifest(JSON.parse(manifestBytes.toString('utf8')))
  if (!manifest.ok) return manifest
  if (manifest.value.database.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return err(INVALID_BACKUP, 'Backup database schema version is unsupported.')
  }
  const databaseBytes = await readBounded(join(backup, DATABASE_FILE), MAX_BACKUP_BYTES)
  if (
    databaseBytes.byteLength !== manifest.value.database.byteLength ||
    sha256(databaseBytes) !== manifest.value.database.sha256
  ) {
    return err(INVALID_BACKUP, 'Backup database checksum is invalid.')
  }
  const sourceStore = new ArtifactStore(join(backup, ARTIFACTS_DIRECTORY))
  const identities = await sourceStore.identities()
  if (
    !identities.ok ||
    !sameSet(
      identities.value,
      manifest.value.artifacts.map(({ hash }) => hash),
    )
  ) {
    return err(INVALID_BACKUP, 'Backup artifact set is invalid.')
  }
  return manifest
}

async function copyArtifacts(
  backup: string,
  staging: string,
  manifest: BackupManifest,
): Promise<Result<ArtifactStore>> {
  const source = new ArtifactStore(join(backup, ARTIFACTS_DIRECTORY))
  const destination = new ArtifactStore(join(staging, ARTIFACTS_DIRECTORY))
  for (const artifact of manifest.artifacts) {
    const content = await source.get(artifact.hash)
    if (!content.ok || content.value.byteLength !== artifact.byteLength) {
      return err(INVALID_BACKUP, 'Backup artifact is invalid.')
    }
    const stored = await destination.restore(content.value, artifact.hash)
    if (!stored.ok) return stored
  }
  return ok(destination)
}

async function validateRestored(
  database: PersistenceDatabase,
  store: ArtifactStore,
  manifest: BackupManifest,
): Promise<Result<true>> {
  const currentSchema = database.validateCurrentSchema()
  const formats = database.records.storedArtifactFormats()
  const records = await database.validateStoredRecords(store)
  if (!currentSchema.ok) return err(INVALID_BACKUP, 'Restored migration journal is invalid.')
  if (!records.ok) return err(INVALID_BACKUP, 'Restored runtime records are invalid.')
  if (!formats.ok || !formatsMatch(formats.value, manifest.artifacts)) {
    return err(INVALID_BACKUP, 'Restored artifact format metadata is invalid.')
  }
  return ok(true)
}

function formatsMatch(
  formats: readonly {
    hash: string
    roles: readonly string[]
    normalizationVersions: readonly number[]
  }[],
  artifacts: BackupManifest['artifacts'],
): boolean {
  if (formats.length !== artifacts.length) return false
  return formats.every((format) => {
    const expected = artifacts.find(({ hash }) => hash === format.hash)
    return (
      expected !== undefined &&
      sameSet(format.roles, expected.roles) &&
      sameSet(format.normalizationVersions.map(String), expected.normalizationVersions.map(String))
    )
  })
}

export async function restorePersistence(input: {
  backup: string
  destination: string
  operationRoot?: string
}): Promise<Result<{ readonly artifactCount: number }>> {
  const scopedBackup = await validateOperationPath(input.operationRoot, input.backup)
  if (!scopedBackup.ok) return scopedBackup
  const scopedDestination = await validateOperationPath(input.operationRoot, input.destination)
  if (!scopedDestination.ok) return scopedDestination
  if (!(await absent(input.destination))) {
    return err('conflict', 'Restore destination must not exist.')
  }
  const staging = `${input.destination}.staging-${randomUUID()}`
  let database: PersistenceDatabase | undefined
  try {
    const manifest = await inspectBackup(input.backup)
    if (!manifest.ok) return manifest
    await mkdir(staging, { recursive: false, mode: 0o700 })
    await copyFile(join(input.backup, DATABASE_FILE), join(staging, DATABASE_FILE))
    const copiedDatabase = await readBounded(join(staging, DATABASE_FILE), MAX_BACKUP_BYTES)
    if (sha256(copiedDatabase) !== manifest.value.database.sha256) {
      return err(INVALID_BACKUP, 'Copied backup database checksum is invalid.')
    }
    const sessions = validateBackupSessionAbsence(join(staging, DATABASE_FILE))
    if (!sessions.ok) {
      return err(INVALID_BACKUP, 'Backup must not contain administrator sessions.')
    }
    const store = await copyArtifacts(input.backup, staging, manifest.value)
    if (!store.ok) return store
    database = createPersistence(join(staging, DATABASE_FILE))
    const validation = await validateRestored(database, store.value, manifest.value)
    if (!validation.ok) return validation
    database.close()
    database = undefined
    if (!(await absent(input.destination))) {
      return err('conflict', 'Restore destination appeared concurrently.')
    }
    await mkdir(dirname(input.destination), { recursive: true })
    await rename(staging, input.destination)
    return ok({ artifactCount: manifest.value.artifacts.length })
  } catch {
    return err(INVALID_BACKUP, 'Restore operation failed.')
  } finally {
    database?.close()
    await rm(staging, { force: true, recursive: true }).catch(() => undefined)
  }
}
