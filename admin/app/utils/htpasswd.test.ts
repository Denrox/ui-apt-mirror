import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  checkCredentials,
  hashPassword,
  isTokenCurrent,
  isTokenRevoked,
  parseHtpasswd,
  parseValidAfter,
  readHtpasswd,
  revokeToken,
  revokeTokens,
  validAfterPath,
  verifyPassword,
  withAuthFileLock,
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

describe('hardening', () => {
  const YEAR = 365 * 24 * 60 * 60 * 1000;

  it('ignores revocation times far in the future', () => {
    writePrivateFile(file, 'admin:x\nbob:y\n');
    writePrivateFile(validAfterPath(file), 'x 1\nbob 99999999999999\n');
    expect(isTokenCurrent(file, 'bob', Date.now())).toBe(true);
    expect(parseValidAfter('bob 99999999999999\nbob 5\n', 10).get('bob')).toBe(5);
  });

  it('refuses to write revocation lines for names with whitespace', () => {
    writePrivateFile(file, 'admin:x\n');
    expect(() => revokeTokens(file, 'x 1\nadmin 99999999999999', YEAR)).toThrow();
    expect(() => revokeTokens(file, 'admin ', YEAR)).toThrow();
  });

  it('does not hash or match passwords openssl would cut short', async () => {
    await expect(hashPassword('Long\nSecretPart')).rejects.toThrow();
    const hash = await hashPassword('Long');
    expect(await verifyPassword('Long', hash)).toBe(true);
    expect(await verifyPassword('Long\nanything', hash)).toBe(false);
    const k256 = 'k'.repeat(256);
    const longHash = await hashPassword(k256);
    expect(await verifyPassword(`${k256}totally-different`, longHash)).toBe(false);
  });

  it('runs locked sections one at a time', async () => {
    const order: string[] = [];
    await Promise.all([
      withAuthFileLock(async () => {
        order.push('a1');
        await new Promise((r) => setTimeout(r, 20));
        order.push('a2');
      }),
      withAuthFileLock(() => {
        order.push('b');
      }),
      withAuthFileLock(() => {
        throw new Error('boom');
      }).catch(() => order.push('c failed')),
      withAuthFileLock(() => order.push('d')),
    ]);
    expect(order).toEqual(['a1', 'a2', 'b', 'c failed', 'd']);
  });
});

describe('single token revocation', () => {
  it('remembers revoked ids until they expire', () => {
    revokeToken(file, 'a', 100, 'bob', 50_000);
    revokeToken(file, 'b', 200, 'bob', 150_000);
    expect(isTokenRevoked(file, 'a')).toBe(false); // expired at 100 s, pruned
    expect(isTokenRevoked(file, 'b')).toBe(true);
    expect(() => revokeToken(file, 'x 1\ny', 300, 'bob')).toThrow();
  });
});
