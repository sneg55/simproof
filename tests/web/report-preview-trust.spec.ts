import { expect, type Page, test } from '@playwright/test'
import type {
  NormalizedPreview,
  SimulationDetail,
  VerificationReportDisplay,
} from '@simproof/contracts'
import {
  expectModalNoSeriousViolationsInThemes,
  expectPageNoSeriousViolationsInThemes,
} from './accessibility-assertions'

const password = 'browser-gate-teacher-password-value'
const timestamp = '2026-07-16T12:00:00.000Z'
const simulationId = '51000000-0000-4000-8000-000000000001'
const versionId = '51000000-0000-4000-8000-000000000002'
const runId = '51000000-0000-4000-8000-000000000003'
const reportId = '51000000-0000-4000-8000-000000000004'
const hashA = `sha256:${'a'.repeat(64)}`
const hashB = `sha256:${'b'.repeat(64)}`
const hashC = `sha256:${'c'.repeat(64)}`

test('confirms and publishes the exact audited version identity', async ({ page }, testInfo) => {
  await signIn(page)
  let published = false
  let publishBody: unknown
  await page.route(`**/api/versions/${versionId}/report`, async (route) => {
    await fulfillValue(route, reportDisplay({ published }))
  })
  await page.route(`**/api/versions/${versionId}/publish`, async (route) => {
    publishBody = route.request().postDataJSON()
    published = true
    await fulfillValue(route, publishedDetail())
  })
  await page.route(`**/api/simulations/${simulationId}`, async (route) => {
    await fulfillValue(route, publishedDetail())
  })

  await page.goto(`/versions/${versionId}/report`)
  await expect(page.getByRole('heading', { name: 'Verification report' })).toBeVisible()
  await expect(page.getByText(runId)).toBeVisible()
  await expect(page.getByText(reportId)).toBeVisible()
  await expect(page.getByText(hashC)).toBeVisible()
  const checks = page.getByRole('table', { name: 'Verification checks' })
  await expect(checks.getByRole('cell', { name: 'pendulum.period' })).toBeVisible()
  await expect(checks.getByRole('cell', { name: 'passed' })).toBeVisible()
  await expect(checks.getByRole('cell', { name: '3' })).toBeVisible()
  if (testInfo.project.name === 'a11y') await expectPageNoSeriousViolationsInThemes(page)

  await page.getByRole('button', { name: 'No export license' }).click()
  await page.getByRole('button', { name: 'Publish verified version' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByText(versionId)).toBeVisible()
  await expect(dialog.getByText('Revision 4')).toBeVisible()
  await expect(dialog.getByText(runId)).toBeVisible()
  if (testInfo.project.name === 'a11y') await expectModalNoSeriousViolationsInThemes(page)
  expect(publishBody).toBeUndefined()
  await dialog.getByRole('button', { name: 'Confirm exact version publication' }).click()

  await expect(page).toHaveURL(`/simulations/${simulationId}`)
  await expect(page.getByText('Version 1 is published')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Published lesson' })).toBeFocused()
  expect(publishBody).toEqual({
    expectedRevision: 4,
    verificationRunId: runId,
    exportLicense: { kind: 'none' },
  })
  await expect(page.getByRole('button', { name: 'Publish verified version' })).toHaveCount(0)
})

test('keeps stale report evidence visible while guarding publication', async ({ page }) => {
  await signIn(page)
  await page.route(`**/api/versions/${versionId}/report`, async (route) => {
    await fulfillValue(route, reportDisplay({ stale: true }))
  })

  await page.goto(`/versions/${versionId}/report`)
  await expect(page.getByText('Evidence is stale')).toBeVisible()
  await expect(page.getByText('Verification policy changed')).toBeVisible()
  await expect(page.getByText(runId)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish verified version' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Run verification again' })).toBeVisible()
})

