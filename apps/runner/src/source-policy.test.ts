import { describe, expect, it } from 'vitest'

import { inspectGeneratedSource } from './source-policy.js'

const allowedCore = `
export default Object.freeze({
  protocolVersion: '1',
  sample(input) { return { periodS: input.lengthM * 2 } }
})`

describe('generated source policy', () => {
  it('accepts a self-contained deterministic simulation core', () => {
    expect(inspectGeneratedSource(allowedCore)).toEqual({ ok: true })
  })

  it.each([
    ["import fs from 'node:fs'", 'runner.denied.forbidden-import'],
    ["export { readFile } from 'node:fs'", 'runner.denied.forbidden-import'],
    ["import('./payload.mjs')", 'runner.denied.dynamic-import'],
    ["require('node:fs')", 'runner.denied.dynamic-code'],
    ['eval("1 + 1")', 'runner.denied.dynamic-code'],
    ["(()=>{}).constructor('return process')()", 'runner.denied.dynamic-code'],
    ['({}).constr\\u0075ctor', 'runner.denied.dynamic-code'],
    ['process.env.OPENAI_API_KEY', 'runner.denied.environment'],
    ['globalThis.fetch("https://example.test")', 'runner.denied.environment'],
    ['fetch("https://example.test")', 'runner.denied.network'],
    ['new Worker("worker.js")', 'runner.denied.worker'],
    ['child_process.spawn("node")', 'runner.denied.subprocess'],
    ['WebAssembly.compile(bytes)', 'runner.denied.native-addon'],
    ['console.log("flood")', 'runner.denied.output'],
    ['Date.now()', 'runner.denied.nondeterminism'],
    ['Math.random()', 'runner.denied.nondeterminism'],
  ])('rejects %s with stable ID %s', (source, errorId) => {
    expect(inspectGeneratedSource(source)).toMatchObject({ ok: false, errorId })
  })

  it('does not deny capability words inside comments or strings', () => {
    expect(
      inspectGeneratedSource(`${allowedCore}\n// process.env\nconst label = 'Math.random()'`),
    ).toEqual({
      ok: true,
    })
  })
})
