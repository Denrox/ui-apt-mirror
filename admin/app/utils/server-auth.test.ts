import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const htpasswdPath = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'server-auth-')),
    '.htpasswd',
  );
});
vi.mock('../config/config.json', () => ({ default: { htpasswdPath } }));

import {
  attemptLogin,
  createAuthToken,
  createDeviceCookie,
  createNpmAuthToken,
  requireAuth,
  revokeSession,
  revokeUserTokens,
  validateAuthToken,
  validateNpmAuthToken,
} from './server-auth';
import { hashPassword, writePrivateFile } from './htpasswd';
import { loginLimiterKeys } from './login-limiter';

afterAll(() =>
  fs.rmSync(path.dirname(htpasswdPath), { recursive: true, force: true }),
);

describe('token revocation', () => {
  it('revokes web and npm tokens on password change, then accepts new ones', async () => {
    writePrivateFile(htpasswdPath, 'admin:x\nbob:y\n');
    const web = await createAuthToken('bob');
    const npm = await createNpmAuthToken('bob');
    expect(await validateAuthToken(web)).not.toBeNull();
    expect(await validateNpmAuthToken(npm)).not.toBeNull();

    revokeUserTokens('bob');
    expect(await validateAuthToken(web)).toBeNull();
    expect(await validateNpmAuthToken(npm)).toBeNull();
    expect(
      await validateAuthToken(await createAuthToken('bob')),
    ).not.toBeNull();
  });

  it('rejects tokens of deleted users', async () => {
    writePrivateFile(htpasswdPath, 'admin:x\nbob:y\n');
    const npm = await createNpmAuthToken('bob');
    writePrivateFile(htpasswdPath, 'admin:x\n');
    expect(await validateNpmAuthToken(npm)).toBeNull();
  });
});

describe('attemptLogin', () => {
  const request = (ip: string) =>
    new Request('http://admin/login', { headers: { 'X-Real-IP': ip } });

  it('returns 429 data after five failures from one IP, but not to other IPs', async () => {
    writePrivateFile(htpasswdPath, `carol:${await hashPassword('right')}\n`);
    for (let i = 0; i < 5; i++) {
      expect(
        await attemptLogin(request('9.9.9.9'), {
          username: 'carol',
          password: 'no',
        }),
      ).toEqual({ ok: false });
    }
    const blocked = await attemptLogin(request('9.9.9.9'), {
      username: 'carol',
      password: 'right',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    // The owner on another machine still gets in.
    expect(
      await attemptLogin(request('9.9.9.8'), { username: 'carol', password: 'right' }),
    ).toEqual({ ok: true });
  });

  it('is not reset by a correct login to another account (r3-auth-2)', async () => {
    writePrivateFile(
      htpasswdPath,
      `erin:${await hashPassword('right')}\nmallory:${await hashPassword('mine')}\n`,
    );
    const ip = request('7.7.7.7');
    const results: string[] = [];
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 4; i++) {
        const r = await attemptLogin(ip, { username: 'erin', password: `guess${round}${i}` });
        results.push(r.retryAfter ? '429' : String(r.ok));
      }
      const own = await attemptLogin(ip, { username: 'mallory', password: 'mine' });
      results.push(own.retryAfter ? '429' : String(own.ok));
    }
    expect(results).toEqual([
      'false', 'false', 'false', 'false', 'true',
      'false', '429', '429', '429', '429',
    ]);
    // Erin herself, elsewhere, is not locked out by one address.
    expect(await attemptLogin(request('7.7.7.8'), { username: 'erin', password: 'right' })).toEqual({ ok: true });
  });

  it('clears the counters on success', async () => {
    writePrivateFile(htpasswdPath, `dave:${await hashPassword('right')}\n`);
    for (let i = 0; i < 4; i++) {
      await attemptLogin(request('8.8.8.8'), {
        username: 'dave',
        password: 'no',
      });
    }
    expect(
      (
        await attemptLogin(request('8.8.8.8'), {
          username: 'dave',
          password: 'right',
        })
      ).ok,
    ).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await attemptLogin(request('8.8.8.8'), {
            username: 'dave',
            password: 'no',
          })
        ).retryAfter,
      ).toBeUndefined();
    }
  });

  it('refuses a name no account can have without keeping it', async () => {
    writePrivateFile(htpasswdPath, `frank:${await hashPassword('right')}\n`);
    const huge = `frank${'a'.repeat(1_000_000)}`;
    for (const username of [huge, 'u'.repeat(65), 'frank ', 'fr\nank']) {
      expect(await attemptLogin(request('6.6.6.6'), { username, password: 'right' })).toEqual({ ok: false });
    }
    expect(loginLimiterKeys().every((key) => key.length < 100)).toBe(true);
    // They still count as failures of that address.
    const blocked = await attemptLogin(request('6.6.6.6'), { username: huge, password: 'x' });
    expect(blocked.retryAfter).toBeUndefined();
    expect((await attemptLogin(request('6.6.6.6'), { username: 'frank', password: 'right' })).retryAfter).toBeGreaterThan(0);
  });

  it('lets a browser that signed in before past what others behind a shared address filled', async () => {
    writePrivateFile(
      htpasswdPath,
      `gina:${await hashPassword('right')}\nhal:${await hashPassword('right')}\n`,
    );
    const shared = (cookie?: string) =>
      new Request('http://admin/login', {
        headers: { 'X-Real-IP': '127.0.0.1', ...(cookie ? { Cookie: cookie } : {}) },
      });
    for (let i = 0; i < 5; i++) await attemptLogin(shared(), { username: 'gina', password: 'no' });
    expect((await attemptLogin(shared(), { username: 'gina', password: 'right' })).retryAfter).toBeGreaterThan(0);

    const device = (await createDeviceCookie('gina')).split(';')[0];
    expect(await attemptLogin(shared(`auth_token=x; ${device}`), { username: 'gina', password: 'right' })).toEqual({ ok: true });
    // Only for the name it was issued to.
    for (let i = 0; i < 5; i++) await attemptLogin(shared(), { username: 'hal', password: 'no' });
    expect((await attemptLogin(shared(device), { username: 'hal', password: 'right' })).retryAfter).toBeGreaterThan(0);
    // Not after the user's tokens were revoked (password change, deletion).
    revokeUserTokens('gina');
    for (let i = 0; i < 5; i++) await attemptLogin(shared(), { username: 'gina', password: 'no' });
    expect((await attemptLogin(shared(device), { username: 'gina', password: 'right' })).retryAfter).toBeGreaterThan(0);
  });
});

