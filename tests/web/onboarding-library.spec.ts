import { expect, test } from '@playwright/test'

test('recovers authentication and opens a verified seed without provider traffic', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  const externalRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4173') {
      externalRequests.push(request.url())
    }
  })

  await page.context().clearCookies()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeFocused()

  const password = page.getByLabel('Administrator password')
  await password.fill('incorrect-browser-gate-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  const failure = page.getByRole('alert')
  await expect(failure).toBeFocused()
  await expect(failure).toContainText('Authentication unsuccessful')
  await expect(password).toHaveValue('')

  await password.fill('browser-gate-teacher-password-value')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Simulation library' })).toBeVisible()
  consoleErrors.length = 0
  await expect(page.getByText('Generation is unavailable', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Opening and running them does not contact a model provider.'),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Small-angle pendulum' })).toBeVisible()

  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Small-angle pendulum' }) })
    .getByRole('link', { name: 'Open bundled example' })
    .click()
  await expect(page).toHaveURL(/\/seeds\/pendulum\.small-angle\/preview$/u)
  await expect(page.getByRole('heading', { name: 'Small-angle pendulum' })).toBeVisible()
  await expect(page.getByText(/CC-BY-4\.0/u)).toBeVisible()
  await expect(page.getByRole('table', { name: 'Pendulum motion data' })).toBeVisible()
  const length = page.getByLabel('Pendulum length')
  await length.fill('1.5')
  await length.press('Enter')
  await expect(page.getByText('Preview refreshed with server-validated samples.')).toBeVisible()
  await expect(page.getByText('A 1.5 m pendulum released at 10°.')).toBeVisible()

  await page.getByRole('link', { name: 'View verification report' }).click()
  await expect(page.getByRole('heading', { name: 'Verification report' })).toBeVisible()
  await expect(page.getByText('Active verification')).toBeVisible()
  await expect(page.getByText('Bundled reference evidence')).toBeVisible()
  await expect(page.getByText('CC-BY-4.0')).toHaveCount(0)

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  const signedOutSession = await page.request.get('/api/session')
  expect(signedOutSession.status()).toBe(401)

  expect(externalRequests).toEqual([])
  expect(consoleErrors).toEqual([])
})
