import { expect, test } from '@playwright/test';

test.describe('on design fixtures', () => {
  test('command center: banner, live stream, map and dock', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('note')).toContainText('Design fixtures.');
    await expect(page.getByRole('heading', { level: 1, name: 'Command center' })).toBeVisible();
    await expect(page.locator('.pill')).toHaveText('Live');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Likely to slow in 10 min' })).toBeVisible();
  });

  test('every page opens from the navigation', async ({ page }) => {
    await page.goto('/');
    for (const name of ['Traffic', 'Forecast', 'Incidents', 'Routes', 'Analytics', 'System', 'Command center']) {
      await page.getByRole('navigation').getByRole('link', { name }).click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    }
  });

  test('traffic: sorts the table and opens a segment in a drawer', async ({ page }) => {
    await page.goto('/traffic');
    const rows = page.locator('table.table tbody tr');
    await expect(rows).toHaveCount(21);
    await page.getByRole('button', { name: 'Segment', exact: true }).click();
    await expect(page.getByRole('columnheader', { name: 'Segment' })).toHaveAttribute('aria-sort', 'ascending');
    await page.getByPlaceholder('Find a road or segment id').fill('ORR-03');
    await expect(rows).toHaveCount(1);
    await rows.first().getByRole('button').click();
    const dialog = page.getByRole('dialog', { name: 'Segment details' });
    await expect(dialog.getByRole('heading', { name: 'Outer Ring Road' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('forecast: horizon switch and the honest model card', async ({ page }) => {
    await page.goto('/forecast');
    await expect(page.getByText('Rule-based baseline')).toBeVisible();
    await page.getByRole('radiogroup', { name: 'Forecast horizon' }).getByText('15 min').click();
    await expect(page.getByRole('heading', { name: 'Highest risk in 15 min' })).toBeVisible();
    await expect(page.getByText('it is not a probability', { exact: false })).toBeVisible();
  });

  test('incidents: says the anomaly is simulated and shows evidence', async ({ page }) => {
    await page.goto('/incidents/INC-0413');
    await expect(page.getByRole('heading', { level: 2, name: 'Flow breakdown' })).toBeVisible();
    await expect(page.getByText('It is a pattern, not a verified accident.')).toBeVisible();
    await expect(page.getByRole('table').first()).toContainText('Upstream density');
  });

  test('incidents: an unknown id says so', async ({ page }) => {
    await page.goto('/incidents/INC-9999');
    await expect(page.getByText('Incident not found')).toBeVisible();
  });

  test('routes: a request returns a drawn route; an unsupported pair says why', async ({ page }) => {
    await page.goto('/routes');
    await page.getByRole('button', { name: 'Find the fastest route' }).click();
    await expect(page.getByText('Recommended now')).toBeVisible();
    await page.getByLabel('To', { exact: true }).selectOption({ label: 'Kudlu Gate' });
    await page.getByRole('button', { name: 'Find the fastest route' }).click();
    await expect(page.getByText('No route', { exact: true })).toBeVisible();
  });

  test('system: pipeline stages and the browser stream panel', async ({ page }) => {
    await page.goto('/system');
    await expect(page.getByText('validate-telemetry')).toBeVisible();
    await expect(page.getByText('segment-window')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This browser' })).toBeVisible();
  });

  test('analytics: heat grid cells read out on focus', async ({ page }) => {
    await page.goto('/analytics');
    const cell = page.locator('.heat__cell').first();
    await cell.focus();
    await expect(page.locator('.heat__readout strong')).toHaveText(/%$/);
    await expect(page.locator('.heat__readout')).toContainText('ORR-03 at 00:00');
  });

  test('keyboard: the skip link comes first', async ({ page }) => {
    await page.goto('/traffic');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });
});
