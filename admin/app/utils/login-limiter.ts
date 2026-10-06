const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_KEYS = 10000;

const attempts = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const list = (attempts.get(key) ?? []).filter((t) => t > now - WINDOW_MS);
  if (list.length) attempts.set(key, list);
  else attempts.delete(key);
  return list;
}

function keys(ip: string, username: string): string[] {
  return [`ip:${ip}`, `user:${username}`];
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
    if (list.length >= MAX_FAILURES) {
      retryAfter = Math.max(
        retryAfter,
        Math.ceil((list[0] + WINDOW_MS - now) / 1000),
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

export function loginSucceeded(ip: string, username: string): void {
  for (const key of keys(ip, username)) attempts.delete(key);
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
}
