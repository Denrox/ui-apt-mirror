import { requireAuthMiddleware } from '~/utils/auth-middleware';
import { compareTitles, parsePaging, searchEntriesAsync, type IndexEntry } from '~/lib/cheatsheets';
import {
  isPublicCheatsheetsRequest,
  listSources,
  loadIndex,
} from '~/lib/cheatsheets-store';
import { adminSearches, BUSY_RETRY_AFTER, publicSearches } from '~/lib/search-limiter';
import { clientIp } from '~/utils/login-limiter';

export interface SearchResult {
  source: string;
  sourceName: string;
  path: string;
  title: string;
  categories: string[];
  snippet: string;
}

// Without q, lists the whole category; offset/limit page through the results.
export async function loader({ request }: { request: Request }) {
  const isPublic = isPublicCheatsheetsRequest(request);
  if (!isPublic) {
    await requireAuthMiddleware(request);
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const sourceId = url.searchParams.get('source') ?? '';
  const category = url.searchParams.get('category') ?? '';
  const { offset, limit } = parsePaging(url.searchParams.get('offset'), url.searchParams.get('limit'));

  const { signal } = request;
  let release: (() => void) | null;
  try {
    release = await (isPublic ? publicSearches.acquire(signal, clientIp(request)) : adminSearches.acquire(signal));
  } catch {
    return gone();
  }
  if (!release) {
    return json({ error: 'Search is busy, try again in a moment' }, 503, {
      'Retry-After': String(BUSY_RETRY_AFTER),
    });
  }
  try {
    const results = await search(q, sourceId, category, signal);
    // Not Response.json(): the image runs Node 18.
    return json({
      total: results.length,
      results: results.slice(offset, offset + limit).map(({ score: _score, ...r }) => r),
    });
  } catch (error) {
    if (signal.aborted) return gone();
    throw error;
  } finally {
    release();
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

// The client went away; nobody reads this.
const gone = () => new Response(null, { status: 499 });

async function search(q: string, sourceId: string, category: string, signal: AbortSignal) {
  const sources = (await listSources()).filter(
    (s) => s.fileCount > 0 && (!sourceId || s.id === sourceId),
  );

  const results: (SearchResult & { score: number })[] = [];
  for (const s of sources) {
    signal.throwIfAborted();
    let entries: IndexEntry[] = await loadIndex(s.id);
    if (category) entries = entries.filter((e) => e.categories.includes(category));
    const hits = q
      ? await searchEntriesAsync(entries, q, signal)
      : category
        ? entries.map((entry) => ({ entry, score: 0, snippet: entry.text.slice(0, 180) }))
        : [];
    for (const h of hits) {
      results.push({
        source: s.id,
        sourceName: s.name,
        path: h.entry.path,
        title: h.entry.title,
        categories: h.entry.categories,
        snippet: h.snippet,
        score: h.score,
      });
    }
  }

  results.sort((a, b) => b.score - a.score || compareTitles(a.title, b.title));
  return results;
}
