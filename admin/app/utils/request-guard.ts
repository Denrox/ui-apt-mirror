// Checks that run before any cookie-authenticated request is trusted.
//
// SameSite=Strict only stops cross-site requests. All of the app's hosts
// (admin., files., cheatsheets., ...) are one site, so a page on the files
// host could post to the admin host with the admin's cookie attached.
//
// The admin UI must also stay off the public hosts. nginx blocks its routes
// there, but React Router matches paths case-insensitively and a custom site
// config can drop the block, so the app refuses them as well.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** First DNS labels of the hosts that serve the public pages, never the admin UI. */
const PUBLIC_HOST_LABELS = new Set(['files', 'cheatsheets']);

/** True when the request came in on a public host (files., cheatsheets.). */
export function isPublicHostRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return PUBLIC_HOST_LABELS.has(hostname.split('.')[0]);
}

/**
 * Why a state-changing request must be refused as cross-origin, or null.
 *
 * Browsers send Sec-Fetch-Site and Origin on every POST; a request from
 * another origin (another host on the same site included) or from a sandboxed
 * or opaque page is refused. Clients that send neither header (curl, npm,
 * scripts) are not browsers carrying someone else's cookie and pass.
 */
export function crossOriginError(request: Request): string | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;

  const fetchSite = request.headers.get('Sec-Fetch-Site')?.trim().toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return `Cross-origin request refused (Sec-Fetch-Site: ${fetchSite})`;
  }

  const origin = request.headers.get('Origin')?.trim();
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).hostname.toLowerCase();
    } catch {
      return `Cross-origin request refused (Origin: ${origin})`;
    }
    // Hostnames only: nginx passes Host without the port the browser used.
    const ownHost = new URL(request.url).hostname.toLowerCase();
    if (!originHost || originHost !== ownHost) {
      return `Cross-origin request refused (Origin: ${origin})`;
    }
  }
  return null;
}

/** Throws 403 for a cross-origin state-changing request. */
export function assertSameOrigin(request: Request): void {
  const error = crossOriginError(request);
  if (error) {
    console.warn(`${error}: ${request.method} ${new URL(request.url).pathname}`);
    throw new Response(error, {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/** Throws a redirect to the public page for an admin-only route on a public host. */
export function assertAdminHost(request: Request): void {
  if (isPublicHostRequest(request)) {
    throw new Response(null, { status: 302, headers: { Location: '/' } });
  }
}
