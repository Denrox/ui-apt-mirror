import { isSharedAddress } from '~/utils/client-address';

/**
 * Bounds how many searches run at once. Each search yields to other requests
 * every few milliseconds, but with many in flight every other request (logins,
 * the file manager, the npm proxy) waits for all of their slices in turn.
 *
 * `acquire` resolves to a release function once a slot is free, or to null
 * when `maxQueued` callers are already waiting, or when `client` already has
 * `maxPerClient` searches running or waiting (the caller answers "busy"), so
 * one client can't take the whole queue. `maxPerClient` may depend on the
 * client. A caller whose signal aborts while
 * waiting leaves the queue at once.
 */
export class SearchLimiter {
  private running = 0;
  private readonly waiting: { grant: () => void }[] = [];
  private readonly perClient = new Map<string, number>();

  constructor(
    readonly maxRunning: number,
    readonly maxQueued: number,
    private readonly maxPerClient: number | ((client: string) => number) = Infinity,
  ) {}

  get active(): number {
    return this.running;
  }

  get queued(): number {
    return this.waiting.length;
  }

  acquire(signal?: AbortSignal, client = ''): Promise<(() => void) | null> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const places = typeof this.maxPerClient === 'number' ? this.maxPerClient : this.maxPerClient(client);
    if ((this.perClient.get(client) ?? 0) >= places) return Promise.resolve(null);
    if (this.running < this.maxRunning) {
      this.running++;
      this.count(client, 1);
      return Promise.resolve(this.releaser(client));
    }
    if (this.waiting.length >= this.maxQueued) return Promise.resolve(null);
    this.count(client, 1);

    return new Promise((resolve, reject) => {
      const entry = {
        grant: () => {
          signal?.removeEventListener('abort', onAbort);
          this.running++;
          resolve(this.releaser(client));
        },
      };
      const onAbort = () => {
        const i = this.waiting.indexOf(entry);
        if (i !== -1) this.waiting.splice(i, 1);
        this.count(client, -1);
        reject(signal!.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(entry);
    });
  }

  private releaser(client: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running--;
      this.count(client, -1);
      this.waiting.shift()?.grant();
    };
  }

  private count(client: string, delta: number) {
    const n = (this.perClient.get(client) ?? 0) + delta;
    if (n > 0) this.perClient.set(client, n);
    else this.perClient.delete(client);
  }
}

// Public (cheatsheets host) and signed-in searches are counted apart, so a
// burst on the public host can't lock the admin out of searching. A public
// client gets at most two places, so others still find room in the queue. An
// address many clients share (the Docker gateway, for every IPv6 client and
// every client on the Docker host) gets half the places: enough for a few
// people searching at once, and still leaving room for everyone else.
export const publicSearches = new SearchLimiter(2, 6, (client) => (isSharedAddress(client) ? 4 : 2));
export const adminSearches = new SearchLimiter(2, 6);

/** Seconds a client told "busy" should wait before trying again. */
export const BUSY_RETRY_AFTER = 1;
