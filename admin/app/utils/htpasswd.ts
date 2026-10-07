import { execFile } from 'child_process';
import { randomBytes, timingSafeEqual } from 'crypto';
import {
  appendFileSync,
  chmodSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { giveToDirOwner } from './file-owner';
import { isHashablePassword } from './password-rules';

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
  // openssl hashes only the first line, cut at 256 bytes: refuse rather than
  // store (or check) something other than what was typed.
  if (!isHashablePassword(password)) {
    return Promise.reject(new Error('Password cannot be hashed as typed'));
  }
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
  if (!isHashablePassword(password)) return false;
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

// Single tokens ended by logout: "<token id> <exp seconds> <user>" lines,
// dropped once the token would have expired anyway.
//
// Logins aren't limited, so a user can log in and out in a loop. The list is
// kept in memory and a logout appends one line; the file is rewritten only
// when it has doubled since the last rewrite, without what had expired. Each user has at most
// MAX_REVOKED_PER_USER entries: past that, a logout ends all of the user's
// tokens through .tokens-valid-after instead (all their other sessions and
// npm tokens included) and their entries are dropped.
export function revokedTokensPath(htpasswdFile: string): string {
  return path.join(path.dirname(htpasswdFile), '.tokens-revoked');
}

/** Longest lifetime of any token (npm tokens); valid-after times older than this are dropped. */
export const TOKEN_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
export const MAX_REVOKED_PER_USER = 1000;
const COMPACT_SLACK_LINES = 1000;

interface RevokedEntry {
  exp: number;
  user: string;
}

export function parseRevokedTokens(content: string): Map<string, RevokedEntry> {
  const entries = new Map<string, RevokedEntry>();
  for (const line of content.split('\n')) {
    const [id, exp, user, ...rest] = line.trim().split(/\s+/);
    if (id && user && !rest.length && /^\d+$/.test(exp ?? '')) entries.set(id, { exp: Number(exp), user });
  }
  return entries;
}

interface RevokedStore {
  key: string | null;
  entries: Map<string, RevokedEntry>;
  byUser: Map<string, Set<string>>;
  lines: number;
  // Lines after the last rewrite: the next one is due when the file has doubled.
  base: number;
}

const revokedStores = new Map<string, RevokedStore>();

function fileKey(file: string): string | null {
  try {
    const st = statSync(file);
    return `${st.ino}:${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
}

function addRevoked(store: RevokedStore, id: string, entry: RevokedEntry): void {
  store.entries.set(id, entry);
  let ids = store.byUser.get(entry.user);
  if (!ids) store.byUser.set(entry.user, (ids = new Set()));
  ids.add(id);
}

function dropRevoked(store: RevokedStore, id: string): void {
  const entry = store.entries.get(id);
  if (!entry) return;
  store.entries.delete(id);
  const ids = store.byUser.get(entry.user);
  ids?.delete(id);
  if (ids && !ids.size) store.byUser.delete(entry.user);
}

/** Drops expired entries and rewrites the file with what is left. */
function compactRevoked(file: string, store: RevokedStore, nowSeconds: number): void {
  for (const [id, { exp }] of [...store.entries]) {
    if (exp < nowSeconds) dropRevoked(store, id);
  }
  const lines = [...store.entries].map(([id, { exp, user }]) => `${id} ${exp} ${user}\n`);
  writePrivateFile(file, lines.join(''));
  store.lines = store.base = lines.length;
  store.key = fileKey(file);
}

function needsCompaction(store: RevokedStore): boolean {
  return store.lines > 2 * store.base + COMPACT_SLACK_LINES;
}

function loadRevoked(htpasswdFile: string, now = Date.now()): RevokedStore {
  const file = revokedTokensPath(htpasswdFile);
  const key = fileKey(file);
  const known = revokedStores.get(file);
  if (known && known.key === key) return known;

  const store: RevokedStore = { key, entries: new Map(), byUser: new Map(), lines: 0, base: 0 };
  const nowSeconds = Math.floor(now / 1000);
  if (key !== null) {
    const content = readFileSync(file, 'utf-8');
    for (const [id, entry] of parseRevokedTokens(content)) {
      if (entry.exp >= nowSeconds) addRevoked(store, id, entry);
    }
    store.lines = content.split('\n').filter((line) => line.trim()).length;
  }
  store.base = store.entries.size;
  revokedStores.set(file, store);
  if (needsCompaction(store)) {
    try {
      compactRevoked(file, store, nowSeconds);
    } catch (error) {
      // Still correct, only bigger than it needs to be: try again next logout.
      console.error(`Could not compact ${file}:`, error);
    }
  }
  return store;
}

export function isTokenRevoked(htpasswdFile: string, id: string): boolean {
  return loadRevoked(htpasswdFile).entries.has(id);
}

export function revokeToken(
  htpasswdFile: string,
  id: string,
  expSeconds: number,
  username: string,
  now = Date.now(),
): void {
  if (!id || /\s/.test(id)) throw new Error('Invalid token id');
  if (!username || /[\s:]/.test(username)) {
    throw new Error(`Refusing to revoke a token of invalid username ${JSON.stringify(username)}`);
  }
  const file = revokedTokensPath(htpasswdFile);
  const nowSeconds = Math.floor(now / 1000);
  const store = loadRevoked(htpasswdFile, now);
  if (expSeconds < nowSeconds || store.entries.has(id)) return;

  const ids = store.byUser.get(username);
  if (ids && ids.size >= MAX_REVOKED_PER_USER) {
    for (const old of [...ids]) {
      if (store.entries.get(old)!.exp < nowSeconds) dropRevoked(store, old);
    }
  }
  if ((store.byUser.get(username)?.size ?? 0) >= MAX_REVOKED_PER_USER) {
    revokeTokens(htpasswdFile, username, TOKEN_MAX_AGE_MS, now);
    for (const old of [...store.byUser.get(username)!]) dropRevoked(store, old);
    compactRevoked(file, store, nowSeconds);
    return;
  }

  addRevoked(store, id, { exp: expSeconds, user: username });
  const line = `${id} ${expSeconds} ${username}\n`;
  if (store.key === null) {
    writePrivateFile(file, line);
    store.lines = 1;
  } else {
    appendFileSync(file, line);
    store.lines++;
  }
  store.key = fileKey(file);
  if (needsCompaction(store)) compactRevoked(file, store, nowSeconds);
}
