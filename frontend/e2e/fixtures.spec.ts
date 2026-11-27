import { expect, test } from '@playwright/test';

test.describe('on design fixtures', () => {
  test('landing: names the product, says the data is sample data, and opens the console', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: /Traffic forecasts/ })).toBeVisible();
    await expect(page.getByText('Showing design fixtures', { exact: false })).toBeVisible();
    await page.locator('.lp-hero').getByRole('link', { name: 'Open the console' }).click();
    await expect(page).toHaveURL(/\/console$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Command center' })).toBeVisible();
  });

  test('landing: the forecast section runs forward as you scroll', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.lp-scrub')).toBeAttached();
    await page.evaluate(() => {
      const s = document.querySelector<HTMLElement>('.lp-scrub')!;
      window.scrollTo(0, s.offsetTop + (s.offsetHeight - innerHeight) * 0.6);
    });
    await expect(page.locator('.lp-clock')).toHaveText(/\+\d+ min/);
    // the map says what it shows: the corridors in the forecast's colours at the step the clock is on
    await expect(page.locator('.lp-fmap')).toHaveAttribute('role', 'img');
    await expect(page.locator('.lp-fmap')).toHaveAttribute('aria-label', /corridors coloured by the forecast in \d+ minutes/);
    await expect(page.locator('.lp-fmap__core path')).toHaveCount(21);
  });

  test('landing: the analytics section shows the week, as a landscape or a grid', async ({ page }) => {
    await page.goto('/');
    const peaks = page.locator('#peaks');
    await peaks.scrollIntoViewIfNeeded();
    await expect(peaks.getByRole('heading', { level: 2, name: /When each corridor congests/ })).toBeVisible();
    // the 3D landscape where the browser has a GPU, the flat grid where it does not: one of them, never neither
    await expect(peaks.locator('.lp-peaks__stage canvas, .lp-peaks__stage .heat').first()).toBeVisible();
    await expect(peaks.getByText('Worst hour')).toBeVisible();
    await expect(peaks.getByText(/simulated days/)).toBeVisible();
  });

  test('command center: banner, live stream, map and dock', async ({ page }) => {
    await page.goto('/console');
    await expect(page.getByRole('note')).toContainText('Design fixtures.');
    await expect(page.getByRole('heading', { level: 1, name: 'Command center' })).toBeVisible();
    // the fixtures stream is sample data, and its pill says so
    await expect(page.locator('.pill')).toHaveText('Sample stream');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Likely to slow in 10 min' })).toBeVisible();
  });

  test('every page opens from the navigation', async ({ page }) => {
    await page.goto('/console');
    for (const name of ['Traffic', 'Forecast', 'Incidents', 'Routes', 'Analytics', 'System', 'Command center']) {
      await page.getByRole('navigation').getByRole('link', { name }).click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    }
  });

  test('traffic: sorts the table and opens a segment in a drawer', async ({ page }) => {
    await page.goto('/traffic');
    const rows = page.locator('table.ledger__grid tbody tr');
    await expect(rows).toHaveCount(21);
    await page.getByRole('button', { name: 'Segment', exact: true }).click();
    await expect(page.getByRole('columnheader', { name: 'Segment', exact: true })).toHaveAttribute('aria-sort', 'ascending');
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

  test('forecast: the time stack opens over the map and closes again', async ({ page }) => {
    await page.goto('/forecast');
    const view = page.getByRole('radiogroup', { name: 'Forecast view' });
    await view.getByText('Time stack').click();
    // the 3D view loads on demand; without WebGL it says so, and either way the list stays usable
    await expect(page.getByRole('group', { name: /Forecast time stack/ })).toBeVisible();
    await expect(page.getByText('drag to turn', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Highest risk in 10 min' })).toBeVisible();
    await view.getByText('Map').click();
    await expect(page.getByRole('group', { name: /Forecast time stack/ })).toHaveCount(0);
    await expect(page.getByText('Map shows the forecast in', { exact: false })).toBeVisible();
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

  test('routes: places are searched, a request draws a route, an unsupported pair says why', async ({ page }) => {
    await page.goto('/routes');
    await expect(page.getByRole('button', { name: 'Find the fastest route' })).toBeDisabled();
    // search by a junction's name, and by a road that meets there
    await page.getByRole('combobox', { name: 'From' }).fill('silk board');
    await page.getByRole('option', { name: /^Silk Board Junction/ }).click();
    await page.getByRole('combobox', { name: 'To' }).fill('bella');
    // the first match is highlighted as the list opens: Enter picks it
    await expect(page.getByRole('option', { name: /^Bellandur/ })).toBeVisible();
    await page.getByRole('combobox', { name: 'To' }).press('Enter');
    await expect(page.getByRole('combobox', { name: 'To' })).toHaveValue('Bellandur');
    await page.getByRole('button', { name: 'Find the fastest route' }).click();
    await expect(page.getByText('Recommended now')).toBeVisible();
    await page.getByRole('combobox', { name: 'To' }).fill('nowhere at all');
    await expect(page.getByText(/Nothing called/)).toBeVisible();
    await page.getByRole('combobox', { name: 'To' }).fill('kudlu');
    await page.getByRole('option', { name: /^Kudlu Gate/ }).click();
    await page.getByRole('button', { name: 'Find the fastest route' }).click();
    await expect(page.getByText('No route', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show the sample route' }).click();
    await expect(page.getByText('Recommended now')).toBeVisible();
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

  test('analytics: the landscape view opens and the grid comes back', async ({ page }) => {
    await page.goto('/analytics');
    const view = page.getByRole('radiogroup', { name: 'Heat view' });
    await view.getByText('Landscape', { exact: true }).click();
    await expect(page.getByRole('group', { name: /The week as a landscape/ })).toBeVisible();
    await view.getByText('Grid', { exact: true }).click();
    await expect(page.locator('.heat__cell').first()).toBeVisible();
  });

  test('keyboard: the skip link comes first', async ({ page }) => {
    await page.goto('/traffic');
    await expect(page.getByRole('heading', { level: 1, name: 'Traffic' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });
});
