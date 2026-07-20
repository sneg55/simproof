import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

type Theme = 'dark' | 'light'

export async function expectNoSeriousViolations(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/\S/u)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze()
  expect(
    results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical'),
  ).toEqual([])
}

export async function expectPageNoSeriousViolationsInThemes(page: Page): Promise<void> {
  await selectTheme(page, 'light')
  await expectNoSeriousViolations(page)
  await selectTheme(page, 'dark')
  await expectNoSeriousViolations(page)
  await selectTheme(page, 'light')
}

export async function expectModalNoSeriousViolationsInThemes(page: Page): Promise<void> {
  const initialTheme = await currentTheme(page)
  await applyThemeToDocument(page, 'light')
  await expectNoSeriousViolations(page)
  await applyThemeToDocument(page, 'dark')
  await expectNoSeriousViolations(page)
  await applyThemeToDocument(page, initialTheme)
}

export async function expectDocumentNoSeriousViolationsInThemes(page: Page): Promise<void> {
  await expectModalNoSeriousViolationsInThemes(page)
}

async function selectTheme(page: Page, theme: Theme): Promise<void> {
  if ((await currentTheme(page)) !== theme) {
    await page
      .getByRole('button', { name: theme === 'dark' ? 'Use dark theme' : 'Use light theme' })
      .click()
  }
  await expectThemeApplied(page, theme)
  await expect(
    page.getByRole('button', { name: theme === 'dark' ? 'Use light theme' : 'Use dark theme' }),
  ).toHaveAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false')
}

async function applyThemeToDocument(page: Page, theme: Theme): Promise<void> {
  await page.evaluate(async (requestedTheme) => {
    const root = document.documentElement
    root.classList.add('theme-switching')
    root.classList.toggle('dark', requestedTheme === 'dark')
    root.style.colorScheme = requestedTheme
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          root.classList.remove('theme-switching')
          resolve()
        })
      })
    })
  }, theme)
  await expectThemeApplied(page, theme)
}

async function expectThemeApplied(page: Page, theme: Theme): Promise<void> {
  const html = page.locator('html')
  if (theme === 'dark') await expect(html).toHaveClass(/\bdark\b/u)
  else await expect(html).not.toHaveClass(/\bdark\b/u)
  await expect(html).not.toHaveClass(/\btheme-switching\b/u)
  await expect(html).toHaveCSS('color-scheme', theme)
  const tokens = await page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement)
    const bodyStyle = getComputedStyle(document.body)
    return {
      backgroundToken: rootStyle.getPropertyValue('--background').trim(),
      foregroundToken: rootStyle.getPropertyValue('--foreground').trim(),
      bodyBackground: bodyStyle.backgroundColor,
      bodyForeground: bodyStyle.color,
    }
  })
  expect(tokens.backgroundToken).not.toBe(tokens.foregroundToken)
  expect(tokens.bodyBackground).not.toBe(tokens.bodyForeground)
  await expectRepresentativeForegrounds(page, tokens.bodyForeground)
}

async function expectRepresentativeForegrounds(page: Page, foreground: string): Promise<void> {
  for (const selector of ['label', 'input:not([type="hidden"])', '[role="combobox"]']) {
    const target = page.locator(selector).first()
    if ((await target.count()) === 0) continue
    const colors = await target.evaluate((element, expected) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) throw new TypeError('Canvas color comparison is unavailable.')
      const resolve = (color: string) => {
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        return [...context.getImageData(0, 0, 1, 1).data]
      }
      return {
        actual: resolve(getComputedStyle(element).color),
        expected: resolve(expected),
      }
    }, foreground)
    expect(colors.actual).toEqual(colors.expected)
  }
}

async function currentTheme(page: Page): Promise<Theme> {
  return (await page.locator('html').evaluate((element) => element.classList.contains('dark')))
    ? 'dark'
    : 'light'
}
