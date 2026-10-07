export interface GithubSource {
  owner: string;
  repo: string;
  /** null = default branch */
  ref: string | null;
  path: string;
}

const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const REF_RE = /^[A-Za-z0-9_.-]+$/;

// github.com/<owner>/<repo> or github.com/<owner>/<repo>/tree/<ref>/<folder>.
// The ref is a single segment, so branches containing "/" aren't supported.
export function parseGithubUrl(input: string): GithubSource {
  let raw = input.trim();
  if (!raw) throw new Error('GitHub URL is required');
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  // new URL() resolves "." and ".." (also %2e%2e), so check the path as typed.
  const rawPath = raw.replace(/^https?:\/\/[^/?#]*/i, '').split(/[?#]/)[0];
  if (rawPath.split(/[\\/]/).some((s) => /^(\.|%2e){1,2}$/i.test(s))) {
    throw new Error('The URL must not contain "." or ".." segments');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Not a valid URL');
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    throw new Error('Only github.com URLs are supported');
  }

  let parts: string[];
  try {
    parts = url.pathname
      .split('/')
      .filter(Boolean)
      .map((p) => decodeURIComponent(p));
  } catch {
    throw new Error('Not a valid URL');
  }
  if (parts.length < 2) {
    throw new Error('URL must point to a repository: github.com/<owner>/<repo>');
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, '');
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) {
    throw new Error('Invalid owner or repository name');
  }

  let ref: string | null = null;
  let path = '';
  if (parts.length > 2) {
    if (parts[2] !== 'tree' || parts.length < 4) {
      throw new Error(
        'Use a repository URL or a folder URL (github.com/<owner>/<repo>/tree/<branch>/<folder>)',
      );
    }
    ref = parts[3];
    if (!REF_RE.test(ref)) throw new Error('Invalid branch or tag name');
    const folder = parts.slice(4);
    // Only-dots names ("...") and control characters (%00) are refused too.
    if (folder.some((s) => /^\.+$/.test(s) || /[\\/]/.test(s) || /\p{Cc}/u.test(s))) {
      throw new Error('Invalid folder path');
    }
    path = folder.join('/');
  }

  return { owner, repo, ref, path };
}

export const MAX_SOURCE_NAME = 100;

/** A source name on one line: no control or bidi-override characters, at most 100 characters. */
export function cleanSourceName(name: string): string {
  const flat = name
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(flat).slice(0, MAX_SOURCE_NAME).join('').trim();
}

export function githubWebUrl(s: GithubSource): string {
  const base = `https://github.com/${s.owner}/${s.repo}`;
  if (!s.ref) return base;
  return `${base}/tree/${s.ref}${s.path ? `/${s.path}` : ''}`;
}

export function defaultSourceName(s: GithubSource): string {
  const last = s.path.split('/').filter(Boolean).pop() || s.ref;
  return last ? `${s.repo}/${last}` : `${s.owner}/${s.repo}`;
}

// Same URL, same id: the owner, repo, branch and folder, plus a hash of the URL if that is taken.
export function sourceIdFor(s: GithubSource, taken: (id: string) => boolean): string {
  const base = slugify([s.owner, s.repo, s.ref, s.path].filter(Boolean).join('-'));
  if (!taken(base)) return base;
  let h = 0x811c9dc5;
  for (const c of githubWebUrl(s).toLowerCase()) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193);
  const id = `${base.slice(0, 51)}-${(h >>> 0).toString(16).padStart(8, '0')}`;
  let unique = id;
  for (let n = 2; taken(unique); n++) unique = `${id}-${n}`;
  return unique;
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'source'
  );
}

