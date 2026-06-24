import { test, expect } from '@playwright/test';
import { authenticate } from './auth';

/** File Manager — listing, view selector, and the mirrored-packages warning. */
test.describe('File Manager', () => {
  test.beforeEach(async ({ context }) => {
    await authenticate(context);
  });

  test('loads with header, path bar and view selector', async ({
    page,
  }, info) => {
    await page.goto('/file-manager');

    await expect(
      page.getByRole('heading', { name: 'File Manager' }),
    ).toBeVisible();
    await expect(page.getByText('Current Path:')).toBeVisible();
    await expect(page.getByRole('combobox')).toBeVisible();

    await page.screenshot({
      path: `screenshots/file-manager-${info.project.name}.png`,
      fullPage: true,
    });
  });

  test('switching to Mirrored Packages surfaces the warning', async ({
    page,
  }) => {
    await page.goto('/file-manager');
    await page
      .getByRole('combobox')
      .selectOption({ label: 'Mirrored Packages' });
    await expect(
      page.getByText(/Manual changes can break mirror functionality/i),
    ).toBeVisible();
  });
});
