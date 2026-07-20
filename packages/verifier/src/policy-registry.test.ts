import { describe, expect, it } from 'vitest'

import { PENDULUM_POLICY } from './domains/pendulum/index.js'
import { PROJECTILE_POLICY } from './domains/projectile/index.js'
import { createPolicyRegistry } from './policy-registry.js'

describe('trusted policy registry', () => {
  it('parses, hashes, and deeply freezes application-owned policies', () => {
    const registry = createPolicyRegistry()
    const result = registry.register(PROJECTILE_POLICY)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.policy.domain).toBe('projectile')
    if (result.value.policy.domain !== 'projectile') return
    expect(result.value.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(Object.isFrozen(result.value.policy)).toBe(true)
    expect(Object.isFrozen(result.value.policy.applicability)).toBe(true)
    expect(Reflect.set(result.value.policy.applicability.initialSpeedMps, 'min', 0)).toBe(false)
    expect(result.value.policy.applicability.initialSpeedMps.min).toBe(15)
  })

  it('rejects changed content reused under the same policy ID and version', () => {
    const registry = createPolicyRegistry()
    expect(registry.register(PROJECTILE_POLICY).ok).toBe(true)

    const changed = {
      ...PROJECTILE_POLICY,
      tolerances: {
        ...PROJECTILE_POLICY.tolerances,
        rangeM: { mode: 'relative' as const, relative: 0.02 },
      },
    }
    expect(registry.register(changed)).toEqual({
      ok: false,
      error: {
        id: 'policy.version-collision',
        message: 'Policy projectile-vacuum-level-earth@1.1.0 has conflicting content.',
      },
    })
  })

  it('registers each supported domain independently', () => {
    const registry = createPolicyRegistry()

    expect(registry.register(PROJECTILE_POLICY).ok).toBe(true)
    expect(registry.register(PENDULUM_POLICY).ok).toBe(true)
    expect(registry.get('pendulum.small-angle', '1.0.0')?.policy.domain).toBe('pendulum')
  })
})
