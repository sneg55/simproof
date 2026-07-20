import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { request } from '@playwright/test'

const authStatePath = join(process.cwd(), 'test-results', 'browser-auth.json')

export default async function globalSetup() {
  const api = await request.newContext({
    baseURL: 'http://127.0.0.1:3000',
    extraHTTPHeaders: { origin: 'http://127.0.0.1:4173' },
  })
  try {
    const capabilityResponse = await api.get('/api/bootstrap-capability')
    const capability: unknown = await capabilityResponse.json()
    if (!isBootstrapCapability(capability)) {
      throw new TypeError('Browser gate capability response is invalid.')
    }
    if (capability.value.bootstrapAvailable) {
      const bootstrapped = await api.post('/api/auth/bootstrap', {
        data: {
          bootstrapSecret: 'browser-gate-bootstrap-secret-value',
          newPassword: 'browser-gate-teacher-password-value',
        },
      })
      if (!bootstrapped.ok()) throw new TypeError('Browser gate bootstrap failed.')
    }
    const authenticated = await api.post('/api/auth/login', {
      data: { password: 'browser-gate-teacher-password-value' },
    })
    if (!authenticated.ok()) throw new TypeError('Browser gate authentication failed.')
    await mkdir(join(process.cwd(), 'test-results'), { recursive: true })
    await api.storageState({ path: authStatePath })
  } finally {
    await api.dispose()
  }
}

function isBootstrapCapability(
  value: unknown,
): value is { readonly ok: true; readonly value: { readonly bootstrapAvailable: boolean } } {
  if (typeof value !== 'object' || value === null) return false
  const envelope = value as Readonly<Record<string, unknown>>
  if (envelope.ok !== true || typeof envelope.value !== 'object' || envelope.value === null) {
    return false
  }
  const capability = envelope.value as Readonly<Record<string, unknown>>
  return typeof capability.bootstrapAvailable === 'boolean'
}
