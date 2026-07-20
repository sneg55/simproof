import { describe, expect, it } from 'vitest'

import { parseStrictJson } from './strict-json.js'

describe('strict JSON parsing', () => {
  it('accepts only RFC JSON whitespace between tokens', () => {
    expect(parseStrictJson(' \t\r\n{"ok": true}')).toEqual({ ok: true })
    for (const whitespace of ['\f', '\u00a0', '\u2028']) {
      expect(() => parseStrictJson(`${whitespace}{"ok":true}`)).toThrow()
    }
  })

  it('parses only complete finite JSON number forms', () => {
    for (const value of ['0', '-0', '12', '-12', '1.25', '1e3', '1E-3']) {
      expect(parseStrictJson(value)).toBe(Number(value))
    }
    for (const value of ['01', '-', '1.', '1e', '1e+', '+1', '.1', '1e9999']) {
      expect(() => parseStrictJson(value)).toThrow()
    }
  })
})
