import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const htpasswdPath = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'users-action-')), '.htpasswd');
});
vi.mock('~/config/config.json', () => ({ default: { htpasswdPath } }));

import { action } from './actions';
import { createAuthToken, validateAuthToken } from '~/utils/server-auth';
import { checkCredentials, hashPassword, validAfterPath, writePrivateFile } from '~/utils/htpasswd';

afterAll(() => fs.rmSync(path.dirname(htpasswdPath), { recursive: true, force: true }));

beforeEach(async () => {
  writePrivateFile(htpasswdPath, `admin:${await hashPassword('adminpass')}\nbob:${await hashPassword('bobpass')}\n`);
  fs.rmSync(validAfterPath(htpasswdPath), { force: true });
});

async function post(fields: Record<string, string>, as = 'admin') {
  const token = await createAuthToken(as);
  const request = new Request('http://admin.mirror.intra/users', {
    method: 'POST',
    headers: { Cookie: `auth_token=${token}` },
    body: new URLSearchParams(fields),
  });
  const result = (await action({ request })) as any;
  return result?.data ?? result;
}

const lines = (user: string) =>
  fs.readFileSync(htpasswdPath, 'utf-8').split('\n').filter((l) => l.startsWith(`${user}:`)).length;

describe('addUser', () => {
  it('creates a user once when the same name is added in parallel', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => post({ intent: 'addUser', username: 'dup', password: `DupPass${i}` })),
    );
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.filter((r) => r.error === 'User already exists')).toHaveLength(4);
    expect(lines('dup')).toBe(1);
  });

  it('refuses usernames over 64 characters', async () => {
    const r = await post({ intent: 'addUser', username: 'u'.repeat(20008), password: 'abcd' });
    expect(r.error).toMatch(/at most 64/);
    expect(lines('u'.repeat(20008))).toBe(0);
  });

  it('refuses passwords openssl would cut short', async () => {
    const r1 = await post({ intent: 'addUser', username: 'nl', password: 'Long\nSecretPart' });
    expect(r1.error).toMatch(/control characters/);
    const r2 = await post({ intent: 'addUser', username: 'long', password: 'k'.repeat(300) });
    expect(r2.error).toMatch(/too long/);
    expect(fs.readFileSync(htpasswdPath, 'utf-8')).not.toMatch(/^\$6\$/m);
  });
});

describe('changePassword', () => {
  it('refuses a password with a line break', async () => {
    const r = await post({ intent: 'changePassword', username: 'bob', newPassword: 'ab\nxxxx' });
    expect(r.error).toMatch(/control characters/);
    expect(await checkCredentials(htpasswdPath, 'bob', 'bobpass')).toBe(true);
  });

  it('asks for the current password when users change their own', async () => {
    const change = (fields: Record<string, string>, as: string) =>
      post({ intent: 'changePassword', newPassword: 'newpass1', ...fields }, as);
    expect(await change({ username: 'bob' }, 'bob')).toEqual({
      success: false,
      error: 'Current password is required',
    });
    expect(await change({ username: 'bob', currentPassword: 'wrong' }, 'bob')).toEqual({
      success: false,
      error: 'Current password is incorrect',
    });
    expect(await change({ username: 'admin' }, 'admin')).toEqual({
      success: false,
      error: 'Current password is required',
    });
    expect(await checkCredentials(htpasswdPath, 'bob', 'bobpass')).toBe(true);
    expect(await checkCredentials(htpasswdPath, 'admin', 'adminpass')).toBe(true);

    expect((await change({ username: 'bob', currentPassword: 'bobpass' }, 'bob')).success).toBe(true);
    expect(await checkCredentials(htpasswdPath, 'bob', 'newpass1')).toBe(true);
  });

  it('limits guesses at the current password like logins', async () => {
    writePrivateFile(htpasswdPath, `admin:${await hashPassword('adminpass')}\ncarl:${await hashPassword('carlpass')}\n`);
    const guess = (currentPassword: string) =>
      post({ intent: 'changePassword', username: 'carl', newPassword: 'newpass1', currentPassword }, 'carl');
    for (let i = 0; i < 5; i++) expect((await guess(`guess${i}`)).error).toBe('Current password is incorrect');
    expect((await guess('carlpass')).error).toMatch(/Too many failed login attempts/);
    expect(await checkCredentials(htpasswdPath, 'carl', 'carlpass')).toBe(true);
  });

  it('lets the admin reset another user\'s password without it', async () => {
    const r = await post({ intent: 'changePassword', username: 'bob', newPassword: 'reset123' });
    expect(r.success).toBe(true);
    expect(await checkCredentials(htpasswdPath, 'bob', 'reset123')).toBe(true);
  });
});

describe('deleteUser', () => {
  it('refuses names that would inject revocation lines', async () => {
    const bobToken = await createAuthToken('bob');
    const r = await post({ intent: 'deleteUser', username: 'x 1\nbob 99999999999999' });
    expect(r.success).toBe(false);
    expect(fs.existsSync(validAfterPath(htpasswdPath))).toBe(false);
    expect(await validateAuthToken(bobToken)).not.toBeNull();
  });

  it('refuses admin with a trailing space and users that do not exist', async () => {
    expect((await post({ intent: 'deleteUser', username: 'admin ' })).success).toBe(false);
    const missing = await post({ intent: 'deleteUser', username: 'nobody' });
    expect(missing).toEqual({ success: false, error: 'User not found' });
    expect(fs.existsSync(validAfterPath(htpasswdPath))).toBe(false);
  });

  it('deletes an existing user and revokes their tokens', async () => {
    const bobToken = await createAuthToken('bob');
    expect((await post({ intent: 'deleteUser', username: 'bob' })).success).toBe(true);
    expect(lines('bob')).toBe(0);
    expect(await validateAuthToken(bobToken)).toBeNull();
  });
});
