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

  const parts = url.pathname
    .split('/')
    .filter(Boolean)
    .map((p) => decodeURIComponent(p));
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
    if (folder.some((s) => s === '.' || s === '..' || /[\\/]/.test(s))) {
      throw new Error('Invalid folder path');
    }
    path = folder.join('/');
  }

  return { owner, repo, ref, path };
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

function tokenize(q: string): string[] {
  return q.split(/\s+/).filter(Boolean);
}

// Scripts written without spaces have no word starts to anchor on.
const NO_SPACES = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

// A term matches at the start of a word: "tar" finds "tar" and "tarball", not "cataract".
function termRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(NO_SPACES.test(term) ? escaped : `(?<![\\p{L}\\p{N}])${escaped}`, 'gu');
}

export function makeSnippet(text: string, terms: string[], radius = 90, folded = foldText(text)): string {
  let at = -1;
  for (const t of terms) {
    const i = folded.search(termRegex(t));
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) at = 0;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius * 2);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

const folds = new WeakMap<IndexEntry, { title: string; text: string }>();
function folded(entry: IndexEntry) {
  let f = folds.get(entry);
  if (!f) folds.set(entry, (f = { title: foldText(entry.title), text: foldText(entry.text) }));
  return f;
}

// All words must match; title matches rank above body matches. Body matches
// are weighed like BM25: repeats count less and less, long pages count less.
export function searchEntries(entries: IndexEntry[], query: string): SearchHit[] {
  const phrase = foldText(query.trim()).replace(/\s+/g, ' ');
  const terms = tokenize(phrase).map((t) => ({ t, re: termRegex(t) }));
  if (!terms.length) return [];
  const phraseRe = termRegex(phrase);
  const avgLength = entries.reduce((n, e) => n + e.text.length, 0) / (entries.length || 1) || 1;

  const hits: SearchHit[] = [];
  for (const entry of entries) {
    const { title, text } = folded(entry);
    let score = 0;
    let all = true;
    const titleWords = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const lengthNorm = 0.25 + (0.75 * text.length) / avgLength;
    for (const { t, re } of terms) {
      const inTitle = title.includes(t) && title.search(re) !== -1;
      const n = text.includes(t) ? (text.match(re)?.length ?? 0) : 0;
      if (!inTitle && !n) {
        all = false;
        break;
      }
      if (titleWords.includes(t)) score += 30;
      else if (inTitle) score += 15;
      score += (5 * n * 2.2) / (n + 1.2 * lengthNorm);
    }
    if (!all) continue;
    if (title === phrase) score += 100;
    else if (title.startsWith(phrase)) score += 50;
    if (terms.length > 1 && text.search(phraseRe) !== -1) score += 15;
    hits.push({ entry, score, snippet: makeSnippet(entry.text, [phrase, ...terms.map((x) => x.t)], 90, text) });
  }
  return hits.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
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
