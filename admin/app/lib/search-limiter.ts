/**
 * Bounds how many searches run at once. Each search yields to other requests
 * every few milliseconds, but with many in flight every other request (logins,
 * the file manager, the npm proxy) waits for all of their slices in turn.
 *
 * `acquire` resolves to a release function once a slot is free, or to null
 * when `maxQueued` callers are already waiting (the caller answers "busy").
 * A caller whose signal aborts while waiting leaves the queue at once.
 */
export class SearchLimiter {
  private running = 0;
  private readonly waiting: { grant: () => void }[] = [];

  constructor(
    readonly maxRunning: number,
    readonly maxQueued: number,
  ) {}

  get active(): number {
    return this.running;
  }

  get queued(): number {
    return this.waiting.length;
  }

  acquire(signal?: AbortSignal): Promise<(() => void) | null> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.running < this.maxRunning) {
      this.running++;
      return Promise.resolve(this.releaser());
    }
    if (this.waiting.length >= this.maxQueued) return Promise.resolve(null);

    return new Promise((resolve, reject) => {
      const entry = {
        grant: () => {
          signal?.removeEventListener('abort', onAbort);
          this.running++;
          resolve(this.releaser());
        },
      };
      const onAbort = () => {
        const i = this.waiting.indexOf(entry);
        if (i !== -1) this.waiting.splice(i, 1);
        reject(signal!.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(entry);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running--;
      this.waiting.shift()?.grant();
    };
  }
}

// Public (cheatsheets host) and signed-in searches are counted apart, so a
// burst on the public host can't lock the admin out of searching.
export const publicSearches = new SearchLimiter(2, 6);
export const adminSearches = new SearchLimiter(2, 6);

/** Seconds a client told "busy" should wait before trying again. */
export const BUSY_RETRY_AFTER = 1;
