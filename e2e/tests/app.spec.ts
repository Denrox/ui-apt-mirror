import { test, expect } from '@playwright/test';
import { authenticate } from './auth';

/**
 * Authenticated app shell + key screens, on desktop and mobile. Desktop should
 * render the fixed sidebar; mobile should render the bottom tab bar instead.
 */
test.describe('Admin app', () => {
  test.beforeEach(async ({ context }) => {
    await authenticate(context);
  });

  test('dashboard renders with the correct nav shell', async ({ page }, info) => {
    await page.goto('/home');
    await expect(
      page.getByRole('heading', { name: 'System Overview' }),
    ).toBeVisible();
    await expect(page.getByText('Active Repositories')).toBeVisible();
    await expect(page.getByText('Service Status')).toBeVisible();

    if (info.project.name === 'web') {
      // Desktop: persistent sidebar visible, bottom bar absent.
      await expect(page.locator('aside')).toBeVisible();
    } else {
      // Mobile: sidebar hidden, bottom tab bar (the only <nav>) visible.
      await expect(page.locator('aside')).toBeHidden();
      const bottomNav = page.getByRole('navigation');
      await expect(bottomNav).toBeVisible();
      await expect(
        bottomNav.getByRole('link', { name: 'Files' }),
      ).toBeVisible();
      await expect(
        bottomNav.getByRole('link', { name: 'Dashboard' }),
      ).toBeVisible();
    }

    await page.screenshot({
      path: `screenshots/dashboard-${info.project.name}.png`,
      fullPage: true,
    });
  });

  test('navigates to System Logs', async ({ page }, info) => {
    await page.goto('/home');
    await page.getByRole('link', { name: 'Logs' }).first().click();
    await expect(
      page.getByRole('heading', { name: 'System Logs' }),
    ).toBeVisible();
    await page.screenshot({
      path: `screenshots/logs-${info.project.name}.png`,
      fullPage: true,
    });
  });

  test('navigates to User Management', async ({ page }, info) => {
    await page.goto('/users');
    await expect(
      page.getByRole('heading', { name: /User Management|Settings/ }),
    ).toBeVisible();
    await expect(page.getByText('Registry')).toBeVisible();
    await page.screenshot({
      path: `screenshots/users-${info.project.name}.png`,
      fullPage: true,
    });
  });
});
