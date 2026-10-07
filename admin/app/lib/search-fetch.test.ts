import { describe, it, expect, vi, afterEach } from 'vitest';
import { BUSY_MESSAGE, fetchSearch } from './search-fetch';

const ok = { total: 1, results: [] };
const busy = (status = 503) => new Response('{}', { status, headers: { 'Retry-After': '1' } });

afterEach(() => vi.useRealTimers());

describe('fetchSearch', () => {
  it('retries a busy answer and returns the results', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(busy(503))
      .mockResolvedValueOnce(busy(429))
      .mockResolvedValueOnce(new Response(JSON.stringify(ok)));
    const result = fetchSearch('/api/cheatsheets/search?q=a', undefined, fetchImpl);
    await vi.runAllTimersAsync();
    expect(await result).toEqual(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gives up with a busy message after a few tries', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockImplementation(async () => busy());
    const result = fetchSearch('/x', undefined, fetchImpl);
    const settled = expect(result).rejects.toThrow(BUSY_MESSAGE);
    await vi.runAllTimersAsync();
    await settled;
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('does not retry other errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    await expect(fetchSearch('/x', undefined, fetchImpl)).rejects.toThrow('Search failed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stops waiting to retry once aborted', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(async () => busy());
    const result = fetchSearch('/x', controller.signal, fetchImpl);
    setTimeout(() => controller.abort(), 10);
    await expect(result).rejects.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
