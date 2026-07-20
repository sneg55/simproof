import { describe, expect, it } from 'vitest'

import { createRedactor, REDACTED } from './index.js'

const fixtures = {
  apiKeys: ['sk-test-api-key-abcdefghijklmnop'],
  accessTokens: ['access-token-sentinel-123456'],
  passwords: ['correct horse battery staple'],
  cookies: ['simproof_session=cookie-sentinel-123'],
  prompts: ['Teach projectile motion with the private school example.'],
  generatedContent: ['export const velocity = teacherSecret * time'],
} as const

const allSensitiveValues = Object.values(fixtures).flat()

describe('redaction', () => {
  it('removes registered API keys, tokens, passwords, cookies, prompts, and generated content', () => {
    const redactor = createRedactor(fixtures)
    const input = allSensitiveValues.join('\n')
    const result = redactor.redactText(input)
    for (const value of allSensitiveValues) expect(result).not.toContain(value)
    expect(result).toContain(REDACTED)
  })

  it('redacts known secret syntax even when a literal was not registered', () => {
    const result = createRedactor().redactText(
      'Authorization: Bearer abcdefghijklmnop\npassword=outside-fixture\ntoken=plain-token-sentinel\napi_key=sk-pattern-abcdefghijkl',
    )
    expect(result).not.toContain('abcdefghijklmnop')
    expect(result).not.toContain('outside-fixture')
    expect(result).not.toContain('plain-token-sentinel')
    expect(result).not.toContain('sk-pattern-abcdefghijkl')
  })

  it('redacts sensitive object fields and nested registered content without mutating input', () => {
    const redactor = createRedactor(fixtures)
    const input = {
      service: 'orchestrator',
      password: fixtures.passwords[0],
      nested: {
        authorization: `Bearer ${fixtures.accessTokens[0]}`,
        safeMessage: `failure near ${fixtures.generatedContent[0]}`,
      },
    }
    const output = redactor.redactValue(input)
    expect(output).toEqual({
      service: 'orchestrator',
      password: REDACTED,
      nested: { authorization: REDACTED, safeMessage: `failure near ${REDACTED}` },
    })
    expect(input.password).toBe(fixtures.passwords[0])
    for (const value of allSensitiveValues) expect(JSON.stringify(output)).not.toContain(value)
  })

  it('bounds nested diagnostic traversal', () => {
    const deep = { one: { two: { three: { four: 'value' } } } }
    expect(createRedactor(undefined, { maxDepth: 2 }).redactValue(deep)).toEqual({
      one: { two: '[TRUNCATED]' },
    })
  })
})
