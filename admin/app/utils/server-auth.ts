import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import appConfig from '../config/config.json';

const JWT_SECRET = appConfig.jwtSecret;
const COOKIE_NAME = 'auth_token';
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000;

export interface AuthUser {
  username: string;
  exp: number;
  type?: 'web' | 'npm'; // Token type
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export function validateCredentials(
  credentials: LoginCredentials,
): Promise<boolean> {
  return new Promise(async (resolve) => {
    try {
      const htpasswdPath = appConfig.htpasswdPath;
      const htpasswdContent = readFileSync(htpasswdPath, 'utf-8');

      const lines = htpasswdContent.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        if (line.startsWith('#')) continue;

        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const username = line.substring(0, colonIndex);
        const hash = line.substring(colonIndex + 1);

        if (username === credentials.username) {
          if (hash.startsWith('$6$')) {
            try {
              const parts = hash.split('$');
              if (parts.length === 4) {
                const salt = parts[2];
                const escapedPassword = credentials.password.replace(
                  /'/g,
                  "'\\''",
                );
                const result = execSync(
                  `printf '%s' '${escapedPassword}' | openssl passwd -6 -stdin -salt '${salt}'`,
                  { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
                ).trim();

                resolve(result === hash);
                return;
              }
            } catch (error) {
              console.error('Error validating password with openssl:', error);
              resolve(false);
              return;
            }
          }
          resolve(false);
          return;
        }
      }

      resolve(false);
    } catch (error) {
      console.error('Error validating credentials:', error);
      resolve(false);
    }
  });
}

export async function createAuthToken(username: string): Promise<string> {
  const payload: AuthUser = {
    username,
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours from now
    type: 'web',
  };

  return jwt.sign(payload, JWT_SECRET);
}

export async function createNpmAuthToken(username: string): Promise<string> {
  const payload: AuthUser = {
    username,
    exp: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year from now (npm tokens are long-lived)
    type: 'npm',
  };

  return jwt.sign(payload, JWT_SECRET);
}

export async function validateAuthToken(
  token: string,
): Promise<AuthUser | null> {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;

    if (decoded.exp < Math.floor(Date.now() / 1000)) {
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

// Validate NPM token (Bearer token from Authorization header)
export async function validateNpmAuthToken(token: string): Promise<AuthUser | null> {
  // NPM tokens are just JWT tokens, validate them the same way
  return await validateAuthToken(token);
}