export function extractTitle(markdown: string, filePath: string): string {
  const m = markdown.match(/^#[ \t]+(.+?)[ \t#]*$/m);
  if (m) return m[1].trim();
  const base = filePath.split('/').pop() || filePath;
  return base.replace(/\.md$/i, '');
}

export function markdownToText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n/g, '\n') // fence openers, keep code
    .replace(/```/g, '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<((?:https?|ftp|mailto):[^\s<>]+)>/gi, ' $1 ') // autolinks
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\{\{([^}]*)\}\}/g, '$1') // tldr placeholders
    .replace(/(\w)\[(\w)\]|\[(\w)\](?=\w)/g, '$1$2$3') // tldr option hints: E[x]tract, [f]ile
    .replace(/^[ \t]*\|?[ \t:|-]*-{3,}[ \t:|-]*$/gm, '') // table separator rows
    .replace(/\|/g, ' ')
    .replace(/^[ \t]*(#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface IndexEntry {
  path: string;
  title: string;
  categories: string[];
  text: string;
  /** Section headings below the title, one per line; missing in indexes from before it was added. */
  headings?: string;
}

const MAX_HEADINGS_TEXT = 2_000;

/** The ##…###### headings outside code blocks, as plain text, one per line. */
export function extractHeadings(markdown: string): string {
  const out: string[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^[ \t]*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^#{2,6}[ \t]+(.+?)[ \t#]*$/.exec(line);
    if (m) out.push(markdownToText(m[1]));
  }
  return out.filter(Boolean).join('\n').slice(0, MAX_HEADINGS_TEXT);
}

export const GENERAL_CATEGORY = 'General';

// categories.json ({ "Category": ["path.md", ...] }) wins, else the first sub-folder.
export function categoriesFor(
  relPath: string,
  explicit: Map<string, string[]> | null,
): string[] {
  const fromFile = explicit?.get(relPath);
  if (fromFile && fromFile.length) return fromFile;
  const segments = relPath.split('/');
  return segments.length > 1 ? [segments[0]] : [GENERAL_CATEGORY];
}

export function parseCategoriesJson(json: unknown): Map<string, string[]> | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const map = new Map<string, string[]>();
  for (const [category, files] of Object.entries(json as Record<string, unknown>)) {
    if (!Array.isArray(files)) continue;
    for (const f of files) {
      if (typeof f !== 'string') continue;
      const list = map.get(f) ?? [];
      if (!list.includes(category)) list.push(category);
      map.set(f, list);
    }
  }
  return map;
}

export interface SearchHit {
  entry: IndexEntry;
  score: number;
  snippet: string;
}

/** Lower case without accents, so "Sjögren" and "sjogren" match. */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC').toLowerCase();
}

// Scripts written without spaces have no word starts to anchor on.
const NO_SPACES = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

// Search runs on the thread that serves every host, so a query is bounded:
// repeated words count once, one-letter words are dropped when there are
// longer ones, and only the first few words are used.
export const MAX_SEARCH_TERMS = 8;

export function searchTerms(phrase: string): string[] {
  const unique = [...new Set(phrase.split(/\s+/).filter(Boolean))];
  const long = unique.filter((t) => [...t].length > 1 || NO_SPACES.test(t));
  return (long.length ? long : unique).slice(0, MAX_SEARCH_TERMS);
}

// A term matches at the start of a word: "tar" finds "tar" and "tarball", not "cataract".
function termRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(NO_SPACES.test(term) ? escaped : `(?<![\\p{L}\\p{N}])${escaped}`, 'gu');
}

export function makeSnippet(text: string, terms: string[], radius = 90, folded = foldText(text)): string {
  return snippetAt(text, folded, terms.map((t) => ({ t, re: termRegex(t) })), radius);
}

function snippetAt(text: string, folded: string, terms: { t: string; re: RegExp }[], radius = 90): string {
  let at = -1;
  for (const { t, re } of terms) {
    const i = folded.includes(t) ? folded.search(re) : -1;
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) at = 0;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius * 2);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

const folds = new WeakMap<
  IndexEntry,
  { title: string; titleWords: string[]; headings: string; text: string }
>();
function folded(entry: IndexEntry) {
  let f = folds.get(entry);
  if (!f) {
    const title = foldText(entry.title);
    const titleWords = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const headings = foldText(entry.headings ?? '');
    folds.set(entry, (f = { title, titleWords, headings, text: foldText(entry.text) }));
  }
  return f;
}

const HEADING_SCORE = 5;

interface Search {
  phrase: string;
  terms: { t: string; re: RegExp }[];
  phraseRe: RegExp;
  snippetTerms: { t: string; re: RegExp }[];
  avgLength: number;
}

function prepareSearch(entries: IndexEntry[], query: string): Search | null {
  const phrase = foldText(query.trim()).replace(/\s+/g, ' ');
  const terms = searchTerms(phrase).map((t) => ({ t, re: termRegex(t) }));
  if (!terms.length) return null;
  const avgLength = entries.reduce((n, e) => n + e.text.length, 0) / (entries.length || 1) || 1;
  const phraseRe = termRegex(phrase);
  return { phrase, terms, phraseRe, snippetTerms: [{ t: phrase, re: phraseRe }, ...terms], avgLength };
}

// All words must match; title matches rank above heading matches, which rank
// above body matches. Body matches are weighed like BM25: repeats count less
// and less, long pages count less. A section heading marks a page that is
// about the word, not one that only lists it (a kit list's table rows).
function scoreEntry(entry: IndexEntry, search: Search): SearchHit | null {
  const { phrase, terms, phraseRe, avgLength } = search;
  const { title, titleWords, headings, text } = folded(entry);
  // Cheap substring checks first, so most pages are rejected without a regex.
  for (const { t } of terms) {
    if (!title.includes(t) && !text.includes(t)) return null;
  }
  let score = 0;
  const lengthNorm = 0.25 + (0.75 * text.length) / avgLength;
  for (const { t, re } of terms) {
    const inTitle = title.includes(t) && title.search(re) !== -1;
    const n = text.includes(t) ? countMatches(re, text) : 0;
    if (!inTitle && !n) return null;
    if (titleWords.includes(t)) score += 30;
    else if (inTitle) score += 15;
    else if (headings.includes(t) && headings.search(re) !== -1) score += HEADING_SCORE;
    score += (5 * n * 2.2) / (n + 1.2 * lengthNorm);
  }
  if (title === phrase) score += 100;
  else if (title.startsWith(phrase)) score += 50;
  if (terms.length > 1 && text.includes(phrase) && text.search(phraseRe) !== -1) score += 15;
  return { entry, score, snippet: snippetAt(entry.text, text, search.snippetTerms) };
}

// Past this many uses a page's body score barely changes, and stopping
// early keeps common words ("the", "a") cheap.
const MAX_COUNTED = 30;

function countMatches(re: RegExp, text: string): number {
  re.lastIndex = 0;
  let n = 0;
  while (n < MAX_COUNTED && re.exec(text)) n++;
  re.lastIndex = 0;
  return n;
}

// Intl.Collator().compare is many times faster than localeCompare on long result lists.
export const compareTitles = new Intl.Collator().compare;
const byScore = (a: SearchHit, b: SearchHit) => b.score - a.score || compareTitles(a.entry.title, b.entry.title);

export function searchEntries(entries: IndexEntry[], query: string): SearchHit[] {
  const search = prepareSearch(entries, query);
  if (!search) return [];
  const hits: SearchHit[] = [];
  for (const entry of entries) {
    const hit = scoreEntry(entry, search);
    if (hit) hits.push(hit);
  }
  return hits.sort(byScore);
}

const SLICE_MS = 10;
const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * searchEntries that gives other requests a turn every few milliseconds, and
 * stops early once `signal` aborts (the client went away).
 */
export async function searchEntriesAsync(
  entries: IndexEntry[],
  query: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  signal?.throwIfAborted();
  const search = prepareSearch(entries, query);
  if (!search) return [];
  const hits: SearchHit[] = [];
  let sliceStart = performance.now();
  for (let i = 0; i < entries.length; i++) {
    const hit = scoreEntry(entries[i], search);
    if (hit) hits.push(hit);
    if ((i & 31) === 31) {
      // A gone client stops the search within 32 pages, not a whole slice.
      signal?.throwIfAborted();
      if (performance.now() - sliceStart > SLICE_MS) {
        await nextTick();
        signal?.throwIfAborted();
        sliceStart = performance.now();
      }
    }
  }
  return hits.sort(byScore);
}

/** "1 cheatsheet", "2 cheatsheets". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function isSafeRelativeMdPath(p: string): boolean {
  if (!p || p.length > 1024 || !/\.md$/i.test(p)) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

// A link inside a page to another page of the same source (e.g. "Scars.md"),
// as a path relative to the source; null for web links and anything else.
export function resolvePageLink(fromPath: string, href: string): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || href.startsWith('#')) {
    return null;
  }
  let target: string;
  try {
    target = decodeURIComponent(href.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const parts = fromPath.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (segment && segment !== '.') {
      parts.push(segment);
    }
  }
  const resolved = parts.join('/');
  return isSafeRelativeMdPath(resolved) ? resolved : null;
}

// The open cheatsheet lives in the URL (?sheet=<source>/<path>), so Back closes it and it can be shared.
export const SHEET_PARAM = 'sheet';

export function parseSheetParam(value: string | null): { source: string; path: string } | null {
  const slash = value?.indexOf('/') ?? -1;
  if (!value || slash < 1) return null;
  const source = value.slice(0, slash);
  const path = value.slice(slash + 1);
  return /^[a-z0-9-]+$/.test(source) && isSafeRelativeMdPath(path) ? { source, path } : null;
}

/** The query string with `page` open, or closed for null; slashes stay readable. */
export function sheetSearch(current: URLSearchParams, page: { source: string; path: string } | null): string {
  const params = new URLSearchParams(current);
  params.delete(SHEET_PARAM);
  const parts = params.toString() ? [params.toString()] : [];
  if (page) {
    const value = [page.source, ...page.path.split('/')].map(encodeURIComponent).join('/');
    parts.push(`${SHEET_PARAM}=${value}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** True when only the open cheatsheet changed, which needs no new page data. */
export function onlySheetChanged(current: URL, next: URL): boolean {
  if (current.href === next.href || current.pathname !== next.pathname) return false;
  const rest = (url: URL) => {
    const params = new URLSearchParams(url.search);
    params.delete(SHEET_PARAM);
    params.sort();
    return params.toString();
  };
  return rest(current) === rest(next);
}

export const SEARCH_PAGE_SIZE = 200;

/** offset/limit query values, clamped to a sane range. */
export function parsePaging(offset: string | null, limit: string | null): { offset: number; limit: number } {
  const int = (v: string | null, fallback: number) => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    offset: Math.max(0, int(offset, 0)),
    limit: Math.min(SEARCH_PAGE_SIZE, Math.max(1, int(limit, SEARCH_PAGE_SIZE))),
  };
}
