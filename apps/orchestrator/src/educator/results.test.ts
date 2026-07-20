import { describe, expect, it } from 'vitest'

import { fromPersistence } from './results.js'

describe('educator persistence error mapping', () => {
  it.each([
    ['invalid-input', 'invalid-input'],
    ['not-found', 'not-found'],
    ['conflict', 'conflict'],
    ['invalid-state', 'conflict'],
    ['invalid-transition', 'conflict'],
    ['immutable-record', 'conflict'],
    ['database-error', 'operation-failed'],
    ['corrupt-artifact', 'operation-failed'],
  ] as const)('maps %s without exposing persistence diagnostics', (source, expected) => {
    expect(
      fromPersistence({
        ok: false,
        error: { code: source, message: 'sensitive persistence diagnostic' },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: expected,
        message:
          expected === 'operation-failed'
            ? 'Educator operation failed closed.'
            : 'sensitive persistence diagnostic',
      },
    })
  })
})
