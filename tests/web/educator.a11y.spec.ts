import { expect, test } from '@playwright/test'
import {
  expectDocumentNoSeriousViolationsInThemes,
  expectModalNoSeriousViolationsInThemes,
  expectPageNoSeriousViolationsInThemes,
} from './accessibility-assertions'

test('library and bundled detail have no serious automated accessibility violations', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await signIn(page)
  await expect(page.getByRole('heading', { name: 'Simulation library' })).toBeVisible()
  consoleErrors.length = 0
  await expectPageNoSeriousViolationsInThemes(page)

  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('link', { name: 'Simulation library' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()

  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Projectile motion' }) })
    .getByRole('link', { name: 'Open bundled example' })
    .click()
  await expect(page.getByRole('img', { name: 'Projectile trajectory view' })).toBeVisible()
  const controls = page.getByRole('region', { name: 'Playback controls' })
  await controls.focus()
  await controls.press('ArrowRight')
  await expect(page.getByRole('status').filter({ hasText: 'Sample 2 of' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Projectile trajectory data' })).toBeVisible()
  await expectPageNoSeriousViolationsInThemes(page)

  await page.getByRole('link', { name: 'View verification report' }).click()
  await expect(page.getByRole('heading', { name: 'Verification report' })).toBeVisible()
  await expectPageNoSeriousViolationsInThemes(page)

  await page.goto('/seeds/pendulum.small-angle/preview')
  await expect(page.getByRole('img', { name: 'Pendulum position view' })).toBeVisible()
  const pendulumControls = page.getByRole('region', { name: 'Playback controls' })
  await pendulumControls.focus()
  await pendulumControls.press('ArrowRight')
  await expect(page.getByRole('table', { name: 'Pendulum motion data' })).toBeVisible()
  await expectPageNoSeriousViolationsInThemes(page)

  await page.setViewportSize({ width: 320, height: 640 })
  await expectPageNoSeriousViolationsInThemes(page)
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(horizontalOverflow).toBe(false)
  expect(consoleErrors).toEqual([])
})

test('authentication, creation, management, lifecycle, and dialogs pass automated scans', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.context().clearCookies()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expectDocumentNoSeriousViolationsInThemes(page)

  await page.getByLabel('Administrator password').fill('browser-gate-teacher-password-value')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('link', { name: 'Create a simulation' }).click()
  await expect(page.getByRole('heading', { name: 'Create a simulation' })).toBeFocused()
  await expectPageNoSeriousViolationsInThemes(page)
  await page.getByLabel('Simulation title').fill('Accessibility management lesson')
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(
    page.getByRole('heading', { name: 'Manage Accessibility management lesson' }),
  ).toBeFocused()
  await expectPageNoSeriousViolationsInThemes(page)

  await page.getByRole('button', { name: 'Duplicate selected version' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectModalNoSeriousViolationsInThemes(page)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'Export selected simulation' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectModalNoSeriousViolationsInThemes(page)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'Archive this version' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expectModalNoSeriousViolationsInThemes(page)
  await page.getByRole('button', { name: 'Keep version active' }).click()

  await page.getByRole('button', { name: 'Delete simulation' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectModalNoSeriousViolationsInThemes(page)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.goto(`${page.url().replace(/\/manage$/u, '/generate')}`)
  await expect(
    page.getByRole('heading', { name: /^(Generate a simulation|Generation is unavailable)$/u }),
  ).toBeVisible()
  await expectPageNoSeriousViolationsInThemes(page)
  expect(errors).toEqual([])
})

async function signIn(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /^(Simulation library|Welcome back)$/u }),
  ).toBeVisible()
  if (await page.getByRole('heading', { name: 'Simulation library' }).isVisible()) return
  await page.getByLabel('Administrator password').fill('browser-gate-teacher-password-value')
  await page.getByRole('button', { name: 'Sign in' }).click()
}
