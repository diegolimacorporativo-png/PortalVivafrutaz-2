import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: false,
  retries: 1,
  workers: 1,
  timeout: 45000,
  reporter: [
    ['html', { outputFolder: 'tests/reports', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://localhost:5000',
    trace: 'on-first-retry',
    video: {
      mode: 'on',
      size: { width: 1280, height: 720 },
    },
    screenshot: 'only-on-failure',
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  outputDir: 'tests/videos',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: undefined,
});
