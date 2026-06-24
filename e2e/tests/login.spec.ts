import { test, expect } from '@playwright/test';

/**
 * Login screen — unauthenticated. Verifies the redesigned dark auth card on
 * both desktop and mobile (project-driven viewport).
 */
test.describe('Login', () => {
  test('renders the redesigned secure-access card', async ({ page }, info) => {
    await page.goto('/login');

    await expect(page.getByText('Apt Mirror', { exact: true })).toBeVisible();
    await expect(page.getByText('Secure Access')).toBeVisible();
    await expect(page.getByText('Authorized Personnel Only')).toBeVisible();
    await expect(page.getByPlaceholder('operator_id')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Authenticate Session/i }),
    ).toBeVisible();
    await expect(page.getByText(/Encrypted \(AES-256\)/)).toBeVisible();

    // Dark theme sanity: body background is the near-black surface token.
    const bg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(bg).toBe('rgb(16, 20, 21)'); // #101415

    await page.screenshot({
      path: `screenshots/login-${info.project.name}.png`,
      fullPage: true,
    });
  });
});
