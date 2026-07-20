import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4173'
const authStatePath = './test-results/browser-auth.json'

export default defineConfig({
  testDir: './tests/web',
  globalSetup: './tests/web/global-setup.ts',
  outputDir: './test-results/playwright',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/playwright-report' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    storageState: authStatePath,
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: [
    {
      command: 'node scripts/start-e2e-orchestrator.mjs',
      url: 'http://127.0.0.1:3000/ready',
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @simproof/web dev --port 4173',
      url: baseURL,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: 'e2e',
      testIgnore: /\.a11y\.spec\.ts$/u,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'a11y',
      testMatch: [
        /\.a11y\.spec\.ts$/u,
        /generation-lifecycle\.spec\.ts$/u,
        /report-preview-trust\.spec\.ts$/u,
      ],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
