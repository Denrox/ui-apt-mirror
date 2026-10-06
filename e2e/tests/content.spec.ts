import { test, expect } from '@playwright/test';
import { authenticate } from './auth';

/** Documentation and Cheatsheets content screens. */
test.describe('Content screens', () => {
  test.beforeEach(async ({ context }) => {
    await authenticate(context);
  });

  test('documentation renders category nav and content', async ({
    page,
  }, info) => {
    await page.goto('/documentation/file-structure');

    await expect(
      page.getByRole('link', { name: 'File Structure' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Commands' })).toBeVisible();
    await expect(page.getByText('Data Directory Structure')).toBeVisible();

    await page.screenshot({
      path: `screenshots/documentation-${info.project.name}.png`,
      fullPage: true,
    });
  });

  test('cheatsheets renders the sources panel', async ({ page }, info) => {
    await page.goto('/cheatsheets');

    // Nothing is bundled, so a fresh install shows only the way to add sources.
    await expect(page.getByText('GitHub URL')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add source' })).toBeVisible();

    await page.screenshot({
      path: `screenshots/cheatsheets-${info.project.name}.png`,
      fullPage: true,
    });
  });
});
