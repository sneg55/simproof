import type { HttpOperationResult } from './http/types.js'
import type { PrivacyService } from './privacy/service.js'

export function updatePrivacy(
  privacy: PrivacyService,
  value: unknown,
): HttpOperationResult<unknown> {
  if (!isPrivacyUpdate(value)) {
    return { ok: false, error: { code: 'invalid-input', message: 'Privacy input is invalid.' } }
  }
  return privacy.updateSettings({
    expectedRevision: value.expectedRevision,
    promptRetentionEnabled: value.promptRetention === 'persist',
    externalDiagnosticsEnabled: value.externalDiagnosticsEnabled,
  })
}

function isPrivacyUpdate(value: unknown): value is {
  expectedRevision: number
  promptRetention: 'discard' | 'persist'
  externalDiagnosticsEnabled: boolean
} {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return (
    Number.isSafeInteger(input.expectedRevision) &&
    Number(input.expectedRevision) >= 0 &&
    (input.promptRetention === 'discard' || input.promptRetention === 'persist') &&
    typeof input.externalDiagnosticsEnabled === 'boolean'
  )
}
