import { expect, type Page, test } from '@playwright/test'
import {
  expectModalNoSeriousViolationsInThemes,
  expectPageNoSeriousViolationsInThemes,
} from './accessibility-assertions'

const password = 'browser-gate-teacher-password-value'
const runId = '33333333-3333-4333-8333-333333333333'
const verificationRunId = '44444444-4444-4444-8444-444444444444'
const conceptSpecHash = `sha256:${'a'.repeat(64)}`
const artifactHash = `sha256:${'b'.repeat(64)}`

type Outcome =
  | 'verified'
  | 'rejected'
  | 'provider_authentication'
  | 'provider_quota'
  | 'provider_malformed'
  | 'provider_transient'
  | 'runner_failed'
  | 'budget_exhausted'
  | 'invariant_failed'
  | 'cancelled'
  | 'attempts_exhausted'

for (const scenario of [
  { outcome: 'verified', expected: 'Verified' },
  { outcome: 'rejected', expected: 'Scientifically rejected' },
  { outcome: 'provider_authentication', expected: 'Provider failed' },
  { outcome: 'provider_quota', expected: 'Provider failed' },
  { outcome: 'provider_malformed', expected: 'Provider failed' },
  { outcome: 'provider_transient', expected: 'Provider failed' },
  { outcome: 'runner_failed', expected: 'Sandbox failed' },
  { outcome: 'budget_exhausted', expected: 'Budget exhausted' },
  { outcome: 'invariant_failed', expected: 'Safety check stopped the run' },
  { outcome: 'cancelled', expected: 'Cancelled' },
  { outcome: 'attempts_exhausted', expected: 'Scientifically rejected' },
] as const satisfies readonly { readonly outcome: Outcome; readonly expected: string }[]) {
  test(`generation lifecycle: ${scenario.outcome}`, async ({ page }, testInfo) => {
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await signIn(page)
    consoleErrors.length = 0
    const simulationId = await createDraft(page, `Browser ${scenario.outcome.replace('_', ' ')}`)
    const fixture = await installGenerationRoutes(page, scenario.outcome)
    await page.goto(`/simulations/${simulationId}/generate`)
    await startAndAcceptConcept(page, testInfo.project.name === 'a11y')

    if (scenario.outcome === 'cancelled') {
      await page.getByRole('button', { name: 'Cancel generation' }).click()
      await expect(page.getByText('Cancellation requested', { exact: true })).toBeVisible()
    }

    if (scenario.outcome === 'verified') {
      const cancel = page.getByRole('button', { name: 'Cancel generation' })
      await expect(cancel).toBeVisible()
      await cancel.focus()
      await expect(page.getByText('Verifying science', { exact: true })).toBeVisible()
      await expect(cancel).toBeFocused()
    }

    await expect(page.getByText(scenario.expected, { exact: true })).toBeVisible()
    await assertTruthfulOutcome(page, scenario.outcome)
    if (testInfo.project.name === 'a11y') {
      await expectPageNoSeriousViolationsInThemes(page)
    }
    expect(fixture.startRequest?.teacher).toEqual(
      expect.objectContaining({
        externalProviderDisclosureAccepted: true,
        promptRetention: 'discard',
      }),
    )
    expect(fixture.conceptDecision).toEqual({
      expectedRunRevision: 2,
      expectedReviewRevision: 7,
      conceptSpecHash,
      decision: 'accept',
    })
    expect(consoleErrors).toEqual([])
    expect(pageErrors).toEqual([])
  })
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /^(Simulation library|Welcome back)$/u }),
  ).toBeVisible()
  if (await page.getByRole('heading', { name: 'Simulation library' }).isVisible()) return
  await page.getByLabel('Administrator password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Simulation library' })).toBeVisible()
}

async function createDraft(page: Page, title: string): Promise<string> {
  await page.getByRole('link', { name: 'Create a simulation' }).click()
  await page.getByLabel('Simulation title').fill(title)
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page).toHaveURL(/\/simulations\/[0-9a-f-]+\/manage$/u)
  const match = /\/simulations\/([^/]+)\/manage$/u.exec(new URL(page.url()).pathname)
  if (match?.[1] === undefined) throw new TypeError('Created simulation URL is invalid.')
  return match[1]
}

