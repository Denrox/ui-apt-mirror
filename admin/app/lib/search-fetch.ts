import type { SearchResult } from '~/routes/api.cheatsheets.search';

export interface SearchResponse {
  total: number;
  results: SearchResult[];
}

export const BUSY_MESSAGE = 'Search is busy right now; try again in a moment';
const RETRIES = 3;

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/**
 * GET /api/cheatsheets/search. The server answers 503 (app) or 429 (nginx)
 * when too many searches are running; those are retried a few times after
 * the Retry-After delay before giving up with BUSY_MESSAGE.
 */
export async function fetchSearch(
  url: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<SearchResponse> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, { signal });
    if (response.ok) return (await response.json()) as SearchResponse;
    if (response.status !== 503 && response.status !== 429) throw new Error('Search failed');
    if (attempt >= RETRIES) throw new Error(BUSY_MESSAGE);
    const seconds = Number(response.headers.get('Retry-After'));
    const delay = (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 10) * 1000 : 1000) * (attempt + 1);
    // Spread the retries of many clients that were turned away together.
    await wait(delay * (0.75 + Math.random() * 0.5), signal);
  }
}