test('fails closed on a hostile preview envelope without creating executable markup', async ({
  page,
}) => {
  await signIn(page)
  await page.route(`**/api/simulations/${simulationId}`, async (route) => {
    await fulfillValue(route, previewDetail())
  })
  await page.route(`**/api/versions/${versionId}/preview`, async (route) => {
    const hostile = '<script>globalThis.previewPwned=true</script><img src=x onerror=alert(1)>'
    await fulfillValue(route, {
      ...preview(),
      conceptSpec: { ...preview().conceptSpec, title: hostile },
      html: hostile,
    })
  })

  await page.goto(`/simulations/${simulationId}/preview`)
  const alert = page.getByRole('alert')
  await expect(alert.getByText('Preview unavailable', { exact: true })).toBeVisible()
  await expect(
    alert.getByText('The server did not return valid normalized preview data.', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText(/globalThis\.previewPwned/u)).toHaveCount(0)
  expect(await page.evaluate(() => 'previewPwned' in globalThis)).toBe(false)
  await expect(page.locator('img')).toHaveCount(0)
})

test('supports keyboard paging while preserving the announced current physical state', async ({
  page,
}) => {
  await signIn(page)
  await page.route(`**/api/simulations/${simulationId}`, async (route) => {
    await fulfillValue(route, previewDetail())
  })
  await page.route(`**/api/versions/${versionId}/preview`, async (route) => {
    await fulfillValue(route, preview())
  })

  await page.goto(`/simulations/${simulationId}/preview`)
  await expect(page.getByRole('region', { name: 'Current physical state' })).toContainText(
    'Horizontal position',
  )
  const table = page.getByRole('table', { name: 'Projectile trajectory data' })
  await expect(table).toContainText('Rows 1 to 50 of 120.')
  const next = page.getByRole('button', { name: 'Next data page' })
  await next.focus()
  await page.keyboard.press('Enter')
  await expect(table).toContainText('Rows 51 to 100 of 120.')
  await expect(page.getByRole('button', { name: 'Previous data page' })).toBeEnabled()
})

function reportDisplay(
  options: { published?: boolean; stale?: boolean } = {},
): VerificationReportDisplay {
  const assumptions = ['Uniform gravity acts downward.']
  const limitations = ['Small-angle approximation only.']
  const stale = options.stale ?? false
  const published = options.published ?? false
  return {
    simulationVersionId: versionId,
    verificationRunId: runId,
    reportArtifactHash: hashC,
    versionRevision: 4,
    conceptSpec: pendulumConcept(),
    report: {
      schemaVersion: '1',
      reportId,
      createdAt: timestamp,
      conceptSpecHash: hashA,
      artifact: { hash: hashB },
      policy: { id: 'pendulum.small-angle', version: '1.0.0', contentHash: hashA },
      domainPack: { id: 'pendulum', version: '1.0.0', contentHash: hashB },
      runner: { version: '1.2.0', protocolVersion: '1' },
      observationHash: hashA,
      verdict: 'verified',
      checks: [{ id: 'pendulum.period', outcome: 'passed', sampleCount: 3 }],
      findings: [],
      testedScope: {
        parameters: [{ parameter: 'lengthM', unit: 'm', min: 0.5, max: 2 }],
        sampleCount: 3,
        samplingGridHash: hashB,
      },
      assumptions,
      limitations,
    },
    validity: stale ? { status: 'stale', reasons: ['policy-changed'] } : { status: 'current' },
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
      sampling: { cases: [{ lengthM: 1, amplitudeDeg: 10 }] },
      tolerances: { periodS: { mode: 'relative', relative: 0.01 } },
      assumptions,
      limitations,
    },
    publication: published
      ? { published: true, publishedAt: timestamp, exportLicense: { kind: 'none' } }
      : { published: false },
    badgeActive: !stale,
    publishable: !stale && !published,
  }
}

function pendulumConcept() {
  return {
    schemaVersion: '1' as const,
    domain: 'pendulum' as const,
    title: 'Pendulum audit report',
    parameters: {
      length: { unit: 'm' as const, defaultValue: 1, requestedRange: { min: 0.5, max: 2 } },
      amplitude: { unit: 'deg' as const, defaultValue: 10, requestedRange: { min: 1, max: 15 } },
    },
    requestedControls: ['length', 'amplitude'],
  }
}

function publishedDetail(): SimulationDetail {
  const summary: SimulationDetail['selectedVersion']['summary'] = {
    id: versionId,
    versionNumber: 1,
    state: 'published',
    revision: 5,
    domain: 'pendulum',
    verification: {
      status: 'current',
      verificationRunId: runId,
      verdict: 'verified',
      artifactHash: hashB,
      reportHash: hashC,
    },
    updatedAt: timestamp,
  }
  return {
    simulation: {
      id: simulationId,
      title: 'Published lesson',
      source: { kind: 'teacher' },
      currentVersion: summary,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    selectedVersion: {
      summary,
      conceptSpec: pendulumConcept(),
      exportLicense: { kind: 'none' },
      generationProvenance: null,
      lineage: null,
      availableActions: ['preview', 'view-report', 'export'],
      createdAt: timestamp,
    },
  }
}

function previewDetail(): SimulationDetail {
  const summary: SimulationDetail['selectedVersion']['summary'] = {
    id: versionId,
    versionNumber: 1,
    state: 'verified',
    revision: 4,
    domain: 'projectile',
    verification: {
      status: 'current',
      verificationRunId: runId,
      verdict: 'verified',
      artifactHash: hashB,
      reportHash: hashC,
    },
    updatedAt: timestamp,
  }
  return {
    simulation: {
      id: simulationId,
      title: 'Preview lesson',
      source: { kind: 'teacher' },
      currentVersion: summary,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    selectedVersion: {
      summary,
      conceptSpec: projectileConcept(),
      exportLicense: { kind: 'none' },
      generationProvenance: null,
      lineage: null,
      availableActions: ['preview', 'view-report'],
      createdAt: timestamp,
    },
  }
}

function projectileConcept() {
  return {
    schemaVersion: '1' as const,
    domain: 'projectile' as const,
    title: 'Projectile preview',
    parameters: {
      initialSpeed: {
        unit: 'm/s' as const,
        defaultValue: 20,
        requestedRange: { min: 10, max: 30 },
      },
      launchAngle: { unit: 'deg' as const, defaultValue: 45, requestedRange: { min: 15, max: 75 } },
    },
    requestedControls: ['initialSpeed', 'launchAngle'],
  }
}

function preview(): NormalizedPreview {
  return {
    schemaVersion: '1',
    domain: 'projectile',
    simulationVersionId: versionId,
    conceptSpec: projectileConcept(),
    renderer: {
      schemaVersion: '1',
      domain: 'projectile',
      renderer: 'projectile-trajectory',
      features: ['trail'],
    },
    input: { initialSpeedMps: 20, launchAngleDeg: 45 },
    evidence: {
      verificationRunId: runId,
      artifactHash: hashB,
      validity: { status: 'current' },
      assumptions: ['Uniform gravity.'],
      limitations: ['No drag.'],
    },
    samples: Array.from({ length: 120 }, (_, index) => ({
      index,
      timeS: index / 10,
      xM: index,
      yM: Math.max(0, index - index ** 2 / 119),
      speedMps: 20,
    })),
    events: [{ kind: 'launch', sampleIndex: 0 }],
  }
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

async function fulfillValue(
  route: import('@playwright/test').Route,
  value: unknown,
): Promise<void> {
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, value }),
  })
}
