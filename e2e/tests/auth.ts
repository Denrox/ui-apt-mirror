import type { BrowserContext } from '@playwright/test';
import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';

/**
 * The Dockerized admin app authenticates via an `auth_token` JWT cookie signed
 * with the install's own secret, which the app creates on first start in
 * data/auth/.jwt-secret. We mint that token directly so tests don't depend on
 * the (unknown, user-set) htpasswd password. Override the location with
 * E2E_JWT_SECRET_FILE when the stack runs from another directory.
 */
const SECRET_FILE =
  process.env.E2E_JWT_SECRET_FILE ??
  new URL('../../data/auth/.jwt-secret', import.meta.url).pathname;

function jwtSecret(): string {
  try {
    return readFileSync(SECRET_FILE, 'utf-8').trim();
  } catch {
    throw new Error(
      `Cannot read ${SECRET_FILE}; start the stack once so the app creates it, or set E2E_JWT_SECRET_FILE`,
    );
  }
}
const COOKIE_NAME = 'auth_token';

export function makeAuthToken(username = 'admin'): string {
  return jwt.sign(
    {
      username,
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
      type: 'web',
    },
    jwtSecret(),
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
