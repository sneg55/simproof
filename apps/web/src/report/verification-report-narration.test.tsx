import type { FindingExplanation, VerificationReportDisplay } from '@simproof/contracts'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { VerificationReportPanel } from '@/report/verification-report'

const hashA = `sha256:${'a'.repeat(64)}`
const hashB = `sha256:${'b'.repeat(64)}`
const hashC = `sha256:${'c'.repeat(64)}`

const narration: FindingExplanation = {
  source: 'model-commentary',
  narration: 'The pendulum period is far too short because the core drops the square root.',
  provenance: {
    provider: 'openai-responses',
    model: 'gpt-5.6',
    templateVersion: '1.0.0',
    requestIds: ['resp_demo'],
    threadId: null,
    usage: { inputTokens: 40, outputTokens: 20, requestCount: 1, costMicrousd: 60 },
  },
}

function rejectedDisplay(
  overrides: Partial<VerificationReportDisplay> = {},
): VerificationReportDisplay {
  const assumptions = ['Uniform gravity acts downward.']
  const limitations = ['Small-angle approximation only.']
  return {
    simulationVersionId: '123e4567-e89b-42d3-a456-426614174000',
    verificationRunId: '323e4567-e89b-42d3-a456-426614174000',
    reportArtifactHash: hashC,
    versionRevision: 2,
    conceptSpec: {
      schemaVersion: '1',
      domain: 'pendulum',
      title: 'Pendulum period explorer',
      parameters: {
        length: { unit: 'm', defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
        amplitude: { unit: 'deg', defaultValue: 10, requestedRange: { min: 1, max: 15 } },
      },
      requestedControls: ['length', 'amplitude'],
    },
    report: {
      schemaVersion: '1',
      reportId: '223e4567-e89b-42d3-a456-426614174000',
      createdAt: '2026-07-16T12:00:00.000Z',
      conceptSpecHash: hashA,
      artifact: { hash: hashB },
      policy: { id: 'pendulum.small-angle', version: '1.0.0', contentHash: hashA },
      domainPack: { id: 'pendulum', version: '1.0.0', contentHash: hashB },
      runner: { version: '1.2.0', protocolVersion: '1' },
      observationHash: hashA,
      verdict: 'rejected',
      checks: [{ id: 'pendulum.period', outcome: 'failed', sampleCount: 3 }],
      findings: [
        {
          id: 'finding.period',
          category: 'mismatch',
          severity: 'error',
          checkId: 'pendulum.period',
          quantity: 'periodS',
          inputs: { lengthM: { value: 1, unit: 'm' } },
          expected: { value: 2.006, unit: 's' },
          actual: { value: 0.641, unit: 's' },
          tolerance: { mode: 'relative', relative: 0.01 },
          error: { mode: 'relative', value: 0.68 },
          explanation: 'Period differs from the closed-form value.',
        },
      ],
      testedScope: {
        parameters: [
          { parameter: 'lengthM', unit: 'm', min: 0.5, max: 2, sampledValues: [0.5, 1, 2] },
        ],
        sampleCount: 3,
        samplingGridHash: hashB,
      },
      assumptions,
      limitations,
    },
    validity: { status: 'current' },
    policy: {
      schemaVersion: '1',
      id: 'pendulum.small-angle',
      version: '1.0.0',
      domain: 'pendulum',
      checks: ['pendulum.period'],
      applicability: {
        lengthM: { min: 0.5, max: 2 },
        amplitudeDeg: { minExclusive: 0, max: 15 },
        gravityMps2: 9.81,
        model: 'small-angle',
      },
      sampling: { cases: [{ lengthM: 0.5, amplitudeDeg: 5 }] },
      tolerances: { periodS: { mode: 'relative', relative: 0.01 } },
      assumptions,
      limitations,
    },
    publication: { published: false },
    badgeActive: false,
    publishable: false,
    ...overrides,
  }
}

describe('verification report narration', () => {
  it('renders model commentary labeled as non-evidence when narration is present', () => {
    render(
      <VerificationReportPanel
        report={rejectedDisplay({ narration })}
        onPublish={vi.fn()}
        onReverify={vi.fn()}
      />,
    )

    expect(screen.getByText('AI explanation of the failure')).toBeVisible()
    expect(screen.getByText(narration.narration)).toBeVisible()
  })

  it('omits the AI explanation when no narration is present', () => {
    render(
      <VerificationReportPanel
        report={rejectedDisplay()}
        onPublish={vi.fn()}
        onReverify={vi.fn()}
      />,
    )

    expect(screen.queryByText('AI explanation of the failure')).toBeNull()
  })
})
