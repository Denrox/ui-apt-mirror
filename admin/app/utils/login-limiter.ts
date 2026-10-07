import { isSharedAddress } from './client-address';

// Failed logins are counted in sliding 15-minute windows, in two kinds of bucket:
//
// - Per client address (5): a few guesses from one address, then wait. Only
//   the failures of the user who signs in are cleared by a success, so an
//   attacker can't reset the count by signing in to an account of their own
//   between guesses. It also caps what one address adds to the per-username
//   bucket, so locking someone out takes several addresses.
// - Per username, across all addresses (20): slows guessing spread over many
//   addresses. It never applies to an address that has signed in as that user
//   before, so a stranger can't lock the owner out of the places they use.
//
// Some addresses are shared by many clients the app can't tell apart: the
// Docker gateway (every IPv6 client and every client on the Docker host
// reaches nginx through docker-proxy from there) and loopback. A login from
// there never makes the address "known" for the user, and it is limited:
//
// - Per address and username (5), so one of those clients guessing at a
//   user doesn't lock the user out for all the others.
// - Per address (50), so none of them can spray guesses across usernames.
// - Per username, as above (20).
//
// Those buckets can still be filled by anyone behind the address, so a
// browser that has signed in as the user before (it holds a device cookie
// for that name) is limited on its own instead (5), and never by them.
const MAX_FAILURES = 5;
const MAX_USER_FAILURES = 20;
const MAX_SHARED_FAILURES = 50;
const WINDOW_MS = 15 * 60 * 1000;
const KNOWN_IP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_KEYS = 50000;
// No limit is higher than this, so older failures in a bucket never matter.
const MAX_KEPT_FAILURES = Math.max(MAX_USER_FAILURES, MAX_SHARED_FAILURES);

interface Failure {
  t: number;
  user: string;
}

const attempts = new Map<string, Failure[]>();
// "<user>@<ip>" -> time of the last successful login from there.
const knownIps = new Map<string, number>();
let lastSweep = -Infinity;

function recent(key: string, now: number): Failure[] {
  const list = (attempts.get(key) ?? []).filter((f) => f.t > now - WINDOW_MS);
  if (list.length) attempts.set(key, list);
  else attempts.delete(key);
  return list;
}

function keys(ip: string, username: string, device?: string): string[] {
  if (!isSharedAddress(ip)) return [`ip:${ip}`, `user:${username}`];
  if (device) return [`device:${device}`];
  return [`pair:${ip} ${username}`, `ip:${ip}`, `user:${username}`];
}

function isKnownIp(ip: string, username: string, now: number): boolean {
  if (isSharedAddress(ip)) return false;
  const last = knownIps.get(`${username}@${ip}`);
  return last !== undefined && last > now - KNOWN_IP_MS;
}

function limitFor(key: string, ip: string, username: string, now: number): number {
  if (key.startsWith('user:')) {
    return isKnownIp(ip, username, now) ? Infinity : MAX_USER_FAILURES;
  }
  if (key.startsWith('ip:') && isSharedAddress(ip)) return MAX_SHARED_FAILURES;
  return MAX_FAILURES;
}

/** Drops expired buckets and known addresses, so idle entries don't pile up. */
function sweep(now: number): void {
  for (const key of [...attempts.keys()]) recent(key, now);
  // Oldest first: loginSucceeded() re-inserts an address it refreshes.
  for (const [known, last] of knownIps) {
    if (last > now - KNOWN_IP_MS) break;
    knownIps.delete(known);
  }
  lastSweep = now;
}

/**
 * Makes room when the map is full. Buckets with the fewest failures go first
 * (oldest first among equals), so a flood of one-off guesses at made-up names
 * can't push out a bucket that is close to its limit.
 */
function makeRoom(now: number): void {
  sweep(now);
  if (attempts.size < MAX_KEYS) return;
  const byCount = [...attempts].map(([key, list], order) => ({ key, n: list.length, order }));
  byCount.sort((a, b) => a.n - b.n || a.order - b.order);
  const target = Math.floor(MAX_KEYS * 0.9);
  for (const { key } of byCount) {
    if (attempts.size <= target) break;
    attempts.delete(key);
  }
}

/**
 * Counts an attempt as failed up front, so parallel guesses can't slip past the
 * limit; call loginSucceeded() on success. Returns seconds to wait, 0 if allowed.
 * `device` identifies a browser that has signed in as `username` before.
 */
export function beginLoginAttempt(
  ip: string,
  username: string,
  now = Date.now(),
  device?: string,
): number {
  let retryAfter = 0;
  for (const key of keys(ip, username, device)) {
    const list = recent(key, now);
    const limit = limitFor(key, ip, username, now);
    if (list.length >= limit) {
      retryAfter = Math.max(
        retryAfter,
        Math.ceil((list[list.length - limit].t + WINDOW_MS - now) / 1000),
      );
    }
  }
  if (retryAfter > 0) return retryAfter;

  if (now - lastSweep >= WINDOW_MS) sweep(now);
  if (attempts.size >= MAX_KEYS) makeRoom(now);
  for (const key of keys(ip, username, device)) {
    attempts.set(key, [...recent(key, now), { t: now, user: username }].slice(-MAX_KEPT_FAILURES));
  }
  return 0;
}

export function loginSucceeded(
  ip: string,
  username: string,
  now = Date.now(),
  device?: string,
): void {
  // The user's own mistakes from here are forgiven; guesses at other names stay.
  const own = [...keys(ip, username), ...(device ? [`device:${device}`] : [])];
  for (const key of own) {
    const others = recent(key, now).filter((f) => f.user !== username);
    if (others.length) attempts.set(key, others);
    else attempts.delete(key);
  }

  if (isSharedAddress(ip)) return;
  const known = `${username}@${ip}`;
  knownIps.delete(known);
  if (knownIps.size >= MAX_KEYS) knownIps.delete(knownIps.keys().next().value!);
  knownIps.set(known, now);
}

export function tooManyAttemptsMessage(retryAfter: number): string {
  const minutes = Math.ceil(retryAfter / 60);
  return `Too many failed login attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/** The buckets held right now (for tests). */
export function loginLimiterKeys(): string[] {
  return [...attempts.keys()];
}

export function resetLoginLimiter(): void {
  attempts.clear();
  knownIps.clear();
  lastSweep = -Infinity;
}
