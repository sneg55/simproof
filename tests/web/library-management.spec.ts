import { expect, type Page, test } from '@playwright/test'
import type {
  GenerationStatus,
  LibraryPage,
  SimulationDetail,
  VersionHistory,
} from '@simproof/contracts'

const password = 'browser-gate-teacher-password-value'
const timestamp = '2026-07-16T12:00:00.000Z'

test('manages blank versions, content duplicates, exports, archives, and deletion from the keyboard', async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page)
  await signIn(page)
  browserErrors.length = 0

  await page.getByRole('link', { name: 'Create a simulation' }).click()
  const title = page.getByLabel('Simulation title')
  await title.fill('Browser management lesson')
  await title.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Manage Browser management lesson' }),
  ).toBeVisible()
  const originalUrl = page.url()
  const simulationId = idFromManagementUrl(originalUrl)
  await expect(page.getByRole('cell', { name: 'Version 1' })).toBeVisible()

  await page.getByRole('button', { name: 'Export selected simulation' }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Current password').fill('wrong-password')
  await dialog.getByRole('button', { name: 'Download JSON export' }).click()
  await expect(
    dialog.getByRole('alert').filter({ hasText: 'The export was not created' }),
  ).toBeFocused()
  expect(browserErrors.splice(0)).toEqual([
    'Failed to load resource: the server responded with a status of 403 (Forbidden)',
  ])
  await expect(dialog.getByLabel('Current password')).toHaveValue('')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Export selected simulation' })).toBeFocused()

  await page.getByRole('button', { name: 'Start blank next version' }).click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'A blank draft version was started in this simulation lineage.' }),
  ).toBeFocused()
  await expect(page.getByRole('cell', { name: 'Version 2' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Source version' })).toContainText('Version 2')
  await page.getByRole('button', { name: 'Compare versions' }).click()
  const lifecycleComparison = page.getByRole('row').filter({ hasText: 'Lifecycle state' })
  await expect(page.getByText('Auditable version comparison')).toBeVisible()
  await expect(lifecycleComparison).toContainText('Unchanged')
  await expect(lifecycleComparison.getByText('draft')).toHaveCount(2)

  let failDuplicate = true
  await page.route(`**/api/simulations/${simulationId}/duplicate`, async (route) => {
    if (!failDuplicate) return await route.fallback()
    failDuplicate = false
    await fulfillFailure(route, 503, 'browser.duplicate-failed')
  })
  await page.getByRole('button', { name: 'Duplicate selected version' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('New simulation title').fill('Browser separate lineage')
  await dialog.getByRole('button', { name: 'Create duplicate' }).click()
  await expect(
    dialog.getByRole('alert').filter({ hasText: 'The simulation was not duplicated.' }),
  ).toBeFocused()
  expect(browserErrors.splice(0)).toEqual([
    'Failed to load resource: the server responded with a status of 503 (Service Unavailable)',
  ])
  await expect(dialog.getByLabel('New simulation title')).toHaveValue('Browser separate lineage')
  await dialog.getByRole('button', { name: 'Create duplicate' }).click()
  await expect(page.getByRole('heading', { name: 'Manage Browser separate lineage' })).toBeFocused()
  await expect(page.getByText(/Duplicated from source version 2, revision 0/u)).toBeVisible()
  await expect(page.getByText(/verification and publication were reset/u)).toBeVisible()
  await expect(page).not.toHaveURL(originalUrl)

  await page.getByRole('button', { name: 'Archive this version' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm archive' }).click()
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Browser separate lineage' }) })
    .getByRole('link', { name: 'Open simulation' })
    .click()
  await page.getByRole('link', { name: 'Manage versions and export' }).click()
  await page.getByRole('button', { name: 'Delete simulation' }).focus()
  await page.keyboard.press('Enter')
  dialog = page.getByRole('dialog')
  const deleteButton = dialog.getByRole('button', { name: 'Permanently delete simulation' })
  await expect(deleteButton).toBeDisabled()
  await dialog.getByLabel('Current password').fill('wrong-password')
  await dialog.getByLabel('Type delete').fill('delete')
  await deleteButtonFor(dialog).click()
  await expect(
    dialog.getByRole('alert').filter({ hasText: 'The simulation was not deleted' }),
  ).toBeFocused()
  expect(browserErrors.splice(0)).toEqual([
    'Failed to load resource: the server responded with a status of 403 (Forbidden)',
  ])
  await expect(dialog.getByLabel('Current password')).toHaveValue('')
  await expect(dialog.getByLabel('Type delete')).toHaveValue('delete')
  await dialog.getByLabel('Current password').fill(password)
  await deleteButtonFor(dialog).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Simulation library' })).toBeFocused()
  await expect(
    page.getByRole('status').filter({ hasText: 'Deleted Browser separate lineage' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Browser separate lineage', exact: true }),
  ).toHaveCount(0)

  await page.goto(originalUrl)
  await expect(
    page.getByRole('heading', { name: 'Manage Browser management lesson' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Export selected simulation' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Current password').fill(password)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download JSON export' }).click(),
  ])
  expect(download.suggestedFilename()).toBe(`simproof-${simulationId}.json`)
  expect(await download.failure()).toBeNull()

  const archive = page.getByRole('button', { name: 'Archive this version' })
  await archive.focus()
  await page.keyboard.press('Enter')
  const archiveDialog = page.getByRole('alertdialog')
  await expect(archiveDialog.getByRole('button', { name: 'Keep version active' })).toBeFocused()
  await archiveDialog.getByRole('button', { name: 'Confirm archive' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Simulation library' })).toBeFocused()
  await expect(
    page.getByRole('status').filter({ hasText: 'Archived Browser management lesson' }),
  ).toBeVisible()
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Browser management lesson' }) })
    .getByRole('link', { name: 'Open simulation' })
    .click()
  await page.getByRole('link', { name: 'Manage versions and export' }).click()
  await expect(page.getByRole('button', { name: 'Delete simulation' })).toBeVisible()
  expect(browserErrors).toEqual([])
})

test('shows stale evidence and submits reverification against its exact revision', async ({
  page,
}) => {
  const browserErrors = captureBrowserErrors(page)
  await signIn(page)
  browserErrors.length = 0
  await page.getByRole('link', { name: 'Create a simulation' }).click()
  await page.getByLabel('Simulation title').fill('Browser stale evidence lesson')
  await page.getByLabel('Simulation title').press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Manage Browser stale evidence lesson' }),
  ).toBeVisible()
  const simulationId = idFromManagementUrl(page.url())
  const versionId = '77777777-7777-4777-8777-777777777777'
  const runId = '88888888-8888-4888-8888-888888888888'
  const detail = staleDetail(simulationId, versionId)
  const history: VersionHistory = { simulationId, versions: [detail.selectedVersion] }
  let reverifyBody: unknown

  await page.route(`**/api/simulations/${simulationId}`, async (route) => {
    await fulfillValue(route, detail)
  })
  await page.route(`**/api/simulations/${simulationId}/versions`, async (route) => {
    await fulfillValue(route, history)
  })
  await page.route(`**/api/versions/${versionId}/reverify`, async (route) => {
    reverifyBody = route.request().postDataJSON()
    await fulfillValue(route, { runId, created: true, state: 'queued', revision: 0 })
  })
  await page.route(`**/api/generations/${runId}`, async (route) => {
    await fulfillValue(route, cancelledStatus(runId, versionId))
  })

  await page.goto(`/simulations/${simulationId}/manage`)
  await expect(
    page.getByRole('heading', { name: 'Manage Browser stale evidence lesson' }),
  ).toBeVisible()
  await expect(page.getByText('stale', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Revision 7', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reverify stale version' }).click()

  await expect(page).toHaveURL(
    `/simulations/${simulationId}/generate?runId=${encodeURIComponent(runId)}`,
  )
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible()
  expect(reverifyBody).toEqual({
    expectedRevision: 7,
    idempotencyKey: `reverify:${versionId}:7`,
  })
  expect(browserErrors).toEqual([])
})

test('loads another library page and clears filters after an empty search', async ({ page }) => {
  await signIn(page)
  const first = browserLibraryItem(
    '11111111-aaaa-4111-8111-111111111111',
    '22222222-aaaa-4222-8222-222222222222',
    'Browser page one lesson',
  )
  const second = browserLibraryItem(
    '33333333-bbbb-4333-8333-333333333333',
    '44444444-bbbb-4444-8444-444444444444',
    'Browser page two lesson',
  )
  await page.route('**/api/simulations?*', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('search') === 'missing') {
      return await fulfillValue(route, { items: [], nextCursor: null } satisfies LibraryPage)
    }
    if (url.searchParams.get('cursor') === 'browser-page-two') {
      return await fulfillValue(route, { items: [second], nextCursor: null } satisfies LibraryPage)
    }
    await fulfillValue(route, {
      items: [first],
      nextCursor: 'browser-page-two',
    } satisfies LibraryPage)
  })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: first.title })).toBeVisible()
  await expect(page.getByText('1 educator simulation shown.')).toBeAttached()
  await page.getByRole('button', { name: 'Load more simulations' }).click()
  await expect(page.getByRole('heading', { name: second.title })).toBeVisible()
  await expect(page.getByRole('heading', { name: first.title })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search simulations' }).fill('missing')
  await expect(page.getByText('No simulations match these filters')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByRole('heading', { name: first.title })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search simulations' })).toHaveValue('')
})

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

function captureBrowserErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

function idFromManagementUrl(url: string): string {
  const match = /\/simulations\/([0-9a-f-]+)\/manage$/u.exec(new URL(url).pathname)
  if (match?.[1] === undefined)
    throw new TypeError('Management URL did not contain a simulation id.')
  return match[1]
}

function deleteButtonFor(dialog: ReturnType<Page['getByRole']>) {
  return dialog.getByRole('button', { name: 'Permanently delete simulation' })
}

function staleDetail(simulationId: string, versionId: string): SimulationDetail {
  const summary: SimulationDetail['selectedVersion']['summary'] = {
    id: versionId,
    versionNumber: 1,
    state: 'stale',
    revision: 7,
    domain: 'pendulum',
    verification: {
      status: 'stale',
      verificationRunId: '99999999-9999-4999-8999-999999999999',
      verdict: 'verified',
      artifactHash: `sha256:${'a'.repeat(64)}`,
      reportHash: `sha256:${'b'.repeat(64)}`,
      reasons: ['policy-changed'],
    },
    updatedAt: timestamp,
  }
  return {
    simulation: {
      id: simulationId,
      title: 'Browser stale evidence lesson',
      source: { kind: 'teacher' },
      currentVersion: summary,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    selectedVersion: {
      summary,
      conceptSpec: null,
      exportLicense: { kind: 'spdx', id: 'CC-BY-4.0' },
      generationProvenance: null,
      lineage: null,
      availableActions: [
        'reverify',
        'start-blank-version',
        'duplicate',
        'export',
        'archive',
        'delete',
      ],
      createdAt: timestamp,
    },
  }
}

function cancelledStatus(runId: string, versionId: string): GenerationStatus {
  return {
    runId,
    simulationVersionId: versionId,
    state: 'cancelled',
    revision: 1,
    maxAttempts: 1,
    budget: {
      limits: {
        maxProviderRequests: 1,
        maxInputTokens: 100,
        maxOutputTokens: 100,
        maxCostMicrousd: 100,
        maxArtifactBytes: 1_024,
      },
      consumed: {
        providerRequests: 0,
        inputTokens: 0,
        outputTokens: 0,
        costMicrousd: 0,
        artifactBytes: 0,
      },
    },
    conceptReview: { status: 'not-ready' },
    cancellationRequestedAt: timestamp,
    error: { category: 'cancellation', stableErrorId: 'generation.cancelled', retryable: false },
    attempts: [],
    transitions: [{ sequence: 0, from: null, to: 'cancelled', occurredAt: timestamp }],
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
  }
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

async function fulfillFailure(
  route: import('@playwright/test').Route,
  status: number,
  id: string,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: { id, message: 'Browser test failure.' } }),
  })
}

function browserLibraryItem(
  simulationId: string,
  versionId: string,
  title: string,
): LibraryPage['items'][number] {
  return {
    id: simulationId,
    title,
    source: { kind: 'teacher' },
    currentVersion: {
      id: versionId,
      versionNumber: 1,
      state: 'draft',
      revision: 0,
      domain: null,
      verification: { status: 'none' },
      updatedAt: timestamp,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
