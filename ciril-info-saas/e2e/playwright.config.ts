import { defineConfig, devices } from '@playwright/test';

const WEB = process.env['E2E_WEB_URL'] ?? 'http://localhost:4200';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  // Start the Angular dev server unless one is already running (or E2E_WEB_URL points elsewhere).
  webServer: process.env['E2E_WEB_URL']
    ? undefined
    : {
        command: 'npm --prefix ../apps/web start -- --port 4200',
        url: WEB,
        reuseExistingServer: !process.env['CI'],
        timeout: 180_000,
      },
});
