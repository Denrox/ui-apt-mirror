import type { BrowserContext } from '@playwright/test';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';

/**
 * We mint the `auth_token` JWT directly (signed with the install's
 * data/auth/.jwt-secret) so tests don't depend on the htpasswd password.
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
      iatMs: Date.now(),
      jti: randomBytes(16).toString('base64url'),
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
