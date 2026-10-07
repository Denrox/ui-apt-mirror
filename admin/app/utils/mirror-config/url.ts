// No Node imports: the repository form uses these in the browser.

/** Strip trailing slashes so URLs compare and render consistently. */
export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * The form a base URL is written to mirror.list in: lower-case scheme and host, no
 * credentials, query or fragment, no trailing slash. Two spellings of one upstream then
 * share one `clean` line and match the Usage snippet.
 */
export function canonicalBaseUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    return normalizeUrl(`${u.protocol}//${u.host}${u.pathname}`);
  } catch {
    return normalizeUrl(url.trim());
  }
}
