import type { ConceptSpec, FindingExplanation, VerificationReport } from '@simproof/contracts'
import type { VerificationRun } from '@simproof/persistence'
import type { FindingExplainer } from '@simproof/providers'
import { describe, expect, it, vi } from 'vitest'

import { narrationFor } from './report-projection-support.js'

const conceptSpec = {} as ConceptSpec
const run = { report: { contentHash: `sha256:${'a'.repeat(64)}` } } as unknown as VerificationRun
const rejected = { verdict: 'rejected', findings: [] } as unknown as VerificationReport
const verified = { verdict: 'verified', findings: [] } as unknown as VerificationReport

const explanation: FindingExplanation = {
  source: 'model-commentary',
  narration: 'The period is too short.',
  provenance: {
    provider: 'openai-responses',
    model: 'gpt-test',
    templateVersion: '1.0.0',
    requestIds: ['resp_1'],
    threadId: null,
    usage: { inputTokens: 1, outputTokens: 1, requestCount: 1, costMicrousd: 2 },
  },
}

const explainerReturning = (
  value: ReturnType<FindingExplainer['explain']> extends Promise<infer R> ? R : never,
) =>
  ({ explain: vi.fn(() => Promise.resolve(value)) }) as unknown as FindingExplainer & {
    explain: ReturnType<typeof vi.fn>
  }

describe('narrationFor', () => {
  it('returns and caches narration for a rejected verdict', async () => {
    const explainer = explainerReturning({ ok: true, value: explanation })
    const cache = new Map<string, FindingExplanation>()

    const first = await narrationFor({ explainer, cache, run, conceptSpec, report: rejected })
    const second = await narrationFor({ explainer, cache, run, conceptSpec, report: rejected })

    expect(first).toEqual(explanation)
    expect(second).toEqual(explanation)
    expect(explainer.explain).toHaveBeenCalledTimes(1)
  })

  it('fails soft to no narration when the explainer errors', async () => {
    const explainer = explainerReturning({
      ok: false,
      error: {} as never,
      kind: 'transient',
      metering: {} as never,
    })
    const result = await narrationFor({
      explainer,
      cache: new Map(),
      run,
      conceptSpec,
      report: rejected,
    })

    expect(result).toBeUndefined()
  })

  it('does not narrate a verified verdict', async () => {
    const explainer = explainerReturning({ ok: true, value: explanation })
    const result = await narrationFor({
      explainer,
      cache: new Map(),
      run,
      conceptSpec,
      report: verified,
    })

    expect(result).toBeUndefined()
    expect(explainer.explain).not.toHaveBeenCalled()
  })

  it('returns no narration when no explainer is configured', async () => {
    const result = await narrationFor({
      explainer: undefined,
      cache: new Map(),
      run,
      conceptSpec,
      report: rejected,
    })

    expect(result).toBeUndefined()
  })
})
