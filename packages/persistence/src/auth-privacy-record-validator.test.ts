import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { validateAuthAndPrivacyRecords } from './auth-privacy-record-validator.js'
import { fixture, NOW } from './test-helpers.js'

const LATER = '2026-07-16T17:00:00.000Z'

async function populated(name: string) {
  const context = await fixture(`record-validator-${name}`)
  const database = new DatabaseSync(context.database.path, { enableForeignKeyConstraints: false })
  database.exec('PRAGMA ignore_check_constraints=ON')
  database.prepare('INSERT INTO auth_bootstrap(singleton,completed_at) VALUES (1,?)').run(NOW)
  database
    .prepare(`INSERT INTO local_administrator(
      singleton,password_hash,password_salt,password_hash_version,scrypt_cost,scrypt_block_size,
      scrypt_parallelization,scrypt_key_length,credential_version,created_at,updated_at
    ) VALUES (1,?,?,1,16384,8,1,32,1,?,?)`)
    .run('a'.repeat(64), 'b'.repeat(22), NOW, NOW)
  database
    .prepare(`INSERT INTO administrator_sessions(
      id,administrator_id,token_hash,csrf_hash,credential_version,created_at,last_activity_at,
      expires_at,rotated_from_id,revoked_at
    ) VALUES ('session',1,?,?,1,?,?,?,NULL,NULL)`)
    .run('c'.repeat(64), 'd'.repeat(64), NOW, NOW, LATER)
  return { context, database }
}

describe('authentication and privacy restore record validation', () => {
  it.each([
    {
      name: 'administrator timestamp ordering',
      mutate: (database: DatabaseSync) =>
        database
          .prepare('UPDATE local_administrator SET updated_at=?')
          .run('2026-07-16T11:59:59.999Z'),
    },
    {
      name: 'session administrator and credential relationships',
      mutate: (database: DatabaseSync) => {
        database.exec('DROP TRIGGER immutable_session_identity')
        database
          .prepare('UPDATE administrator_sessions SET administrator_id=2,credential_version=0')
          .run()
      },
    },
    {
      name: 'unrevoked session on an older credential version',
      mutate: (database: DatabaseSync) =>
        database.prepare('UPDATE local_administrator SET credential_version=2').run(),
    },
    {
      name: 'session activity and revocation ordering',
      mutate: (database: DatabaseSync) => {
        database.exec('DROP TRIGGER monotonic_session_activity')
        database
          .prepare('UPDATE administrator_sessions SET last_activity_at=?,revoked_at=?')
          .run(LATER, '2026-07-16T15:59:59.999Z')
      },
    },
    {
      name: 'session rotation ancestry',
      mutate: (database: DatabaseSync) => {
        database.exec('DROP TRIGGER immutable_session_identity')
        database.exec('DROP TRIGGER restrict_session_rotation_update')
        database.prepare("UPDATE administrator_sessions SET rotated_from_id='missing'").run()
      },
    },
    {
      name: 'privacy booleans and revision',
      mutate: (database: DatabaseSync) =>
        database
          .prepare(
            'UPDATE privacy_settings SET prompt_retention_enabled=2,external_diagnostics_enabled=-1,revision=-1',
          )
          .run(),
    },
  ])('rejects $name independently of SQLite constraints', async ({ name, mutate }) => {
    const { context, database } = await populated(name.replaceAll(' ', '-'))
    try {
      mutate(database)
      expect(() => validateAuthAndPrivacyRecords(database)).toThrow()
    } finally {
      database.close()
      await context.cleanup()
    }
  })
})
