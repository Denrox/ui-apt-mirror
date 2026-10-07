/**
 * Helpers on upstream base URLs that the server and the repository form share (no Node
 * imports, so the form can use them too).
 */

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
