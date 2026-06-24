import type { BrowserContext } from '@playwright/test';
import jwt from 'jsonwebtoken';

/**
 * The Dockerized admin app authenticates via an `auth_token` JWT cookie signed
 * with the secret baked into config.build.json. We mint that token directly so
 * tests don't depend on the (unknown, user-set) htpasswd password.
 */
const JWT_SECRET = 'HMwZM9EQJBsOQEBwWQLNtBxJqo6SHIFa';
const COOKIE_NAME = 'auth_token';

export function makeAuthToken(username = 'admin'): string {
  return jwt.sign(
    {
      username,
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
      type: 'web',
    },
    JWT_SECRET,
  );
}

/** Inject the auth cookie so subsequent navigations are authenticated. */
export async function authenticate(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: makeAuthToken(),
      domain: 'admin.mirror.intra',
      path: '/',
    },
  ]);
}
