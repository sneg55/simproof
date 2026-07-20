import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

import type { PasswordCredential } from '@simproof/persistence'

const SCRYPT_COST = 16_384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1
const SCRYPT_KEY_LENGTH = 32
const SCRYPT_MAX_MEMORY = 32 * 1_024 * 1_024
const MIN_PASSWORD_BYTES = 12
const MAX_PASSWORD_BYTES = 1_024

function validPassword(password: string, minimumBytes: number): boolean {
  const bytes = Buffer.byteLength(password, 'utf8')
  return bytes >= minimumBytes && bytes <= MAX_PASSWORD_BYTES && !password.includes('\0')
}

function validCredential(credential: PasswordCredential): boolean {
  return (
    /^[\da-f]{64}$/u.test(credential.passwordHash) &&
    /^[\w-]{22}$/u.test(credential.passwordSalt) &&
    credential.passwordHashVersion === 1 &&
    credential.scryptCost === SCRYPT_COST &&
    credential.scryptBlockSize === SCRYPT_BLOCK_SIZE &&
    credential.scryptParallelization === SCRYPT_PARALLELIZATION &&
    credential.scryptKeyLength === SCRYPT_KEY_LENGTH
  )
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, key) => (error === null ? resolve(key) : reject(error)),
    )
  })
}

export async function hashPassword(password: string): Promise<PasswordCredential> {
  if (!validPassword(password, MIN_PASSWORD_BYTES)) {
    throw new TypeError('Password input is invalid.')
  }
  const salt = randomBytes(16)
  const passwordHash = await derive(password, salt)
  return {
    passwordHash: passwordHash.toString('hex'),
    passwordSalt: salt.toString('base64url'),
    passwordHashVersion: 1,
    scryptCost: SCRYPT_COST,
    scryptBlockSize: SCRYPT_BLOCK_SIZE,
    scryptParallelization: SCRYPT_PARALLELIZATION,
    scryptKeyLength: SCRYPT_KEY_LENGTH,
  }
}

export async function verifyPassword(
  password: string,
  credential: PasswordCredential,
): Promise<boolean> {
  if (!validPassword(password, 1) || !validCredential(credential)) return false
  try {
    const expected = Buffer.from(credential.passwordHash, 'hex')
    const actual = await derive(password, Buffer.from(credential.passwordSalt, 'base64url'))
    return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
