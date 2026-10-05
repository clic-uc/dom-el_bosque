import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright (§12.5). Contra un servidor ya levantado: E2E_BASE_URL=http://localhost:3100 pnpm test:e2e.
 * Sin E2E_BASE_URL levanta `pnpm dev` en el 3000. Los usuarios de prueba se crean con `pnpm e2e:seed --temp`.
 *
 * El proyecto `setup` (e2e/global.setup.ts) inicia sesión con cada rol y guarda el estado en e2e/.auth/*.json;
 * los demás proyectos dependen de él y reutilizan esas sesiones (ver e2e/fixtures.ts).
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
