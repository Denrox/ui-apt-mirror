import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  checkCredentials,
  hashPassword,
  isTokenCurrent,
  parseHtpasswd,
  readHtpasswd,
  revokeTokens,
  validAfterPath,
  verifyPassword,
  writePrivateFile,
} from './htpasswd';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htpasswd-'));
  file = path.join(dir, '.htpasswd');
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('parseHtpasswd', () => {
  it('skips comments, blank and malformed lines', () => {
    const users = parseHtpasswd('# c\nadmin:$6$a$b\n\nbroken\nbob:$6$c$d\n');
    expect([...users.keys()]).toEqual(['admin', 'bob']);
    expect(users.get('bob')).toBe('$6$c$d');
  });
});

describe('password hashing', () => {
  it('verifies without a shell, whatever the password contains', async () => {
    const password = `it's "$(touch ${dir}/pwned)" \`id\``;
    const hash = await hashPassword(password);
    expect(hash).toMatch(/^\$6\$/);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'pwned'))).toBe(false);
  });

  it('rejects unknown users and non-SHA-512 hashes', async () => {
    writePrivateFile(
      file,
      `admin:${await hashPassword('secret')}\nold:$apr1$x$y\n`,
    );
    expect(await checkCredentials(file, 'admin', 'secret')).toBe(true);
    expect(await checkCredentials(file, 'nobody', 'secret')).toBe(false);
    expect(await checkCredentials(file, 'old', 'secret')).toBe(false);
  });
});

describe('writePrivateFile', () => {
  it('replaces a world-readable file with an owner-only one', () => {
    fs.writeFileSync(file, 'admin:x\n', { mode: 0o644 });
    writePrivateFile(file, 'admin:y\n');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(file, 'utf-8')).toBe('admin:y\n');
    expect(fs.readdirSync(dir)).toEqual(['.htpasswd']);
  });

  it('invalidates the cached read', () => {
    writePrivateFile(file, 'admin:x\n');
    expect(readHtpasswd(file).has('bob')).toBe(false);
    writePrivateFile(file, 'admin:x\nbob:y\n');
    expect(readHtpasswd(file).has('bob')).toBe(true);
  });
});

describe('token revocation', () => {
  const YEAR = 365 * 24 * 60 * 60 * 1000;

  beforeEach(() => writePrivateFile(file, 'admin:x\nbob:y\n'));

  it('accepts tokens of existing, unrevoked users', () => {
    expect(isTokenCurrent(file, 'bob', 1000)).toBe(true);
    expect(isTokenCurrent(file, 'bob', undefined)).toBe(true);
  });

  it('rejects tokens of users no longer in .htpasswd', () => {
    writePrivateFile(file, 'admin:x\n');
    expect(isTokenCurrent(file, 'bob', Date.now())).toBe(false);
  });

  it('rejects tokens issued before the revocation, accepts later ones', () => {
    revokeTokens(file, 'bob', YEAR, 5000);
    expect(isTokenCurrent(file, 'bob', 4999)).toBe(false);
    expect(isTokenCurrent(file, 'bob', undefined)).toBe(false);
    expect(isTokenCurrent(file, 'bob', 5000)).toBe(true);
    expect(isTokenCurrent(file, 'admin', 1)).toBe(true);
    expect(fs.statSync(validAfterPath(file)).mode & 0o777).toBe(0o600);
  });

  it('drops entries older than the longest token lifetime', () => {
    revokeTokens(file, 'admin', YEAR, 1000);
    revokeTokens(file, 'bob', YEAR, 1000 + YEAR + 1);
    expect(fs.readFileSync(validAfterPath(file), 'utf-8')).toBe(
      `bob ${1000 + YEAR + 1}\n`,
    );
  });

  it('honours lines appended by setup.sh', () => {
    revokeTokens(file, 'admin', YEAR, 1000);
    fs.appendFileSync(validAfterPath(file), 'admin 3000\n');
    expect(isTokenCurrent(file, 'admin', 2000)).toBe(false);
    expect(isTokenCurrent(file, 'admin', 3000)).toBe(true);
  });
});
