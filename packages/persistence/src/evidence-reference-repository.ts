import type { DatabaseSync } from 'node:sqlite'

import {
  type DomainPackReference,
  domainPackReferenceSchema,
  type VerificationPolicyReference,
  verificationPolicyReferenceSchema,
} from '@simproof/contracts'

import { sqliteFailure, transaction } from './sqlite.js'
import { err, ok, type Result } from './types.js'

const INVALID_INPUT = 'invalid-input'

export class EvidenceReferenceRepository {
  constructor(
    readonly database: DatabaseSync,
    readonly canWrite: () => boolean,
  ) {}

  insertPolicy(input: unknown): Result<VerificationPolicyReference> {
    const parsed = verificationPolicyReferenceSchema.safeParse(input)
    if (!parsed.success) return err(INVALID_INPUT, 'Policy reference is invalid.')
    return this.#insertPolicy(parsed.data)
  }

  ensurePolicy(input: unknown): Result<VerificationPolicyReference> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    const parsed = verificationPolicyReferenceSchema.safeParse(input)
    if (!parsed.success) return err(INVALID_INPUT, 'Policy reference is invalid.')
    return transaction(this.database, () => {
      const existing = this.database
        .prepare(`SELECT id,policy_id,version,content_hash,created_at
          FROM verification_policy_references WHERE policy_id=? AND version=? AND content_hash=?`)
        .get(parsed.data.policyId, parsed.data.version, parsed.data.contentHash) as
        | Record<string, unknown>
        | undefined
      return existing === undefined ? this.#insertPolicy(parsed.data) : decodePolicy(existing)
    })
  }

  insertDomainPack(input: unknown): Result<DomainPackReference> {
    const parsed = domainPackReferenceSchema.safeParse(input)
    if (!parsed.success) return err(INVALID_INPUT, 'Domain-pack reference is invalid.')
    return this.#insertDomainPack(parsed.data)
  }

  ensureDomainPack(input: unknown): Result<DomainPackReference> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    const parsed = domainPackReferenceSchema.safeParse(input)
    if (!parsed.success) return err(INVALID_INPUT, 'Domain-pack reference is invalid.')
    return transaction(this.database, () => {
      const existing = this.database
        .prepare(`SELECT id,domain_pack_id,version,content_hash,created_at
          FROM domain_pack_references
          WHERE domain_pack_id=? AND version=? AND content_hash=?`)
        .get(parsed.data.domainPackId, parsed.data.version, parsed.data.contentHash) as
        | Record<string, unknown>
        | undefined
      return existing === undefined
        ? this.#insertDomainPack(parsed.data)
        : decodeDomainPack(existing)
    })
  }

  #insertPolicy(value: VerificationPolicyReference): Result<VerificationPolicyReference> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    try {
      this.database
        .prepare(`INSERT INTO verification_policy_references(
          id,policy_id,version,content_hash,created_at
        ) VALUES (?,?,?,?,?)`)
        .run(value.id, value.policyId, value.version, value.contentHash, value.createdAt)
      return ok(value)
    } catch (error) {
      return sqliteFailure(error)
    }
  }

  #insertDomainPack(value: DomainPackReference): Result<DomainPackReference> {
    if (!this.canWrite()) return err('conflict', 'Persistence maintenance is active.')
    try {
      this.database
        .prepare(`INSERT INTO domain_pack_references(
          id,domain_pack_id,version,content_hash,created_at
        ) VALUES (?,?,?,?,?)`)
        .run(value.id, value.domainPackId, value.version, value.contentHash, value.createdAt)
      return ok(value)
    } catch (error) {
      return sqliteFailure(error)
    }
  }
}

function decodePolicy(row: Record<string, unknown>): Result<VerificationPolicyReference> {
  const parsed = verificationPolicyReferenceSchema.safeParse({
    id: row.id,
    policyId: row.policy_id,
    version: row.version,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  })
  return parsed.success
    ? ok(parsed.data)
    : err('database-error', 'Stored policy reference is invalid.')
}

function decodeDomainPack(row: Record<string, unknown>): Result<DomainPackReference> {
  const parsed = domainPackReferenceSchema.safeParse({
    id: row.id,
    domainPackId: row.domain_pack_id,
    version: row.version,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  })
  return parsed.success
    ? ok(parsed.data)
    : err('database-error', 'Stored domain-pack reference is invalid.')
}
