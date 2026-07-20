import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DiagnosticBundle } from './diagnostics-bundle.js'
import { runDiagnosticCli } from './diagnostics-cli.js'

const roots: string[] = []
const bundle = {
  schemaVersion: '1',
  bundleId: '019f6bc1-0811-70c1-a139-938a3ad2dee0',
  createdAt: '2026-07-17T12:00:00.000Z',
  versions: {
    simproof: '0.0.0',
    orchestrator: '0.0.0',
    observability: '0.0.0',
    persistence: '0.0.0',
    runner: '0.0.0',
    verifier: '0.0.0',
    node: '24.15.0',
    runnerProtocol: '1',
    databaseSchema: 5,
  },
  configuration: {
    valid: true,
    presence: {
      databasePathConfigured: true,
      artifactRootConfigured: true,
      adminBootstrapSecretPresent: true,
      sessionSecretPresent: true,
      openaiCredentialPresent: false,
      codexCredentialPresent: false,
      allowedOriginsConfigured: true,
      trustedProxyConfigured: false,
      telemetryEnabled: false,
      telemetryEndpointConfigured: false,
      externalDiagnosticsEnabled: false,
      externalDiagnosticsEndpointConfigured: false,
      externalDiagnosticsTokenPresent: false,
      diagnosticLogRootConfigured: false,
      diagnosticLogMaxBytesConfigured: false,
      diagnosticLogFilesConfigured: false,
      unknownSimproofKeyPresent: false,
    },
  },
  migration: {
    status: 'current',
    expectedVersion: 5,
    appliedVersions: [1, 2, 3, 4, 5],
    checksumValid: true,
  },
  readiness: { status: 'ready' },
  stableErrors: { entries: [], unregisteredCount: 0 },
  excludedCategories: [
    'environment-values',
    'credentials',
    'authentication-records',
    'cookies',
    'prompts',
    'generated-content',
    'artifact-content',
    'provider-responses',
    'reasoning',
  ],
} as const satisfies DiagnosticBundle

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'simproof-diagnostics-cli-'))
  roots.push(root)
  return root
}

describe('operator diagnostic command', () => {
  it('writes one strict private JSON file and forwards only the explicit logs category', async () => {
    const root = await directory()
    const output = join(root, 'simproof-diagnostics.json')
    const createBundle = vi.fn(() => Promise.resolve(bundle))
    const exitCode = await runDiagnosticCli({
      argv: ['create', '--output', output, '--include', 'logs', '--max-log-events', '25'],
      createBundle,
      stdout: vi.fn(),
      stderr: vi.fn(),
    })
    expect(exitCode).toBe(0)
    expect(createBundle).toHaveBeenCalledWith({ includeLogs: true, maxLogEvents: 25 })
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(bundle)
    expect((await lstat(output)).mode & 0o777).toBe(0o600)
  })

  it('refuses stdout, unknown categories, unsafe names, and duplicate arguments', async () => {
    const root = await directory()
    const createBundle = vi.fn(() => Promise.resolve(bundle))
    for (const argv of [
      ['create', '--output', '-'],
      ['create', '--output', join(root, 'report.json')],
      ['create', '--output', join(root, 'simproof-diagnostics.json'), '--include', 'prompts'],
      [
        'create',
        '--output',
        join(root, 'simproof-diagnostics.json'),
        '--output',
        join(root, 'simproof-diagnostics-2.json'),
      ],
    ]) {
      await expect(
        runDiagnosticCli({ argv, createBundle, stdout: vi.fn(), stderr: vi.fn() }),
      ).resolves.toBe(2)
    }
    expect(createBundle).not.toHaveBeenCalled()
  })

  it('refuses to overwrite files or follow a destination symlink', async () => {
    const root = await directory()
    const original = join(root, 'original.json')
    const output = join(root, 'simproof-diagnostics.json')
    await writeFile(output, 'operator data', { mode: 0o600 })
    expect(
      await runDiagnosticCli({
        argv: ['create', '--output', output],
        createBundle: () => Promise.resolve(bundle),
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(1)
    expect(await readFile(output, 'utf8')).toBe('operator data')

    await writeFile(original, 'preserve me', { mode: 0o600 })
    await rm(output)
    await symlink(original, output)
    expect(
      await runDiagnosticCli({
        argv: ['create', '--output', output],
        createBundle: () => Promise.resolve(bundle),
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(1)
    expect(await readFile(original, 'utf8')).toBe('preserve me')

    const linkedParent = join(root, 'linked-parent')
    await symlink(root, linkedParent)
    expect(
      await runDiagnosticCli({
        argv: ['create', '--output', join(linkedParent, 'simproof-diagnostics-linked.json')],
        createBundle: () => Promise.resolve(bundle),
        stdout: vi.fn(),
        stderr: vi.fn(),
      }),
    ).toBe(1)
  })
})
