import { type Sha256, type VerificationPolicy, verificationPolicySchema } from '@simproof/contracts'

import { hashCanonicalJson } from './hashing.js'

interface RegisteredPolicy {
  readonly policy: VerificationPolicy
  readonly contentHash: Sha256
}

interface PolicyRegistryError {
  readonly id: 'policy.invalid' | 'policy.version-collision'
  readonly message: string
}

type PolicyRegistrationResult =
  | { readonly ok: true; readonly value: RegisteredPolicy }
  | { readonly ok: false; readonly error: PolicyRegistryError }

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

const policyKey = (id: string, version: string) => `${id}@${version}`

export function createPolicyRegistry() {
  const policies = new Map<string, RegisteredPolicy>()

  return Object.freeze({
    register(input: unknown): PolicyRegistrationResult {
      const parsed = verificationPolicySchema.safeParse(input)
      if (!parsed.success) {
        return {
          ok: false,
          error: { id: 'policy.invalid', message: 'Policy content failed trusted validation.' },
        }
      }

      const contentHash = hashCanonicalJson(parsed.data)
      const key = policyKey(parsed.data.id, parsed.data.version)
      const existing = policies.get(key)
      if (existing !== undefined) {
        if (existing.contentHash === contentHash) return { ok: true, value: existing }
        return {
          ok: false,
          error: {
            id: 'policy.version-collision',
            message: `Policy ${key} has conflicting content.`,
          },
        }
      }

      const registered = Object.freeze({ policy: deepFreeze(parsed.data), contentHash })
      policies.set(key, registered)
      return { ok: true, value: registered }
    },
    get(id: string, version: string): RegisteredPolicy | undefined {
      return policies.get(policyKey(id, version))
    },
  })
}
