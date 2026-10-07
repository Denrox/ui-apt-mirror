// Per client IP: a few guesses, then wait.
const MAX_FAILURES = 5;
// Per username across all IPs: slows guessing spread over many addresses.
// It never applies to an IP that has signed in as that user before, so a
// stranger can't lock the owner out of their own account.
const MAX_USER_FAILURES = 20;
const WINDOW_MS = 15 * 60 * 1000;
const KNOWN_IP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_KEYS = 10000;

const attempts = new Map<string, number[]>();
// "<user>@<ip>" -> time of the last successful login from there.
const knownIps = new Map<string, number>();

function recent(key: string, now: number): number[] {
  const list = (attempts.get(key) ?? []).filter((t) => t > now - WINDOW_MS);
  if (list.length) attempts.set(key, list);
  else attempts.delete(key);
  return list;
}

function keys(ip: string, username: string): string[] {
  return [`ip:${ip}`, `user:${username}`];
}

function isKnownIp(ip: string, username: string, now: number): boolean {
  const last = knownIps.get(`${username}@${ip}`);
  return last !== undefined && last > now - KNOWN_IP_MS;
}

function limitFor(key: string, ip: string, username: string, now: number): number {
  if (key.startsWith('ip:')) return MAX_FAILURES;
  return isKnownIp(ip, username, now) ? Infinity : MAX_USER_FAILURES;
}

/**
 * Counts an attempt as failed up front, so parallel guesses can't slip past the
 * limit; call loginSucceeded() on success. Returns seconds to wait, 0 if allowed.
 */
export function beginLoginAttempt(
  ip: string,
  username: string,
  now = Date.now(),
): number {
  let retryAfter = 0;
  for (const key of keys(ip, username)) {
    const list = recent(key, now);
    const limit = limitFor(key, ip, username, now);
    if (list.length >= limit) {
      retryAfter = Math.max(
        retryAfter,
        Math.ceil((list[list.length - limit] + WINDOW_MS - now) / 1000),
      );
    }
  }
  if (retryAfter > 0) return retryAfter;

  if (attempts.size >= MAX_KEYS) {
    for (const key of [...attempts.keys()]) recent(key, now);
    while (attempts.size >= MAX_KEYS)
      attempts.delete(attempts.keys().next().value!);
  }
  for (const key of keys(ip, username)) {
    attempts.set(key, [...recent(key, now), now]);
  }
  return 0;
}

export function loginSucceeded(
  ip: string,
  username: string,
  now = Date.now(),
): void {
  for (const key of keys(ip, username)) attempts.delete(key);
  const known = `${username}@${ip}`;
  knownIps.delete(known);
  if (knownIps.size >= MAX_KEYS) knownIps.delete(knownIps.keys().next().value!);
  knownIps.set(known, now);
}

export function tooManyAttemptsMessage(retryAfter: number): string {
  const minutes = Math.ceil(retryAfter / 60);
  return `Too many failed login attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

export function clientIp(request: Request): string {
  // nginx sets X-Real-IP to the peer address; the app port isn't published.
  return request.headers.get('X-Real-IP')?.trim() || 'unknown';
}

export function resetLoginLimiter(): void {
  attempts.clear();
  knownIps.clear();
}
