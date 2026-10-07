import { describe, it, expect } from 'vitest';
import { SearchLimiter } from './search-limiter';

describe('SearchLimiter', () => {
  it('runs at most maxRunning at once and hands slots to the queue in order', async () => {
    const limiter = new SearchLimiter(2, 2);
    const a = await limiter.acquire();
    const b = await limiter.acquire();
    expect(limiter.active).toBe(2);
    const order: string[] = [];
    const c = limiter.acquire().then((r) => (order.push('c'), r));
    const d = limiter.acquire().then((r) => (order.push('d'), r));
    expect(limiter.queued).toBe(2);
    // The queue is full: the caller is told "busy" at once.
    expect(await limiter.acquire()).toBeNull();
    a!();
    a!(); // a second release of the same slot does nothing
    const releaseC = await c;
    expect(order).toEqual(['c']);
    expect(limiter.active).toBe(2);
    b!();
    const releaseD = await d;
    expect(order).toEqual(['c', 'd']);
    releaseC!();
    releaseD!();
    expect(limiter.active).toBe(0);
    expect(limiter.queued).toBe(0);
  });

  it('drops a waiting caller whose client went away, without using a slot', async () => {
    const limiter = new SearchLimiter(1, 5);
    const first = await limiter.acquire();
    const controller = new AbortController();
    const waiting = limiter.acquire(controller.signal);
    expect(limiter.queued).toBe(1);
    controller.abort();
    await expect(waiting).rejects.toBeDefined();
    expect(limiter.queued).toBe(0);
    first!();
    expect(limiter.active).toBe(0);
  });

  it('refuses an already aborted request', async () => {
    const limiter = new SearchLimiter(1, 1);
    await expect(limiter.acquire(AbortSignal.abort())).rejects.toBeDefined();
    expect(limiter.active).toBe(0);
  });

  it('turns a client away once it has maxPerClient places, and counts its released ones', async () => {
    const limiter = new SearchLimiter(1, 5, 2);
    const a = await limiter.acquire(undefined, 'x');
    const b = limiter.acquire(undefined, 'x');
    expect(await limiter.acquire(undefined, 'x')).toBeNull();
    const c = limiter.acquire(undefined, 'y');
    expect(limiter.queued).toBe(2);
    a!();
    (await b)!();
    const releaseC = await c;
    // x holds nothing now, so it may queue again.
    const d = limiter.acquire(undefined, 'x');
    expect(limiter.queued).toBe(1);
    releaseC!();
    (await d)!();
    expect(limiter.active).toBe(0);
  });

  it('can give some clients more places than others', async () => {
    const limiter = new SearchLimiter(1, 5, (client) => (client === 'shared' ? 3 : 1));
    const a = await limiter.acquire(undefined, 'shared');
    const b = limiter.acquire(undefined, 'shared');
    const c = limiter.acquire(undefined, 'shared');
    expect(await limiter.acquire(undefined, 'shared')).toBeNull();
    const d = limiter.acquire(undefined, 'x');
    expect(await limiter.acquire(undefined, 'x')).toBeNull();
    expect(limiter.queued).toBe(3);
    a!();
    (await b)!();
    (await c)!();
    (await d)!();
    expect(limiter.active).toBe(0);
  });
});
