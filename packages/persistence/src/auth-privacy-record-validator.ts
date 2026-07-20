import { Buffer } from 'node:buffer'
import type { DatabaseSync } from 'node:sqlite'

const HASH_PATTERN = /^[\da-f]{64}$/u
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value)
}

function validBooleanInteger(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1
}

export function validateAuthAndPrivacyRecords(database: DatabaseSync): void {
  const bootstrap = database.prepare('SELECT * FROM auth_bootstrap').all()
  const administrators = database.prepare('SELECT * FROM local_administrator').all() as Record<
    string,
    unknown
  >[]
  if (bootstrap.length !== administrators.length || bootstrap.length > 1) {
    throw new TypeError('Administrator bootstrap state is inconsistent.')
  }
  if (
    bootstrap.length === 1 &&
    ((bootstrap[0] as Record<string, unknown>).singleton !== 1 ||
      !validTimestamp((bootstrap[0] as Record<string, unknown>).completed_at))
  ) {
    throw new TypeError('Administrator bootstrap timestamp is invalid.')
  }
  const administrator = administrators[0]
  if (administrator !== undefined) {
    validateAdministrator(administrator)
    const completedAt = (bootstrap[0] as Record<string, unknown>).completed_at
    if (completedAt !== administrator.created_at) {
      throw new TypeError('Administrator bootstrap relationship is invalid.')
    }
  }
  validateSessions(database, administrator)
  validatePrivacy(database)
}

function validateAdministrator(row: Record<string, unknown>): void {
  if (
    row.singleton !== 1 ||
    !validHash(row.password_hash) ||
    typeof row.password_salt !== 'string' ||
    !/^[\w-]{16,128}$/u.test(row.password_salt) ||
    row.password_hash_version !== 1 ||
    row.scrypt_cost !== 16_384 ||
    row.scrypt_block_size !== 8 ||
    row.scrypt_parallelization !== 1 ||
    row.scrypt_key_length !== 32 ||
    !Number.isSafeInteger(row.credential_version) ||
    Number(row.credential_version) < 1 ||
    !validTimestamp(row.created_at) ||
    !validTimestamp(row.updated_at) ||
    String(row.updated_at) < String(row.created_at)
  ) {
    throw new TypeError('Administrator credential record is invalid.')
  }
}

function validateSessions(
  database: DatabaseSync,
  administrator: Record<string, unknown> | undefined,
): void {
  const rows = database.prepare('SELECT * FROM administrator_sessions').all() as Record<
    string,
    unknown
  >[]
  const byId = new Map(
    rows.flatMap((row) => (typeof row.id === 'string' ? [[row.id, row] as const] : [])),
  )
  for (const row of rows) {
    if (!validSessionRow(row, administrator)) {
      throw new TypeError('Administrator session record is invalid.')
    }
    validateRotation(row, byId)
  }
}

function validSessionRow(
  row: Record<string, unknown>,
  administrator: Record<string, unknown> | undefined,
): boolean {
  return (
    administrator !== undefined &&
    validSessionIdentity(row) &&
    validSessionCredential(row, administrator) &&
    validSessionTimestamps(row) &&
    validRotationIdentity(row.rotated_from_id)
  )
}

function validSessionIdentity(row: Record<string, unknown>): boolean {
  return (
    typeof row.id === 'string' &&
    row.id.length >= 1 &&
    row.id.length <= 128 &&
    row.administrator_id === 1 &&
    validHash(row.token_hash) &&
    validHash(row.csrf_hash)
  )
}

function validSessionCredential(
  row: Record<string, unknown>,
  administrator: Record<string, unknown>,
): boolean {
  return (
    Number.isSafeInteger(row.credential_version) &&
    Number(row.credential_version) >= 1 &&
    Number(row.credential_version) <= Number(administrator.credential_version) &&
    (row.revoked_at !== null || row.credential_version === administrator.credential_version)
  )
}

function validSessionTimestamps(row: Record<string, unknown>): boolean {
  if (
    !validTimestamp(row.created_at) ||
    !validTimestamp(row.last_activity_at) ||
    !validTimestamp(row.expires_at)
  ) {
    return false
  }
  return (
    row.last_activity_at >= row.created_at &&
    row.last_activity_at < row.expires_at &&
    row.expires_at > row.created_at &&
    (row.revoked_at === null ||
      (validTimestamp(row.revoked_at) && row.revoked_at >= row.created_at))
  )
}

function validRotationIdentity(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value.length >= 1 && value.length <= 128)
}

function validateRotation(
  row: Record<string, unknown>,
  byId: ReadonlyMap<string, Record<string, unknown>>,
): void {
  const rotatedFromId = row.rotated_from_id
  if (rotatedFromId === null) return
  if (typeof rotatedFromId !== 'string') {
    throw new TypeError('Administrator session rotation relationship is invalid.')
  }
  const predecessor = byId.get(rotatedFromId)
  if (
    predecessor === undefined ||
    predecessor.id === row.id ||
    predecessor.administrator_id !== row.administrator_id ||
    predecessor.credential_version !== row.credential_version ||
    predecessor.revoked_at !== row.created_at ||
    String(predecessor.created_at) > String(row.created_at)
  ) {
    throw new TypeError('Administrator session rotation relationship is invalid.')
  }
}

function validatePrivacy(database: DatabaseSync): void {
  const settings = database.prepare('SELECT * FROM privacy_settings').all() as Record<
    string,
    unknown
  >[]
  if (settings.length !== 1 || !validPrivacySettings(settings[0])) {
    throw new TypeError('Privacy settings record is invalid.')
  }
  for (const row of database.prepare('SELECT * FROM retained_prompts').all() as Record<
    string,
    unknown
  >[]) {
    if (!validRetainedPrompt(row)) {
      throw new TypeError('Retained prompt record is invalid.')
    }
  }
}

function validPrivacySettings(row: Record<string, unknown> | undefined): boolean {
  return (
    row !== undefined &&
    row.singleton === 1 &&
    validBooleanInteger(row.prompt_retention_enabled) &&
    validBooleanInteger(row.external_diagnostics_enabled) &&
    Number.isSafeInteger(row.revision) &&
    Number(row.revision) >= 0 &&
    validTimestamp(row.updated_at)
  )
}

function validRetainedPrompt(row: Record<string, unknown>): boolean {
  return (
    typeof row.id === 'string' &&
    ID_PATTERN.test(row.id) &&
    typeof row.simulation_id === 'string' &&
    ID_PATTERN.test(row.simulation_id) &&
    typeof row.prompt_text === 'string' &&
    Buffer.byteLength(row.prompt_text, 'utf8') >= 1 &&
    Buffer.byteLength(row.prompt_text, 'utf8') <= 65_536 &&
    validTimestamp(row.created_at)
  )
}
