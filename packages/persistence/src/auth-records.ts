const HASH_PATTERN = /^[\da-f]{64}$/u

export interface PasswordCredential {
  readonly passwordHash: string
  readonly passwordSalt: string
  readonly passwordHashVersion: number
  readonly scryptCost: number
  readonly scryptBlockSize: number
  readonly scryptParallelization: number
  readonly scryptKeyLength: number
}

export interface AdministratorRecord extends PasswordCredential {
  readonly credentialVersion: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AdministratorSessionRecord {
  readonly id: string
  readonly tokenHash: string
  readonly csrfHash: string
  readonly credentialVersion: number
  readonly createdAt: string
  readonly lastActivityAt: string
  readonly expiresAt: string
  readonly rotatedFromId: string | null
  readonly revokedAt: string | null
}

export type SessionInput = Omit<AdministratorSessionRecord, 'lastActivityAt' | 'revokedAt'>

export function validHash(value: string): boolean {
  return HASH_PATTERN.test(value)
}

export function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

export function validCredential(value: PasswordCredential): boolean {
  return (
    validHash(value.passwordHash) &&
    /^[\w-]{16,128}$/u.test(value.passwordSalt) &&
    value.passwordHashVersion === 1 &&
    value.scryptCost === 16_384 &&
    value.scryptBlockSize === 8 &&
    value.scryptParallelization === 1 &&
    value.scryptKeyLength === 32
  )
}

export function validSession(value: SessionInput): boolean {
  return (
    value.id.length > 0 &&
    value.id.length <= 128 &&
    validHash(value.tokenHash) &&
    validHash(value.csrfHash) &&
    Number.isSafeInteger(value.credentialVersion) &&
    value.credentialVersion > 0 &&
    validTimestamp(value.createdAt) &&
    validTimestamp(value.expiresAt) &&
    value.expiresAt > value.createdAt &&
    (value.rotatedFromId === null ||
      (value.rotatedFromId.length > 0 && value.rotatedFromId.length <= 128))
  )
}

export function validAdministratorRecord(value: AdministratorRecord): boolean {
  return (
    validCredential(value) &&
    Number.isSafeInteger(value.credentialVersion) &&
    value.credentialVersion > 0 &&
    validTimestamp(value.createdAt) &&
    validTimestamp(value.updatedAt) &&
    value.updatedAt >= value.createdAt
  )
}

export function validSessionRecord(value: AdministratorSessionRecord): boolean {
  return (
    validSession(value) &&
    validTimestamp(value.lastActivityAt) &&
    value.lastActivityAt >= value.createdAt &&
    value.lastActivityAt < value.expiresAt &&
    (value.revokedAt === null ||
      (validTimestamp(value.revokedAt) && value.revokedAt >= value.createdAt))
  )
}

export function decodeAdministrator(row: Record<string, unknown>): AdministratorRecord {
  return {
    passwordHash: String(row.password_hash),
    passwordSalt: String(row.password_salt),
    passwordHashVersion: Number(row.password_hash_version),
    scryptCost: Number(row.scrypt_cost),
    scryptBlockSize: Number(row.scrypt_block_size),
    scryptParallelization: Number(row.scrypt_parallelization),
    scryptKeyLength: Number(row.scrypt_key_length),
    credentialVersion: Number(row.credential_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export function decodeSession(row: Record<string, unknown>): AdministratorSessionRecord {
  return {
    id: String(row.id),
    tokenHash: String(row.token_hash),
    csrfHash: String(row.csrf_hash),
    credentialVersion: Number(row.credential_version),
    createdAt: String(row.created_at),
    lastActivityAt: String(row.last_activity_at),
    expiresAt: String(row.expires_at),
    rotatedFromId: nullableText(row.rotated_from_id),
    revokedAt: nullableText(row.revoked_at),
  }
}

function nullableText(value: unknown): string | null {
  if (value === null) return null
  return typeof value === 'string' ? value : ''
}
