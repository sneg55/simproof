import { describe, expect, it } from 'vitest'

import {
  bootstrapCapabilitySchema,
  educatorRuntimeConfigSchema,
  educatorSessionSchema,
  educatorVersionDetailSchema,
  libraryPageSchema,
  librarySimulationSummarySchema,
  libraryVersionSummarySchema,
  seedMetadataSchema,
  simulationDetailSchema,
  versionComparisonSchema,
} from '../index.js'

const id = '123e4567-e89b-42d3-a456-426614174000'
const secondId = '223e4567-e89b-42d3-a456-426614174000'
const timestamp = '2026-07-16T12:00:00.000Z'
const hash = `sha256:${'a'.repeat(64)}`

const runtime = {
  deploymentMode: 'network',
  providerConfigured: false,
  maxRequestBytes: 65_536,
  maxPromptCharacters: 16_384,
  promptRetentionDefault: 'discard',
  telemetryEnabled: false,
  externalDiagnosticsEnabled: false,
} as const

const seed = {
  seedId: 'projectile.introduction',
  bundledVersion: '1.0.0',
  contentHash: hash,
  domain: 'projectile',
  title: 'Projectile motion',
  description: 'Explore a verified projectile trajectory.',
  contentLicense: 'CC-BY-4.0',
  attribution: 'SimProof contributors.',
} as const

const version = {
  id,
  versionNumber: 1,
  state: 'verified',
  revision: 4,
  domain: 'projectile',
  verification: {
    status: 'current',
    verificationRunId: secondId,
    verdict: 'verified',
    artifactHash: hash,
    reportHash: hash,
  },
  updatedAt: timestamp,
} as const

const summary = {
  id,
  title: 'Projectile motion',
  source: { kind: 'seed', seed },
  currentVersion: version,
  createdAt: timestamp,
  updatedAt: timestamp,
} as const

describe('educator runtime and session contracts', () => {
  it('exposes only explicit browser-safe runtime and session keys', () => {
    const config = educatorRuntimeConfigSchema.parse({
      runtime,
      generation: { available: false, reason: 'provider-not-configured' },
      seedLibraryReady: true,
      supportedDomains: ['pendulum', 'projectile'],
    })
    expect(Object.keys(config).sort()).toEqual([
      'generation',
      'runtime',
      'seedLibraryReady',
      'supportedDomains',
    ])
    expect(
      educatorRuntimeConfigSchema.safeParse({ ...config, openaiApiKey: 'secret' }).success,
    ).toBe(false)

    const session = educatorSessionSchema.parse({
      authenticated: true,
      expiresAt: timestamp,
      csrfToken: 'c'.repeat(32),
    })
    expect(Object.keys(session).sort()).toEqual(['authenticated', 'csrfToken', 'expiresAt'])
    expect(
      educatorSessionSchema.parse({ ...session, authenticationMode: 'local-bypass' }),
    ).toMatchObject({ authenticationMode: 'local-bypass' })
    expect(educatorSessionSchema.safeParse({ ...session, sessionId: id }).success).toBe(false)
    expect(bootstrapCapabilitySchema.safeParse({ bootstrapAvailable: true }).success).toBe(true)
  })
})

describe('educator library contracts', () => {
  it('accepts every durable lifecycle state without widening the state vocabulary', () => {
    const states = [
      'draft',
      'generating',
      'verifying',
      'rejected',
      'verified',
      'stale',
      'published',
      'archived',
    ] as const
    for (const state of states) {
      const verification =
        state === 'draft' || state === 'generating' || state === 'verifying'
          ? { status: 'none' as const }
          : state === 'stale'
            ? {
                ...version.verification,
                status: 'stale' as const,
                reasons: ['policy-changed' as const],
              }
            : state === 'rejected'
              ? { ...version.verification, verdict: 'rejected' as const }
              : version.verification
      expect(
        libraryVersionSummarySchema.safeParse({
          ...version,
          state,
          verification,
        }).success,
      ).toBe(true)
    }
    expect(libraryVersionSummarySchema.safeParse({ ...version, state: 'deleted' }).success).toBe(
      false,
    )
    expect(
      libraryVersionSummarySchema.safeParse({
        ...version,
        state: 'stale',
        verification: version.verification,
      }).success,
    ).toBe(false)
  })

  it('keeps seed metadata strict, bounded, and explicitly licensed', () => {
    expect(seedMetadataSchema.safeParse(seed).success).toBe(true)
    expect(seedMetadataSchema.safeParse({ ...seed, contentLicense: 'MIT' }).success).toBe(false)
    expect(
      seedMetadataSchema.safeParse({ ...seed, sourceUrl: 'javascript:alert(1)' }).success,
    ).toBe(false)
  })

  it('bounds pages, rejects duplicate actions, and returns strict aggregate details', () => {
    expect(librarySimulationSummarySchema.safeParse(summary).success).toBe(true)
    const page = libraryPageSchema.parse({ items: [summary], nextCursor: null })
    expect(Object.keys(page).sort()).toEqual(['items', 'nextCursor'])
    expect(
      educatorVersionDetailSchema.safeParse({
        summary: version,
        conceptSpec: null,
        exportLicense: { kind: 'none' },
        generationProvenance: null,
        lineage: null,
        availableActions: ['preview', 'preview'],
        createdAt: timestamp,
      }).success,
    ).toBe(false)
    const detail = {
      simulation: summary,
      selectedVersion: {
        summary: version,
        conceptSpec: null,
        exportLicense: { kind: 'none' },
        generationProvenance: null,
        lineage: null,
        availableActions: ['preview', 'view-report', 'publish', 'export'],
        createdAt: timestamp,
      },
    }
    expect(simulationDetailSchema.safeParse(detail).success).toBe(true)
    expect(
      versionComparisonSchema.safeParse({
        simulationId: id,
        left: detail.selectedVersion,
        right: { ...detail.selectedVersion, summary: { ...version, id: secondId } },
        rows: Array.from({ length: 12 }, () => ({
          field: 'state',
          changed: false,
          left: { summary: 'draft', details: [], totalDetailCount: 0, truncated: false },
          right: { summary: 'draft', details: [], totalDetailCount: 0, truncated: false },
        })),
      }).success,
    ).toBe(false)
  })
})