async function startAndAcceptConcept(page: Page, scanAccessibility: boolean): Promise<void> {
  await page.getByRole('button', { name: /Use example: Explore pendulum length/i }).click()
  await page.getByRole('button', { name: 'Review disclosure and start' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('external AI provider')
  if (scanAccessibility) await expectModalNoSeriousViolationsInThemes(page)
  await page.getByRole('button', { name: 'I understand and start' }).click()
  await expect(page.getByRole('heading', { name: 'Pendulum period explorer' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Length' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'm', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '0.5 to 3' })).toBeVisible()
  if (scanAccessibility) {
    await expectPageNoSeriousViolationsInThemes(page)
    await page.getByRole('button', { name: 'Decline concept' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('Decline this concept?')
    await expectModalNoSeriousViolationsInThemes(page)
    await page.getByRole('button', { name: 'Keep reviewing' }).click()
  }
  await page.getByRole('button', { name: 'Accept concept and continue' }).click()
  await expect(page.getByText('Building simulation', { exact: true })).toBeVisible()
}

async function assertTruthfulOutcome(page: Page, outcome: Outcome): Promise<void> {
  if (outcome === 'verified') {
    await expect(
      page.getByText(
        'The draft passed every independent scientific check and is ready for your review.',
        { exact: true },
      ),
    ).toBeVisible()
    return
  }
  if (outcome === 'rejected') {
    await expect(
      page.getByText('The draft did not pass the scientific checks after the allowed attempts.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.getByText('Provider failed', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Sandbox failed', { exact: true })).toHaveCount(0)
    return
  }
  const operational = operationalExpectation(outcome)
  if (operational !== null) {
    await expect(page.getByText(operational.guidance, { exact: false })).toBeVisible()
    await expect(page.getByText(`Error reference: ${operational.stableErrorId}`)).toHaveCount(2)
    await expect(page.getByText('Scientifically rejected', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/scientific rejection/iu)).toHaveCount(0)
    return
  }
  if (outcome === 'runner_failed') {
    await expect(
      page.getByText('The sealed sandbox could not finish running the draft.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.getByText('Scientifically rejected', { exact: true })).toHaveCount(0)
    return
  }
  if (outcome === 'cancelled') {
    await expect(
      page.getByText(
        'Generation stopped after your cancellation request and no further work will start.',
        { exact: true },
      ),
    ).toBeVisible()
    return
  }
  await expect(page.getByText('3 of 3', { exact: true })).toBeVisible()
  await expect(
    page.getByText('The draft did not pass the scientific checks after the allowed attempts.', {
      exact: true,
    }),
  ).toBeVisible()
}

function operationalExpectation(outcome: Outcome) {
  switch (outcome) {
    case 'provider_authentication':
      return {
        stableErrorId: 'provider.authentication-failed',
        guidance: 'Ask an administrator to check the generation provider credentials.',
      }
    case 'provider_quota':
      return {
        stableErrorId: 'provider.quota-exceeded',
        guidance: 'Ask an administrator to review the generation provider quota.',
      }
    case 'provider_malformed':
      return {
        stableErrorId: 'provider.malformed-response',
        guidance: 'The provider returned output that could not pass strict validation.',
      }
    case 'provider_transient':
      return {
        stableErrorId: 'provider.transient-failure',
        guidance: 'The provider had a temporary problem. You can start a new run.',
      }
    case 'budget_exhausted':
      return {
        stableErrorId: 'generation.budget-exhausted',
        guidance: 'Increase the configured budget only after reviewing the run usage.',
      }
    case 'invariant_failed':
      return {
        stableErrorId: 'orchestration.invariant-failed',
        guidance:
          'SimProof stopped this run after an internal error. Start a new run, and share the run reference below with your administrator if it keeps happening.',
      }
    case 'verified':
    case 'rejected':
    case 'runner_failed':
    case 'cancelled':
    case 'attempts_exhausted':
      return null
  }
}

interface GenerationFixture {
  startRequest?: GenerationStartBody
  conceptDecision?: unknown
}

interface GenerationStartBody {
  readonly simulationVersionId: string
  readonly teacher: {
    readonly externalProviderDisclosureAccepted: boolean
    readonly promptRetention: string
  }
}

async function installGenerationRoutes(page: Page, outcome: Outcome): Promise<GenerationFixture> {
  const fixture: GenerationFixture = {}
  let conceptAccepted = false
  let cancellationRequested = false
  let activeRead = 0

  await page.route('**/api/runtime-config', async (route) => {
    await json(route, 200, {
      runtime: {
        deploymentMode: 'loopback',
        providerConfigured: true,
        maxRequestBytes: 65_536,
        maxPromptCharacters: 16_384,
        promptRetentionDefault: 'discard',
        telemetryEnabled: false,
        externalDiagnosticsEnabled: false,
      },
      generation: { available: true },
      seedLibraryReady: true,
      supportedDomains: ['pendulum', 'projectile'],
    })
  })
  await page.route('**/api/generations', async (route) => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().headers()['x-csrf-token']).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    fixture.startRequest = route.request().postDataJSON() as GenerationStartBody
    await json(route, 202, { runId, created: true, state: 'queued', revision: 0 })
  })
  await page.route(new RegExp(`/api/generations/${runId}/concept-review$`, 'u'), async (route) => {
    expect(route.request().method()).toBe('POST')
    fixture.conceptDecision = route.request().postDataJSON()
    conceptAccepted = true
    await json(route, 200, status(fixture, 'generating', outcome))
  })
  await page.route(new RegExp(`/api/generations/${runId}/cancellation$`, 'u'), async (route) => {
    expect(route.request().method()).toBe('POST')
    cancellationRequested = true
    await json(route, 202, {
      runId,
      cancellationRequestedAt: '2026-07-16T12:04:00.000Z',
    })
  })
  await page.route(new RegExp(`/api/generations/${runId}$`, 'u'), async (route) => {
    expect(route.request().method()).toBe('GET')
    if (!conceptAccepted) {
      await json(route, 200, status(fixture, 'awaiting_confirmation', outcome))
      return
    }
    if (cancellationRequested) {
      await json(route, 200, status(fixture, 'cancelled', outcome))
      return
    }
    const activeState = nextState(outcome, activeRead)
    activeRead += 1
    await json(route, 200, status(fixture, activeState, outcome))
  })
  return fixture
}

function finalState(outcome: Outcome): PublicState {
  switch (outcome) {
    case 'attempts_exhausted':
      return 'rejected'
    case 'provider_authentication':
    case 'provider_quota':
    case 'provider_malformed':
    case 'provider_transient':
      return 'provider_failed'
    case 'verified':
    case 'rejected':
    case 'runner_failed':
    case 'budget_exhausted':
    case 'invariant_failed':
    case 'cancelled':
      return outcome
  }
}

function nextState(outcome: Outcome, read: number): PublicState {
  if (read === 0) return 'generating'
  if (outcome.startsWith('provider_')) return 'provider_failed'
  if (outcome === 'budget_exhausted' || outcome === 'invariant_failed') return outcome
  if (read === 1) return 'executing'
  if (outcome === 'runner_failed') return 'runner_failed'
  if (outcome === 'cancelled') return 'executing'
  if (read === 2) return 'verifying'
  return finalState(outcome)
}

type PublicState =
  | 'awaiting_confirmation'
  | 'generating'
  | 'executing'
  | 'verifying'
  | 'verified'
  | 'rejected'
  | 'provider_failed'
  | 'runner_failed'
  | 'budget_exhausted'
  | 'invariant_failed'
  | 'cancelled'

function status(fixture: GenerationFixture, state: PublicState, outcome: Outcome) {
  const timestamp = '2026-07-16T12:00:00.000Z'
  const transitions = transitionHistory(state, timestamp)
  const terminal = new Set<PublicState>([
    'verified',
    'rejected',
    'provider_failed',
    'runner_failed',
    'budget_exhausted',
    'invariant_failed',
    'cancelled',
  ]).has(state)
  return {
    runId,
    simulationVersionId: fixture.startRequest?.simulationVersionId,
    state,
    revision: transitions.at(-1)?.sequence ?? 0,
    maxAttempts: 3,
    budget: {
      limits: {
        maxProviderRequests: 6,
        maxInputTokens: 120_000,
        maxOutputTokens: 30_000,
        maxCostMicrousd: 5_000_000,
        maxArtifactBytes: 2_000_000,
      },
      consumed: {
        providerRequests: 2,
        inputTokens: 1_000,
        outputTokens: 500,
        costMicrousd: 20_000,
        artifactBytes: 10_000,
      },
    },
    conceptReview:
      state === 'awaiting_confirmation'
        ? { status: 'pending', reviewRevision: 7, conceptSpec, conceptSpecHash }
        : {
            status: 'accepted',
            reviewRevision: 8,
            conceptSpec,
            conceptSpecHash,
            acceptedAt: timestamp,
          },
    cancellationRequestedAt: state === 'cancelled' ? '2026-07-16T12:04:00.000Z' : null,
    error: publicError(state, outcome),
    attempts: attempts(state, outcome),
    transitions,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: terminal ? timestamp : null,
  }
}

function transitionHistory(state: PublicState, occurredAt: string) {
  if (state === 'awaiting_confirmation') {
    return [
      { sequence: 0, from: null, to: 'queued', occurredAt },
      { sequence: 1, from: 'queued', to: 'compiling', occurredAt },
      { sequence: 2, from: 'compiling', to: 'awaiting_confirmation', occurredAt },
    ]
  }
  const states: PublicState[] = ['generating']
  if (state === 'executing' || state === 'verifying' || state === 'runner_failed') {
    states.push('executing')
  }
  if (state === 'verifying' || state === 'verified' || state === 'rejected') {
    if (!states.includes('executing')) states.push('executing')
    states.push('verifying')
  }
  if (state === 'cancelled' && !states.includes('executing')) states.push('executing')
  if (!states.includes(state)) states.push(state)
  const path: Array<PublicState | 'queued' | 'compiling'> = [
    'queued',
    'compiling',
    'awaiting_confirmation',
    ...states,
  ]
  return path.map((to, sequence) => ({
    sequence,
    from: sequence === 0 ? null : (path[sequence - 1] ?? null),
    to,
    occurredAt,
  }))
}

const conceptSpec = {
  schemaVersion: '1',
  domain: 'pendulum',
  title: 'Pendulum period explorer',
  parameters: {
    length: { unit: 'm', defaultValue: 1.5, requestedRange: { min: 0.5, max: 3 } },
    amplitude: { unit: 'deg', defaultValue: 20, requestedRange: { min: 0, max: 45 } },
  },
  requestedControls: ['length', 'amplitude'],
} as const

function publicError(state: PublicState, outcome: Outcome) {
  if (state === 'provider_failed') {
    if (outcome === 'provider_authentication') {
      return {
        category: 'authentication',
        stableErrorId: 'provider.authentication-failed',
        retryable: false,
      }
    }
    if (outcome === 'provider_quota') {
      return { category: 'quota', stableErrorId: 'provider.quota-exceeded', retryable: false }
    }
    if (outcome === 'provider_malformed') {
      return {
        category: 'malformed-response',
        stableErrorId: 'provider.malformed-response',
        retryable: false,
      }
    }
    return { category: 'transient', stableErrorId: 'provider.transient-failure', retryable: true }
  }
  if (state === 'runner_failed') {
    return { category: 'runner', stableErrorId: 'runner.execution-failed', retryable: false }
  }
  if (state === 'rejected') {
    return {
      category: 'verifier-rejection',
      stableErrorId: 'verifier.scientific-rejection',
      retryable: false,
    }
  }
  if (state === 'budget_exhausted') {
    return {
      category: 'budget',
      stableErrorId: 'generation.budget-exhausted',
      retryable: false,
    }
  }
  if (state === 'invariant_failed') {
    return {
      category: 'invariant',
      stableErrorId: 'orchestration.invariant-failed',
      retryable: false,
    }
  }
  return null
}

function attempts(state: PublicState, outcome: Outcome) {
  if (state === 'verified') return [scientificAttempt(1, 'generation', 'verified')]
  if (state === 'rejected' && outcome === 'attempts_exhausted') {
    return [
      scientificAttempt(1, 'generation', 'rejected'),
      scientificAttempt(2, 'repair', 'rejected'),
      scientificAttempt(3, 'repair', 'rejected'),
    ]
  }
  if (state === 'rejected') return [scientificAttempt(1, 'generation', 'rejected')]
  if (
    state === 'provider_failed' ||
    state === 'runner_failed' ||
    state === 'budget_exhausted' ||
    state === 'invariant_failed'
  ) {
    return [operationalAttempt(state, outcome)]
  }
  return []
}

function scientificAttempt(
  attemptNumber: number,
  kind: 'generation' | 'repair',
  outcome: 'verified' | 'rejected',
) {
  return {
    attemptNumber,
    kind,
    outcome,
    artifactHash,
    verificationRunId,
    stableErrorId: null,
    createdAt: '2026-07-16T12:00:00.000Z',
    completedAt: '2026-07-16T12:01:00.000Z',
  }
}

function operationalAttempt(
  state: 'provider_failed' | 'runner_failed' | 'budget_exhausted' | 'invariant_failed',
  outcome: Outcome,
) {
  const expectation = operationalExpectation(outcome)
  return {
    attemptNumber: 1,
    kind: 'generation',
    outcome: outcome === 'provider_malformed' ? 'malformed_response' : state,
    artifactHash: null,
    verificationRunId: null,
    stableErrorId: expectation?.stableErrorId ?? 'runner.execution-failed',
    createdAt: '2026-07-16T12:00:00.000Z',
    completedAt: '2026-07-16T12:01:00.000Z',
  }
}

async function json(
  route: import('@playwright/test').Route,
  responseStatus: number,
  value: unknown,
): Promise<void> {
  await route.fulfill({
    status: responseStatus,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, value }),
  })
}
