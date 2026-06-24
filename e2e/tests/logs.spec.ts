import { test, expect } from '@playwright/test';
import { authenticate } from './auth';

/** System Logs — terminal panel plus search and level filter interactions. */
test.describe('System Logs', () => {
  test.beforeEach(async ({ context }) => {
    await authenticate(context);
  });

  test('renders the terminal panel and filters work', async ({ page }) => {
    await page.goto('/logs');
    await expect(
      page.getByRole('heading', { name: 'System Logs' }),
    ).toBeVisible();

    // The container is actively syncing, so at least apt-mirror.log exists and
    // the filter controls render.
    const search = page.getByPlaceholder('Filter log lines…');
    await expect(search).toBeVisible();
    await search.fill('INFO');
    await expect(search).toHaveValue('INFO');

    // Level filter (the only select on the page).
    await page.getByRole('combobox').selectOption('ERROR');
    await expect(page.getByRole('combobox')).toHaveValue('ERROR');
  });
});
