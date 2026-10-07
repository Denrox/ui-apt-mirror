import { execFile } from 'child_process';
import { randomBytes, timingSafeEqual } from 'crypto';
import {
  chmodSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { giveToDirOwner } from './file-owner';

const cache = new Map<string, { key: string; value: unknown }>();

function readCached<T>(
  file: string,
  parse: (content: string) => T,
  empty: T,
): T {
  let key: string;
  try {
    const st = statSync(file);
    key = `${st.ino}:${st.mtimeMs}:${st.size}`;
  } catch {
    cache.delete(file);
    return empty;
  }
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.value as T;
  const value = parse(readFileSync(file, 'utf-8'));
  cache.set(file, { key, value });
  return value;
}

/** Atomic write, owner-only (0600), owned like the directory. */
export function writePrivateFile(file: string, content: string): void {
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, content, { mode: 0o600 });
    chmodSync(temp, 0o600);
    giveToDirOwner(temp);
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  } finally {
    cache.delete(file);
  }
}

export function parseHtpasswd(content: string): Map<string, string> {
  const users = new Map<string, string>();
  for (const line of content.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    users.set(line.substring(0, colon), line.substring(colon + 1).trim());
  }
  return users;
}

export function readHtpasswd(file: string): Map<string, string> {
  return readCached(file, parseHtpasswd, new Map());
}

/**
 * Runs `fn` after every earlier call has finished. Read-modify-write of the
 * auth files goes through here, so two requests can't both pass a check and
 * then both write (duplicate users, lost updates).
 */
let authFileQueue: Promise<unknown> = Promise.resolve();
export function withAuthFileLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = authFileQueue.then(fn, fn);
  authFileQueue = run.catch(() => {});
  return run;
}

export function hashPassword(password: string, salt?: string): Promise<string> {
  const args = ['passwd', '-6', '-stdin'];
  if (salt) args.push('-salt', salt);
  return new Promise((resolve, reject) => {
    const child = execFile(
      'openssl',
      args,
      { timeout: 10000 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.toString().trim());
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(password);
  });
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const parts = hash.split('$');
  if (!hash.startsWith('$6$') || parts.length !== 4) return false;
  const computed = Buffer.from(await hashPassword(password, parts[2]));
  const expected = Buffer.from(hash);
  return (
    computed.length === expected.length && timingSafeEqual(computed, expected)
  );
}

// Unknown users cost a hash too, so response time doesn't reveal who exists.
const DUMMY_HASH = `$6$${randomBytes(8).toString('hex')}$x`;

export async function checkCredentials(
  file: string,
  username: string,
  password: string,
): Promise<boolean> {
  const hash = readHtpasswd(file).get(username);
  const ok = await verifyPassword(password, hash ?? DUMMY_HASH);
  return ok && hash !== undefined;
}

// "<user> <ms>" lines; tokens issued before a user's latest time are revoked.
export function validAfterPath(htpasswdFile: string): string {
  return path.join(path.dirname(htpasswdFile), '.tokens-valid-after');
}

// A time this far ahead can't have come from revokeTokens; such a line would
// refuse every token of the user, fresh logins included, until then.
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

export function parseValidAfter(content: string, now = Date.now()): Map<string, number> {
  const entries = new Map<string, number>();
  for (const line of content.split('\n')) {
    const [user, ms, ...rest] = line.trim().split(/\s+/);
    if (!user || rest.length || !/^\d+$/.test(ms ?? '')) continue;
    const since = Number(ms);
    if (since > now + MAX_FUTURE_SKEW_MS) continue;
    entries.set(user, Math.max(since, entries.get(user) ?? 0));
  }
  return entries;
}

export function readValidAfter(htpasswdFile: string): Map<string, number> {
  return readCached(validAfterPath(htpasswdFile), (c) => parseValidAfter(c), new Map());
}

export function revokeTokens(
  htpasswdFile: string,
  username: string,
  maxTokenAgeMs: number,
  now = Date.now(),
): void {
  // One "<user> <ms>" per line: a name with whitespace would add lines of its own.
  if (!username || /[\s:]/.test(username)) {
    throw new Error(`Refusing to revoke tokens of invalid username ${JSON.stringify(username)}`);
  }
  const entries = new Map(readValidAfter(htpasswdFile)).set(username, now);
  const lines = [...entries]
    .filter(([, since]) => since >= now - maxTokenAgeMs)
    .map(([user, since]) => `${user} ${since}\n`);
  writePrivateFile(validAfterPath(htpasswdFile), lines.join(''));
}

export function isTokenCurrent(
  htpasswdFile: string,
  username: string,
  issuedAtMs: number | undefined,
): boolean {
  if (!readHtpasswd(htpasswdFile).has(username)) return false;
  const validAfter = readValidAfter(htpasswdFile).get(username);
  if (validAfter === undefined) return true;
  return issuedAtMs !== undefined && issuedAtMs >= validAfter;
}
