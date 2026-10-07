import { requireAuthMiddleware } from '~/utils/auth-middleware';
import { parsePaging, searchEntriesAsync, type IndexEntry } from '~/lib/cheatsheets';
import {
  isPublicCheatsheetsRequest,
  listSources,
  loadIndex,
} from '~/lib/cheatsheets-store';

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
  if (!isPublicCheatsheetsRequest(request)) {
    await requireAuthMiddleware(request);
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const sourceId = url.searchParams.get('source') ?? '';
  const category = url.searchParams.get('category') ?? '';
  const { offset, limit } = parsePaging(url.searchParams.get('offset'), url.searchParams.get('limit'));

  const sources = (await listSources()).filter(
    (s) => s.fileCount > 0 && (!sourceId || s.id === sourceId),
  );

  const results: (SearchResult & { score: number })[] = [];
  for (const s of sources) {
    let entries: IndexEntry[] = await loadIndex(s.id);
    if (category) entries = entries.filter((e) => e.categories.includes(category));
    const hits = q
      ? await searchEntriesAsync(entries, q, request.signal)
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

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  // Not Response.json(): the image runs Node 18.
  const body = {
    total: results.length,
    results: results.slice(offset, offset + limit).map(({ score: _score, ...r }) => r),
  };
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
