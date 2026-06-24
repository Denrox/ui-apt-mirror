import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests for the redesigned admin UI, run against the Dockerized stack.
 *
 * The container serves apps by Host header via nginx (admin.mirror.intra,
 * files.mirror.intra, …). Rather than editing /etc/hosts, we map those
 * hostnames to 127.0.0.1 at the Chromium level with --host-resolver-rules, so
 * both the desktop and mobile (Pixel 5, Chromium-based) projects resolve them.
 */
const hostResolverArgs = [
  '--host-resolver-rules=MAP *.mirror.intra 127.0.0.1, MAP mirror.intra 127.0.0.1',
];

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://admin.mirror.intra',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'web',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: hostResolverArgs },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        launchOptions: { args: hostResolverArgs },
      },
    },
  ],
});
