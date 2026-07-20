import { expect, test } from '@playwright/test'

test('reauthenticates an expired non-library route and restores its safe destination', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Simulation library' })).toBeVisible()
  await page.getByRole('link', { name: 'Create a simulation' }).click()
  await page.getByLabel('Simulation title').fill('Session recovery lesson')
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page).toHaveURL(/\/simulations\/[0-9a-f-]+\/manage$/u)
  const managementUrl = page.url()
  const simulationId = /\/simulations\/([0-9a-f-]+)\/manage$/u.exec(
    new URL(managementUrl).pathname,
  )?.[1]
  if (simulationId === undefined) throw new TypeError('Recovery URL is invalid.')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Simulation library' })).toBeVisible()
  const currentSessionResponse = await page.request.get('/api/session')
  expect(currentSessionResponse.ok()).toBe(true)
  const currentSessionEnvelope: unknown = await currentSessionResponse.json()
  const destination = new URL(`/simulations/${simulationId}`, page.url()).toString()
  await page.evaluate(() => {
    window.addEventListener('simproof:session-expired', () => {
      document.documentElement.dataset.sessionExpired = 'true'
    })
  })

  let expireRequests = true
  let interceptedRequests = 0
  await page.route('**/api/**', async (route) => {
    const requestPath = new URL(route.request().url()).pathname
    if (requestPath !== `/api/simulations/${simulationId}`) {
      await route.fallback()
      return
    }
    if (!expireRequests) {
      await route.fallback()
      return
    }
    interceptedRequests += 1
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: { id: 'http.session-required', message: 'Authentication is required.' },
      }),
    })
  })
  let loginReplayed = false
  await page.route('**/api/auth/login', async (route) => {
    loginReplayed = true
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: currentSessionEnvelope,
    })
  })

  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Session recovery lesson' }) })
    .getByRole('link', { name: 'Open simulation' })
    .click()
  await expect.poll(() => interceptedRequests).toBeGreaterThan(0)
  await expect(page.locator('html')).toHaveAttribute('data-session-expired', 'true')
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeFocused()
  await expect(page).toHaveURL(destination)
  expireRequests = false
  await page.getByLabel('Administrator password').fill('browser-gate-teacher-password-value')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Session recovery lesson' })).toBeFocused()
  await expect(page).toHaveURL(destination)
  expect(loginReplayed).toBe(true)
  expect(pageErrors).toEqual([])
})
