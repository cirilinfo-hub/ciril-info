import { defineConfig, devices } from '@playwright/test';

const WEB = process.env['E2E_WEB_URL'] ?? 'http://localhost:4200';
const API = process.env['E2E_API_URL'] ?? 'http://localhost:3000';

/**
 * Prerequisites for a local run:
 *   docker compose -f docker-compose.dev.yml up -d   (PostgreSQL, Redis, Mailpit)
 *   npm --prefix apps/api run build                  (API + worker in dist/)
 * The API, worker and Angular dev server are started automatically.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './tests/support/global-setup.ts',
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
  webServer: process.env['E2E_WEB_URL']
    ? undefined
    : [
        {
          command: 'node dist/main.js',
          cwd: '../apps/api',
          url: `${API}/health/ready`,
          reuseExistingServer: !process.env['CI'],
          timeout: 60_000,
          env: { LOG_LEVEL: 'warn' },
        },
        {
          command: 'npm start -- --port 4200',
          cwd: '../apps/web',
          url: WEB,
          reuseExistingServer: !process.env['CI'],
          timeout: 180_000,
          env: { NG_CLI_ANALYTICS: 'false' },
        },
      ],
});
