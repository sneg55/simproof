import { describe, expect, it } from 'vitest'

import { createScriptedFakeProvider, fakeProviderScenarios } from './fake-provider.js'

describe('scripted fake provider', () => {
  it.each([
    ['authentication', fakeProviderScenarios.authenticationFailure],
    ['quota', fakeProviderScenarios.quotaFailure],
    ['transient', fakeProviderScenarios.transientFailure],
    ['malformed-response', fakeProviderScenarios.malformed],
  ] as const)('deterministically returns %s compilation failures', async (category, scenario) => {
    const provider = createScriptedFakeProvider(scenario)
    const result = await provider.compile({ prompt: 'Build a pendulum.' })

    expect(result).toMatchObject({ ok: false, error: { category } })
  })

  it('returns the same correct concept and artifacts for the same script', async () => {
    const first = createScriptedFakeProvider(fakeProviderScenarios.correct)
    const second = createScriptedFakeProvider(fakeProviderScenarios.correct)
    expect(first.descriptor).toEqual({
      provider: 'fake',
      model: 'fake-scripted-v1',
      templateVersion: '1.0.0',
    })
    expect(first.compileReservation).toEqual({
      inputTokens: 1,
      outputTokens: 1,
      requestCount: 1,
      costMicrousd: 1,
    })
    expect(first.generateReservation).toBe(first.compileReservation)
    expect(first.repairReservation).toBe(first.compileReservation)
    expect(Object.isFrozen(first.compileReservation)).toBe(true)

    const firstConcept = await first.compile({ prompt: 'Build a pendulum.' })
    const secondConcept = await second.compile({ prompt: 'Build a pendulum.' })
    expect(firstConcept).toEqual(secondConcept)
    if (!firstConcept.ok || !secondConcept.ok) return

    const firstCode = await first.generate({ conceptSpec: firstConcept.value.conceptSpec })
    const secondCode = await second.generate({ conceptSpec: secondConcept.value.conceptSpec })
    expect(firstCode).toEqual(secondCode)
    expect(firstCode).toMatchObject({
      ok: true,
      value: { artifacts: { core: { path: 'core.mjs' } } },
    })
  })

  it('converges on repair only in the repair-convergence scenario', async () => {
    const provider = createScriptedFakeProvider(fakeProviderScenarios.repairConvergence)
    const concept = await provider.compile({ prompt: 'Build a pendulum.' })
    expect(concept.ok).toBe(true)
    if (!concept.ok) return

    const generated = await provider.generate({ conceptSpec: concept.value.conceptSpec })
    expect(generated.ok).toBe(true)
    if (!generated.ok) return
    expect(generated.value.artifacts.core.content).toContain('lengthM / 9.80665')

    const repaired = await provider.repair({
      conceptSpec: concept.value.conceptSpec,
      previousArtifacts: generated.value.artifacts,
      findings: [],
      diagnostics: [],
      threadId: generated.value.threadId,
    })
    expect(repaired).toMatchObject({ ok: true })
    if (repaired.ok) {
      expect(repaired.value.artifacts.core.content).toContain('Math.sqrt(input.lengthM / 9.80665)')
    }
  })

  it('never converges in the exhausted scenario', async () => {
    const provider = createScriptedFakeProvider(fakeProviderScenarios.exhausted)
    const concept = await provider.compile({ prompt: 'Build a pendulum.' })
    expect(concept.ok).toBe(true)
    if (!concept.ok) return

    const generated = await provider.generate({ conceptSpec: concept.value.conceptSpec })
    expect(generated.ok).toBe(true)
    if (!generated.ok) return

    const repairs = await Promise.all(
      [1, 2].map(() =>
        provider.repair({
          conceptSpec: concept.value.conceptSpec,
          previousArtifacts: generated.value.artifacts,
          findings: [],
          diagnostics: [],
          threadId: generated.value.threadId,
        }),
      ),
    )
    expect(
      repairs.every(
        (result) => result.ok && result.value.artifacts.core.content.includes('lengthM / 9.80665'),
      ),
    ).toBe(true)
  })

  it('explains a rejected verdict as model commentary without credentials', async () => {
    const provider = createScriptedFakeProvider(fakeProviderScenarios.correct)
    const concept = await provider.compile({ prompt: 'Build a pendulum.' })
    expect(concept.ok).toBe(true)
    if (!concept.ok) return

    const result = await provider.explain({
      conceptSpec: concept.value.conceptSpec,
      verdict: 'rejected',
      findings: [
        {
          id: 'finding.period-mismatch',
          category: 'mismatch',
          severity: 'error',
          checkId: 'check.period',
          quantity: 'periodS',
          inputs: { lengthM: { value: 1, unit: 'm' } },
          expected: { value: 2.006, unit: 's' },
          actual: { value: 0.641, unit: 's' },
          tolerance: { mode: 'relative', relative: 0.01 },
          error: { mode: 'relative', value: 0.31 },
          explanation: 'Period differs from the closed-form value by 31%.',
        },
      ],
    })

    expect(result).toMatchObject({
      ok: true,
      value: { source: 'model-commentary', provenance: { provider: 'fake' } },
    })
    expect(result.ok && result.value.narration).toContain('periodS')
    expect(provider.explainReservation).toBe(provider.compileReservation)
  })
})
