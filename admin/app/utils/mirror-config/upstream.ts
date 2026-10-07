/**
 * Helpers on upstream base URLs that the server and the repository form share (no Node
 * imports, so the form can use them too).
 */
import { FILTER_KEYS, type FilterKey } from './types';

export type PackageFilters = Partial<Record<FilterKey, string[]>>;

/** Strip trailing slashes so URLs compare and render consistently. */
export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * The form a base URL is written to mirror.list in: lower-case scheme and host, no
 * credentials, query or fragment, no default port, no trailing slash. Two spellings of one
 * upstream then share one `clean` line and match the Usage snippet.
 */
export function canonicalBaseUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    return normalizeUrl(`${u.protocol}//${u.host}${u.pathname}`);
  } catch {
    return normalizeUrl(url.trim());
  }
}

/**
 * Where apt-mirror2 stores a repository, relative to its mirror (and skel) folder: the URL's
 * host[:port] as written, then its path (`url.as_filesystem_path`). The scheme is not part of
 * it, so `http://` and `https://` URLs of one host and path share a folder. Null for a URI that
 * is not http(s) or has no safe path.
 */
export function mirrorDirOf(uri: string): string | null {
  const match = /^https?:\/\/([^/]+)(\/[^?#]*)?$/i.exec(uri.trim());
  if (!match) return null;
  const host = match[1].slice(match[1].lastIndexOf('@') + 1);
  const parts = [host, ...(match[2] ?? '').split('/')].filter(Boolean);
  if (!host || parts.some((p) => p === '.' || p === '..')) return null;
  return parts.join('/');
}

/**
 * Whether two mirror folders are one folder or one lies inside the other. apt-mirror2 cleans
 * a repository's whole folder, so either way one repository's sync deletes the other's files.
 */
export function mirrorDirsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * Whether the package filters of several repositories on one upstream add up to "a package is
 * mirrored when one of them selects it". apt-mirror2 merges every filter line of a base URL
 * into one filter (the values of one key are united) and mirrors a package only when it
 * matches every key. That is the union of the repositories' filters only when they use the
 * same keys and differ in at most one include list; otherwise one repository's filter deletes
 * packages another one selects (or an exclude list of one applies to all).
 */
export function filtersCombine(filters: PackageFilters[]): boolean {
  const valueSet = (f: PackageFilters, key: FilterKey) =>
    [...new Set((f[key] ?? []).map((v) => v.trim()).filter(Boolean))].sort().join(' ');
  const differing = FILTER_KEYS.filter((key) => new Set(filters.map((f) => valueSet(f, key))).size > 1);
  if (differing.length === 0) return true;
  return (
    differing.length === 1 &&
    differing[0].startsWith('include_') &&
    filters.every((f) => valueSet(f, differing[0]) !== '')
  );
}

/**
 * Filter keys apt-mirror2 applies to binary packages only: it checks source packages by source
 * name and section alone, so with only these set every source package is downloaded.
 */
export const BINARY_ONLY_FILTER_KEYS: readonly FilterKey[] = [
  'include_binary_packages',
  'exclude_binary_packages',
  'include_tags',
  'exclude_tags',
];

/** Whether package filters restrict binaries in a way source packages (deb-src) escape. */
export function filtersMissSources(filters: PackageFilters): boolean {
  return BINARY_ONLY_FILTER_KEYS.some((key) => (filters[key] ?? []).some((v) => v.trim()));
}
