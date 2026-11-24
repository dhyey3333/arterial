import { defineConfig } from '@playwright/test';

/**
 * Two runs:
 * - fixtures: the whole interface on design fixtures (no backend needed).
 * - offline: the live build pointed at an API that is not there, to check the
 *   app says so plainly and keeps retrying instead of showing invented data.
 * Uses the installed Google Chrome, so no browser download is needed.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: [['list']],
  use: { channel: 'chrome', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [
    { name: 'fixtures', testMatch: /fixtures\.spec\.ts/, use: { baseURL: 'http://localhost:5173' } },
    { name: 'offline', testMatch: /offline\.spec\.ts/, use: { baseURL: 'http://localhost:5174' } },
  ],
  webServer: [
    { command: 'npx vite --mode fixtures --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
    {
      command: 'npx vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: true,
      timeout: 60_000,
      env: { VITE_API_URL: 'http://127.0.0.1:9', VITE_DATA_SOURCE: 'live' },
    },
  ],
});
