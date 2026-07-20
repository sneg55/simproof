import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'

import { MIGRATIONS } from './migrations.js'
import { err, ok, type Result, type Sha256 } from './types.js'

export const MAX_BACKUP_ARTIFACTS = 100_000
export const MAX_BACKUP_BYTES = 1_073_741_824
export const MAX_MANIFEST_BYTES = 16_777_216
export const CURRENT_SCHEMA_VERSION = Math.max(...MIGRATIONS.map(({ version }) => version))
const INVALID_BACKUP = 'invalid-backup'

export interface BackupArtifactEntry {
  readonly hash: Sha256
  readonly archiveSha256: string
  readonly byteLength: number
  readonly roles: readonly string[]
  readonly normalizationVersions: readonly number[]
}

export interface BackupManifest {
  readonly schemaVersion: '1'
  readonly createdAt: string
  readonly database: {
    readonly schemaVersion: number
    readonly sha256: string
    readonly byteLength: number
  }
  readonly artifacts: readonly BackupArtifactEntry[]
}

export const sha256 = (content: Uint8Array) => createHash('sha256').update(content).digest('hex')

export async function readBounded(path: string, maximumBytes: number): Promise<Buffer> {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximumBytes) {
    throw new TypeError('Backup file exceeds its allowed physical size.')
  }
  const content = await readFile(path)
  if (content.byteLength > maximumBytes) throw new TypeError('Backup file exceeds its limit.')
  return content
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === expected.join('\0')
}

const validRoles = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 6 &&
  value.every((role) => typeof role === 'string')

const validVersions = (value: unknown): value is readonly number[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 6 &&
  value.every((version) => version === 1)

function validArtifact(value: unknown): value is BackupArtifactEntry {
  if (typeof value !== 'object' || value === null) return false
  const artifact = value as Record<string, unknown>
  if (
    !exactKeys(artifact, [
      'archiveSha256',
      'byteLength',
      'hash',
      'normalizationVersions',
      'roles',
    ]) ||
    typeof artifact.hash !== 'string' ||
    !/^sha256:[a-f\d]{64}$/u.test(artifact.hash) ||
    typeof artifact.archiveSha256 !== 'string' ||
    artifact.archiveSha256 !== artifact.hash.slice(7) ||
    !Number.isSafeInteger(artifact.byteLength) ||
    Number(artifact.byteLength) < 1
  ) {
    return false
  }
  return validRoles(artifact.roles) && validVersions(artifact.normalizationVersions)
}

function validDatabase(value: unknown): value is BackupManifest['database'] {
  if (typeof value !== 'object' || value === null) return false
  const database = value as Record<string, unknown>
  return (
    exactKeys(database, ['byteLength', 'schemaVersion', 'sha256']) &&
    typeof database.sha256 === 'string' &&
    /^[a-f\d]{64}$/u.test(database.sha256) &&
    Number.isSafeInteger(database.schemaVersion) &&
    Number(database.schemaVersion) >= 1 &&
    Number.isSafeInteger(database.byteLength) &&
    Number(database.byteLength) >= 1 &&
    Number(database.byteLength) <= MAX_BACKUP_BYTES
  )
}

export function parseManifest(value: unknown): Result<BackupManifest> {
  if (typeof value !== 'object' || value === null) {
    return err(INVALID_BACKUP, 'Backup manifest is invalid.')
  }
  const candidate = value as Record<string, unknown>
  if (
    !exactKeys(candidate, ['artifacts', 'createdAt', 'database', 'schemaVersion']) ||
    candidate.schemaVersion !== '1' ||
    typeof candidate.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.createdAt)) ||
    !validDatabase(candidate.database) ||
    !Array.isArray(candidate.artifacts) ||
    candidate.artifacts.length > MAX_BACKUP_ARTIFACTS ||
    !candidate.artifacts.every(validArtifact)
  ) {
    return err(INVALID_BACKUP, 'Backup manifest is invalid.')
  }
  const artifacts = candidate.artifacts
  const hashes = new Set(artifacts.map(({ hash }) => hash))
  const totalBytes = artifacts.reduce((sum, { byteLength }) => sum + byteLength, 0)
  if (hashes.size !== artifacts.length || totalBytes > MAX_BACKUP_BYTES) {
    return err(INVALID_BACKUP, 'Backup manifest entries are invalid.')
  }
  return ok({
    schemaVersion: '1',
    createdAt: candidate.createdAt,
    database: candidate.database,
    artifacts,
  })
}
