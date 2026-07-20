import { describe, expect, it } from 'vitest'

import { hashPassword, verifyPassword } from './password.js'

describe('administrator password hashing', () => {
  it('uses randomized, versioned, bounded scrypt credentials and constant-time verification', async () => {
    const first = await hashPassword('correct horse battery staple')
    const second = await hashPassword('correct horse battery staple')
    expect(first).toMatchObject({
      passwordHashVersion: 1,
      scryptCost: 16_384,
      scryptBlockSize: 8,
      scryptParallelization: 1,
      scryptKeyLength: 32,
    })
    expect(first.passwordSalt).not.toBe(second.passwordSalt)
    expect(first.passwordHash).not.toBe(second.passwordHash)
    await expect(verifyPassword('correct horse battery staple', first)).resolves.toBe(true)
    await expect(verifyPassword('incorrect password', first)).resolves.toBe(false)
    await expect(
      verifyPassword('correct horse battery staple', { ...first, scryptCost: 1_073_741_824 }),
    ).resolves.toBe(false)
  })

  it('rejects passwords outside the accepted byte boundary', async () => {
    await expect(hashPassword('short')).rejects.toThrow('Password input is invalid.')
    await expect(hashPassword('a'.repeat(1_025))).rejects.toThrow('Password input is invalid.')
    await expect(hashPassword('é'.repeat(512))).resolves.toMatchObject({ passwordHashVersion: 1 })
    await expect(hashPassword('é'.repeat(513))).rejects.toThrow('Password input is invalid.')
  })
})
