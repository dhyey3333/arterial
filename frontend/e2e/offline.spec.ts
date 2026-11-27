import { expect, test } from '@playwright/test';

// The live build with no API behind it: it must say so and keep retrying, never show invented numbers.
test.describe('live build with the API down', () => {
  test('landing draws the network without claiming data', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: /Traffic forecasts/ })).toBeVisible();
    await expect(page.getByText('Waiting for the stream', { exact: false })).toBeVisible();
    await expect(page.getByText('Forecasts appear once the stream runs').first()).toBeAttached();
  });

  test('command center reports the failure and the stream retries', async ({ page }) => {
    await page.goto('/console');
    await expect(page.getByRole('note')).toHaveCount(0); // no fixture banner in the live build
    await expect(page.getByRole('alert')).toContainText('Cannot load traffic data');
    await expect(page.locator('.pill')).toHaveText(/Reconnecting|Offline/);
    await expect(page.locator('.kpis')).toContainText('–');
  });

  test('system page has no status to show and says so', async ({ page }) => {
    await page.goto('/system');
    await expect(page.getByText('No status from the API')).toBeVisible();
  });
});
