import { randomBytes } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import appConfig from '../config/config.json';
import { clientIp } from './client-address';
import { giveToDirOwner } from './file-owner';
import {
  checkCredentials,
  isTokenCurrent,
  isTokenRevoked,
  revokeToken,
  revokeTokens,
  TOKEN_MAX_AGE_MS,
} from './htpasswd';
import { beginLoginAttempt, loginSucceeded } from './login-limiter';
import { usernameError } from './password-rules';
import { assertSameOrigin, isPublicHostRequest } from './request-guard';

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
// Marks a browser that has signed in as the user, for the login limiter.
const DEVICE_COOKIE_NAME = 'login_device';
const DEVICE_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

type TokenType = 'web' | 'npm' | 'device';

export interface AuthUser {
  username: string;
  exp: number;
  type: TokenType;
  iatMs: number;
  jti: string;
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

// Not a valid username, so it can't clash with an account.
const INVALID_USERNAME = '<invalid>';

/** validateCredentials behind the per-IP and per-user failure limit. */
export async function attemptLogin(
  request: Request,
  credentials: LoginCredentials,
): Promise<{ ok: boolean; retryAfter?: number }> {
  const ip = clientIp(request);
  // A name no account can have is counted under one fixed name, so the
  // limiter never keeps what a client typed there (up to the body size).
  const valid = !usernameError(credentials.username);
  const device = valid ? await signedInDevice(request, credentials.username) : undefined;
  const retryAfter = beginLoginAttempt(
    ip,
    valid ? credentials.username : INVALID_USERNAME,
    Date.now(),
    device,
  );
  if (retryAfter > 0) return { ok: false, retryAfter };
  if (!valid) return { ok: false };
  const ok = await validateCredentials(credentials);
  if (ok) loginSucceeded(ip, credentials.username, Date.now(), device);
  return { ok };
}

const NPM_TOKEN_MAX_AGE_MS = TOKEN_MAX_AGE_MS;

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
    jti: randomBytes(16).toString('base64url'),
  };

  return jwt.sign(payload, getJwtSecret());
}

/** Cookie that lets this browser past limits others can fill (see login-limiter). */
export async function createDeviceCookie(username: string): Promise<string> {
  const payload: AuthUser = {
    username,
    exp: Math.floor(Date.now() / 1000) + DEVICE_COOKIE_MAX_AGE / 1000,
    type: 'device',
    iatMs: Date.now(),
    jti: randomBytes(16).toString('base64url'),
  };
  const token = jwt.sign(payload, getJwtSecret());
  return `${DEVICE_COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${DEVICE_COOKIE_MAX_AGE / 1000}; SameSite=Strict`;
}

/** The id of the request's device cookie if it was issued for `username`. */
async function signedInDevice(request: Request, username: string): Promise<string | undefined> {
  const token = extractCookie(request.headers.get('Cookie'), DEVICE_COOKIE_NAME);
  if (!token) return undefined;
  const device = await validateAuthToken(token, 'device');
  return device?.username === username ? device.jti : undefined;
}

export async function createNpmAuthToken(username: string): Promise<string> {
  const payload: AuthUser = {
    username,
    exp: Math.floor(Date.now() / 1000) + NPM_TOKEN_MAX_AGE_MS / 1000,
    type: 'npm',
    iatMs: Date.now(),
    jti: randomBytes(16).toString('base64url'),
  };

  return jwt.sign(payload, getJwtSecret());
}

export async function validateAuthToken(
  token: string,
  type: TokenType = 'web',
): Promise<AuthUser | null> {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as AuthUser;

    if (decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    // npm tokens live a year; they must not open web sessions (and vice versa).
    if (decoded.type !== type) {
      return null;
    }
    if (typeof decoded.iatMs !== 'number' || typeof decoded.jti !== 'string' || !/^[\w-]{1,64}$/.test(decoded.jti)) {
      return null;
    }
    if (!isTokenCurrent(appConfig.htpasswdPath, decoded.username, decoded.iatMs)) {
      return null;
    }
    if (isTokenRevoked(appConfig.htpasswdPath, decoded.jti)) {
      return null;
    }

    return decoded;
  } catch (error) {
    return null;
  }
}

/** Ends the session in the request's cookie for good, not just in this browser. */
export async function revokeSession(request: Request): Promise<void> {
  const token = extractAuthToken(request.headers.get('Cookie'));
  if (!token) return;
  const user = await validateAuthToken(token);
  if (!user) return;
  revokeToken(appConfig.htpasswdPath, user.jti, user.exp, user.username);
}

export function createAuthCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${COOKIE_MAX_AGE / 1000}; SameSite=Strict`;
}

export function createLogoutCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`;
}

export function extractAuthToken(cookieHeader: string | null): string | null {
  return extractCookie(cookieHeader, COOKIE_NAME);
}

function extractCookie(cookieHeader: string | null, cookieName: string): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());

  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === cookieName) {
      return value;
    }
  }

  return null;
}

/**
 * The signed-in web user, or null. Always null on the public hosts, which
 * serve no admin pages. Throws 403 for a cross-origin state-changing request.
 */
export async function requireAuth(request: Request): Promise<AuthUser | null> {
  if (isPublicHostRequest(request)) return null;
  assertSameOrigin(request);

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

/** Ends one npm token for good (`npm logout`). False if it was not a valid npm token. */
export async function revokeNpmToken(token: string): Promise<boolean> {
  const user = await validateAuthToken(token, 'npm');
  if (!user) return false;
  revokeToken(appConfig.htpasswdPath, user.jti, user.exp, user.username);
  return true;
}
