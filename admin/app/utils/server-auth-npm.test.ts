import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const htpasswdPath = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'server-auth-npm-')), '.htpasswd');
});
vi.mock('../config/config.json', () => ({ default: { htpasswdPath } }));

import { createAuthToken, createNpmAuthToken, revokeNpmToken, validateAuthToken, validateNpmAuthToken } from './server-auth';
import { writePrivateFile } from './htpasswd';

afterAll(() => fs.rmSync(path.dirname(htpasswdPath), { recursive: true, force: true }));

describe('revokeNpmToken (npm logout)', () => {
  it('ends only the given npm token', async () => {
    writePrivateFile(htpasswdPath, 'admin:x\ngina:y\n');
    const loggedOut = await createNpmAuthToken('gina');
    const other = await createNpmAuthToken('gina');
    expect(await revokeNpmToken(loggedOut)).toBe(true);
    expect(await validateNpmAuthToken(loggedOut)).toBeNull();
    expect(await validateNpmAuthToken(other)).not.toBeNull();
  });

  it('ignores web sessions and anything that is not a valid npm token', async () => {
    writePrivateFile(htpasswdPath, 'admin:x\nhal:y\n');
    const web = await createAuthToken('hal');
    expect(await revokeNpmToken(web)).toBe(false);
    expect(await validateAuthToken(web)).not.toBeNull();
    expect(await revokeNpmToken('garbage')).toBe(false);
    expect(await revokeNpmToken('')).toBe(false);
  });
});
