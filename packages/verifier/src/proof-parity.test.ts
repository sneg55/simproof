import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { verifyPendulumCandidate } from './domains/pendulum/index.js'
import { verifyProjectile } from './domains/projectile/index.js'
import { batchFromFixture, type ProjectileFixture } from './domains/projectile/test-fixture.js'

type Verdict = 'inapplicable' | 'rejected' | 'verified'

interface VerdictCase {
  readonly id: string
  readonly domain: 'pendulum' | 'projectile'
  readonly fixture: string
  readonly expected: Verdict
  readonly pythonControl?: string
}

interface VerdictManifest {
  readonly schemaVersion: 1
  readonly cases: readonly VerdictCase[]
}

interface PythonVerdicts {
  readonly schemaVersion: 1
  readonly controls: readonly string[]
  readonly verdicts: readonly {
    readonly fixture: string
    readonly fixtureSha256: string
    readonly verdict: Verdict
  }[]
}

const fixtureRoot = new URL('../../../tests/fixtures/', import.meta.url)
const manifestPath = new URL('proof-verdicts.json', fixtureRoot)
const pythonManifestPath = fileURLToPath(
  new URL('../../../proof/simproof_verdict_manifest.py', import.meta.url),
)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VerdictManifest

const runPythonManifest = (path: URL | string = manifestPath): PythonVerdicts =>
  JSON.parse(
    execFileSync(
      'python3',
      [pythonManifestPath, '--manifest', typeof path === 'string' ? path : fileURLToPath(path)],
      {
        encoding: 'utf8',
      },
    ),
  ) as PythonVerdicts

const fixtureSha256 = (fixture: string, root: URL | string = fixtureRoot): string =>
  createHash('sha256')
    .update(readFileSync(new URL(fixture, root)))
    .digest('hex')

const verdictFromTypeScript = (testCase: VerdictCase): Verdict => {
  const fixture = JSON.parse(
    readFileSync(new URL(testCase.fixture, fixtureRoot), 'utf8'),
  ) as unknown
  if (testCase.domain === 'pendulum') {
    const outcome = verifyPendulumCandidate(fixture)
    return outcome.ok ? outcome.result.verdict : 'rejected'
  }
  const outcome = verifyProjectile(batchFromFixture(fixture))
  return outcome.ok ? outcome.result.verdict : 'rejected'
}

const fixtureInventory = (): string[] =>
  ['correct', 'negative-controls']
    .flatMap((directory) =>
      readdirSync(new URL(`${directory}/`, fixtureRoot))
        .filter((name) => name.endsWith('.json'))
        .map((name) => `${directory}/${name}`),
    )
    .sort()

const verdictMap = (
  records: readonly { readonly fixture: string; readonly verdict: Verdict }[],
): Record<string, Verdict> =>
  Object.fromEntries(records.map(({ fixture, verdict }) => [fixture, verdict]))

describe('proof verdict parity', () => {
  it('keeps every correct and negative-control fixture in the verdict manifest', () => {
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.cases.map(({ fixture }) => fixture).sort()).toEqual(fixtureInventory())
    expect(new Set(manifest.cases.map(({ id }) => id)).size).toBe(manifest.cases.length)
  })

  it('matches the expected TypeScript verdict for every fixture', () => {
    const actual = manifest.cases.map((testCase) => ({
      fixture: testCase.fixture,
      verdict: verdictFromTypeScript(testCase),
    }))
    const expected = manifest.cases.map(({ expected, fixture }) => ({
      fixture,
      verdict: expected,
    }))

    expect(actual).toEqual(expected)
  })

  it('matches Python and TypeScript verdicts for every shared proof control', () => {
    const python = runPythonManifest()
    const sharedCases = manifest.cases.filter(({ pythonControl }) => pythonControl !== undefined)
    const typeScriptVerdicts = sharedCases.map((testCase) => ({
      fixture: testCase.fixture,
      verdict: verdictFromTypeScript(testCase),
    }))
    const expected = sharedCases.map(({ expected, fixture }) => ({ fixture, verdict: expected }))
    const sharedControlIds = sharedCases.map(({ pythonControl }) => pythonControl).sort()

    expect(python.schemaVersion).toBe(manifest.schemaVersion)
    expect(python.controls).toEqual(sharedControlIds)
    expect(verdictMap(python.verdicts)).toEqual(verdictMap(typeScriptVerdicts))
    expect(verdictMap(python.verdicts)).toEqual(verdictMap(expected))
    expect(
      Object.fromEntries(
        python.verdicts.map(({ fixture, fixtureSha256: digest }) => [fixture, digest]),
      ),
    ).toEqual(
      Object.fromEntries(sharedCases.map(({ fixture }) => [fixture, fixtureSha256(fixture)])),
    )
  })

  it('observes a fixture mutation even when the verdict stays the same', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'simproof-parity-'))
    try {
      cpSync(fileURLToPath(fixtureRoot), temporaryRoot, { recursive: true })
      const fixture = 'negative-controls/projectile-coarse-euler.json'
      const fixturePath = join(temporaryRoot, fixture)
      const mutated = JSON.parse(readFileSync(fixturePath, 'utf8')) as ProjectileFixture
      writeFileSync(fixturePath, `${JSON.stringify({ ...mutated, stepSeconds: 0.4 }, null, 2)}\n`)

      const original = runPythonManifest()
      const changed = runPythonManifest(join(temporaryRoot, 'proof-verdicts.json'))
      const originalRecord = original.verdicts.find((record) => record.fixture === fixture)
      const changedRecord = changed.verdicts.find((record) => record.fixture === fixture)

      expect(originalRecord?.verdict).toBe('rejected')
      expect(changedRecord?.verdict).toBe('rejected')
      expect(changedRecord?.fixtureSha256).not.toBe(originalRecord?.fixtureSha256)
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
})
