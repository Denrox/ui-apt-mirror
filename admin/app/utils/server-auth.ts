import { randomBytes } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import appConfig from '../config/config.json';
import { giveToDirOwner } from './file-owner';
import { checkCredentials, isTokenCurrent, revokeTokens } from './htpasswd';
import { beginLoginAttempt, clientIp, loginSucceeded } from './login-limiter';

// Per-install secret, created on first use next to .htpasswd. Never ship one
// in config: whoever knows it can forge an admin login.
let jwtSecret: string | null = null;

export function getJwtSecret(): string {
  if (jwtSecret) return jwtSecret;
  const dir = path.dirname(appConfig.htpasswdPath);
  const file = path.join(dir, '.jwt-secret');
  try {
    const existing = readFileSync(file, 'utf-8').trim();
    if (existing.length >= 32) {
      giveToDirOwner(file);
      return (jwtSecret = existing);
    }
  } catch {}
  const secret = randomBytes(48).toString('base64url');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  giveToDirOwner(file);
  return (jwtSecret = secret);
}
const COOKIE_NAME = 'auth_token';
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000;

export interface AuthUser {
  username: string;
  exp: number;
  type?: 'web' | 'npm';
  iat?: number;
  iatMs?: number;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export function validateCredentials(
  credentials: LoginCredentials,
): Promise<boolean> {
  return checkCredentials(
    appConfig.htpasswdPath,
    credentials.username,
    credentials.password,
  ).catch((error) => {
    console.error('Error validating credentials:', error);
    return false;
  });
}

/** validateCredentials behind the per-IP and per-user failure limit. */
export async function attemptLogin(
  request: Request,
  credentials: LoginCredentials,
): Promise<{ ok: boolean; retryAfter?: number }> {
  const ip = clientIp(request);
  const retryAfter = beginLoginAttempt(ip, credentials.username);
  if (retryAfter > 0) return { ok: false, retryAfter };
  const ok = await validateCredentials(credentials);
  if (ok) loginSucceeded(ip, credentials.username);
  return { ok };
}

const NPM_TOKEN_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/** Revokes every web session and npm token issued to the user so far. */
export function revokeUserTokens(username: string): void {
  revokeTokens(appConfig.htpasswdPath, username, NPM_TOKEN_MAX_AGE_MS);
}

export async function createAuthToken(username: string): Promise<string> {
  const payload: AuthUser = {
    username,
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    type: 'web',
    iatMs: Date.now(),
  };

  return jwt.sign(payload, getJwtSecret());
}

export async function createNpmAuthToken(username: string): Promise<string> {
  const payload: AuthUser = {
    username,
    exp: Math.floor(Date.now() / 1000) + NPM_TOKEN_MAX_AGE_MS / 1000,
    type: 'npm',
    iatMs: Date.now(),
  };

  return jwt.sign(payload, getJwtSecret());
}

export async function validateAuthToken(
  token: string,
  type: 'web' | 'npm' = 'web',
): Promise<AuthUser | null> {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as AuthUser;

    if (decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    // npm tokens live a year; they must not open web sessions (and vice versa).
    if ((decoded.type ?? 'web') !== type) {
      return null;
    }
    const issuedAtMs =
      decoded.iatMs ?? (decoded.iat !== undefined ? decoded.iat * 1000 : undefined);
    if (!isTokenCurrent(appConfig.htpasswdPath, decoded.username, issuedAtMs)) {
      return null;
    }

    return decoded;
  } catch (error) {
    return null;
  }
}

export function createAuthCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${COOKIE_MAX_AGE / 1000}; SameSite=Strict`;
}

export function createLogoutCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`;
}

export function extractAuthToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());

  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === COOKIE_NAME) {
      return value;
    }
  }

  return null;
}

export async function requireAuth(request: Request): Promise<AuthUser | null> {
  const cookieHeader = request.headers.get('Cookie');
  const token = extractAuthToken(cookieHeader);

  if (!token) {
    return null;
  }

  return await validateAuthToken(token);
}

export async function validateNpmAuthToken(token: string): Promise<AuthUser | null> {
  return await validateAuthToken(token, 'npm');
}
