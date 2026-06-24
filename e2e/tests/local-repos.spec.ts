import { test, expect } from '@playwright/test';
import { authenticate } from './auth';

/**
 * Local Repositories — end-to-end capability check: create a repo, upload a
 * .deb into it, and publish (regenerate Packages/Release). Runs on web only;
 * the create/publish path mutates a shared on-disk index, so we avoid the
 * parallel mobile worker racing it.
 */
test.describe('Local Repositories', () => {
  test.beforeEach(async ({ context }) => {
    await authenticate(context);
  });

  test('create a repo, upload a .deb, and publish', async ({ page }, info) => {
    test.skip(
      info.project.name !== 'web',
      'mutates a shared index — verified on web only',
    );

    await page.goto('/local-repos');
    await expect(
      page.getByRole('heading', { name: 'Local Repositories' }),
    ).toBeVisible();

    // Unique name so re-runs never collide on the existing index.
    const name = `e2e${Date.now()}`;
    const host = `${name}.local`;

    // Create the repo (suite/components/arches are prefilled stable/main/amd64).
    await page.getByRole('button', { name: 'Create' }).first().click();
    await expect(
      page.getByRole('heading', { name: 'Create Local Repository' }),
    ).toBeVisible();
    await page.getByPlaceholder('e.g., team-tools').fill(name);
    await page.getByRole('button', { name: 'Create', exact: true }).last().click();

    // Repo card shows up, initially unsigned with 0 packages.
    await expect(page.getByText(host)).toBeVisible();
    await expect(page.getByText('0 packages')).toBeVisible();

    // Upload a .deb into the "main" component (hidden file input; id has dots,
    // so match by attribute rather than a CSS #id selector).
    await page
      .locator(`input[id="deb-upload-${host}-main"]`)
      .setInputFiles('fixtures/hello-local_1.0.0_amd64.deb');

    // After the chunked upload completes the listing revalidates to 1 package.
    await expect(page.getByText('1 package', { exact: false })).toBeVisible({
      timeout: 30_000,
    });

    // Publish: regenerate Packages/Release. Expect a success toast.
    await page.getByRole('button', { name: /Republish/ }).click();
    await expect(page.locator('.Toastify__toast--success')).toBeVisible({
      timeout: 30_000,
    });

    await page.screenshot({
      path: `screenshots/local-repos-${info.project.name}.png`,
      fullPage: true,
    });
  });
});