describe('requireAuth', () => {
  const withCookie = async (init: RequestInit & { url?: string }) => {
    writePrivateFile(htpasswdPath, 'admin:x\n');
    const token = await createAuthToken('admin');
    const headers = new Headers(init.headers);
    headers.set('Cookie', `auth_token=${token}`);
    return new Request(init.url ?? 'http://admin.mirror.intra/users', { ...init, headers });
  };

  it('refuses a post from a page on another mirror host with the admin cookie', async () => {
    const request = await withCookie({
      method: 'POST',
      headers: { Origin: 'http://files.mirror.intra', 'Sec-Fetch-Site': 'same-site' },
      body: new URLSearchParams({ intent: 'addUser' }),
    });
    await expect(requireAuth(request)).rejects.toMatchObject({ status: 403 });
  });

  it('ignores the session cookie on the public hosts', async () => {
    for (const url of ['http://files.mirror.intra/Users', 'http://cheatsheets.mirror.intra/Home']) {
      expect(await requireAuth(await withCookie({ url }))).toBeNull();
    }
  });

  it('accepts same-origin posts and plain gets', async () => {
    const post = await withCookie({
      method: 'POST',
      headers: { Origin: 'http://admin.mirror.intra', 'Sec-Fetch-Site': 'same-origin' },
    });
    expect((await requireAuth(post))?.username).toBe('admin');
    const get = await withCookie({ headers: { 'Sec-Fetch-Site': 'same-site' } });
    expect((await requireAuth(get))?.username).toBe('admin');
  });
});

describe('revokeSession (logout)', () => {
  const cookieRequest = (token: string) =>
    new Request('http://admin.mirror.intra/logout', {
      method: 'POST',
      headers: { Cookie: `auth_token=${token}` },
    });

  it('refuses the logged-out token but keeps the user\'s other sessions', async () => {
    writePrivateFile(htpasswdPath, 'admin:x\nerin:y\n');
    const loggedOut = await createAuthToken('erin');
    const other = await createAuthToken('erin');
    await revokeSession(cookieRequest(loggedOut));
    expect(await validateAuthToken(loggedOut)).toBeNull();
    expect(await validateAuthToken(other)).not.toBeNull();
    const file = path.join(path.dirname(htpasswdPath), '.tokens-revoked');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('ignores requests without a valid cookie', async () => {
    await expect(revokeSession(cookieRequest('garbage'))).resolves.toBeUndefined();
    await expect(
      revokeSession(new Request('http://admin.mirror.intra/logout', { method: 'POST' })),
    ).resolves.toBeUndefined();
  });
});
