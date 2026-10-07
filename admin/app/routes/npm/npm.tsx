import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { promises as fs } from 'fs';
import path from 'path';
import https from 'https';
import zlib from 'zlib';
import { isWithin } from '~/utils/safe-path';
import { hostAddress } from '~/utils/hosts';
import appConfig from '~/config/config.json';
import {
  attemptLogin,
  createNpmAuthToken,
  revokeNpmToken,
  validateNpmAuthToken,
} from '~/utils/server-auth';
import { tooManyAttemptsMessage } from '~/utils/login-limiter';
import { PrivatePackageStore } from '~/utils/npm-private-store';
import {
  applyDocUpdate,
  auditPackageNames,
  currentRev,
  isAuditPath,
  isFresh,
  isRegistryRequest,
  isValidDistTag,
  isValidName,
  isValidVersion,
  isWebLoginPath,
  legacyPublicCachePath,
  logoutPathToken,
  mergePublish,
  nextRev,
  packageScope,
  parseJsonObject,
  parseNpmPath,
  pathPackage,
  privateVersion,
  publicCachePath,
  revMatches,
  scopeListsPackage,
  type DocResult,
  type NpmPath,
  upstreamHeaders,
  upstreamUrl,
  withoutAuditPackages,
  type PackageDoc,
} from '~/utils/npm-registry';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const PRIVATE_PACKAGES_DIR = path.join(appConfig.npmPackagesDir, 'private');
const privateStore = new PrivatePackageStore(PRIVATE_PACKAGES_DIR);

function insideDir(dir: string, candidate: string): string {
  const resolved = path.resolve(candidate);
  if (!isWithin(resolved, path.resolve(dir))) {
    throw new Error('Invalid package path');
  }
  return resolved;
}
const PUBLIC_PACKAGES_DIR = path.join(appConfig.npmPackagesDir, 'public');

async function ensureCacheDir() {
  try {
    await fs.mkdir(appConfig.npmPackagesDir, { recursive: true });
    await fs.mkdir(PRIVATE_PACKAGES_DIR, { recursive: true });
    await fs.mkdir(PUBLIC_PACKAGES_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create cache directory:', error);
  }
}

function bearerToken(request: Request): string | null {
  return request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

async function extractNpmAuth(request: Request): Promise<{ username: string } | null> {
  const token = bearerToken(request);
  const user = token ? await validateNpmAuthToken(token) : null;
  return user ? { username: user.username } : null;
}

async function isCached(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

type Upstream = { data: Buffer; headers: Record<string, string>; status: number };

async function fetchFromNpm(
  packagePath: string,
  search = '',
  originalHeaders: Record<string, string> = {},
): Promise<Upstream> {
  return new Promise((resolve, reject) => {
    const npmUrl = upstreamUrl(NPM_REGISTRY_URL, packagePath, search);
    if (!npmUrl) {
      reject(new Error('Not a path on the npm registry'));
      return;
    }

    const forwardedHeaders = upstreamHeaders(originalHeaders, ['if-none-match', 'if-modified-since', 'range'], {
      Accept: '*/*',
      'Accept-Encoding': 'gzip, deflate',
    });

    const options = {
      hostname: npmUrl.hostname,
      port: 443,
      path: npmUrl.pathname + npmUrl.search,
      method: 'GET',
      headers: forwardedHeaders,
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        let data = Buffer.concat(chunks);
        
        if (res.statusCode === 304) {
          console.log(`304 Not Modified for ${packagePath} - using cached version`);
          reject(new Error('304_NOT_MODIFIED'));
          return;
        }
        
        const status = res.statusCode ?? 502;
        if (data.length === 0 && status === 200) {
          console.error('Empty response received from npm registry for:', packagePath);
          console.error('Response status:', res.statusCode);
          reject(new Error(`Empty response from npm registry (status: ${res.statusCode})`));
          return;
        }
        
        const headers: Record<string, string> = {};

        const contentEncoding = res.headers['content-encoding'];
        if (contentEncoding === 'gzip') {
          try {
            data = Buffer.from(zlib.gunzipSync(data));
          } catch (error) {
            console.error('Failed to decompress gzip data:', error);
            reject(new Error('Failed to decompress gzip data'));
            return;
          }
        } else if (contentEncoding === 'deflate') {
          try {
            data = Buffer.from(zlib.inflateSync(data));
          } catch (error) {
            console.error('Failed to decompress deflate data:', error);
            reject(new Error('Failed to decompress deflate data'));
            return;
          }
        }

        if (data.length === 0 && status === 200) {
          reject(new Error('Empty response after decompression'));
          return;
        }

        const relevantHeaders = [
          'content-type',
          'etag',
          'last-modified',
          'cache-control',
          'expires',
          'age',
        ];

        for (const header of relevantHeaders) {
          const value = res.headers[header];
          if (value) {
            headers[header] = Array.isArray(value) ? value[0] : value;
          }
        }

        headers['content-length'] = data.length.toString();

        resolve({ data, headers, status });
      });
    });

    req.on('error', (error) => {
      console.error('HTTP request error:', error);
      reject(error);
    });
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

async function saveToCache(
  filePath: string,
  data: Buffer,
  headers: Record<string, string>,
) {
  try {
    if (!data || data.length === 0) {
      console.error('Attempted to save empty data to cache:', filePath);
      return;
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);

    const metaPath = filePath + '.meta';
    await fs.writeFile(
      metaPath,
      JSON.stringify(
        {
          headers,
          cachedAt: new Date().toISOString(),
          size: data.length,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error('Failed to save to cache:', error);
  }
}

async function loadFromCache(
  filePath: string,
): Promise<{ data: Buffer; headers: Record<string, string> }> {
  try {
    const data = await fs.readFile(filePath);

    if (!data || data.length === 0) {
      throw new Error('Empty cached file');
    }

    let headers: Record<string, string> = {};
    try {
      const metaPath = filePath + '.meta';
      const metaData = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaData);
      headers = meta.headers || {};

      headers['x-cache'] = 'HIT';
      headers['x-cached-at'] = meta.cachedAt;
    } catch {
      headers['x-cache'] = 'HIT';
    }

    return { data, headers };
  } catch (error) {
    throw new Error('Failed to load from cache');
  }
}

async function isPrivatePackage(packageName: string): Promise<boolean> {
  return privateStore.isPrivate(packageName);
}

async function readPrivateDoc(packageName: string): Promise<PackageDoc | null> {
  return privateStore.readDoc(packageName);
}

async function writePrivateDoc(doc: PackageDoc) {
  await privateStore.writeDoc(doc);
}

// Publishes and edits are read-modify-write on one JSON file; serialize them per package.
const packageLocks = new Map<string, Promise<unknown>>();

function withPackageLock<T>(packageName: string, task: () => Promise<T>): Promise<T> {
  const run = (packageLocks.get(packageName) ?? Promise.resolve()).catch(() => {}).then(task);
  packageLocks.set(packageName, run);
  run
    .finally(() => {
      if (packageLocks.get(packageName) === run) packageLocks.delete(packageName);
    })
    .catch(() => {});
  return run;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}

function invalidPath(): Response {
  return jsonResponse({ error: 'Bad request', reason: 'Not a valid registry path' }, 400);
}

function webLoginUnsupported(): Response {
  return jsonResponse(
    { error: 'Web login is not supported by this registry; use npm login --auth-type=legacy' },
    404,
  );
}

function docError(result: Extract<DocResult, { status: number }>): Response {
  return jsonResponse({ error: result.reason, reason: result.reason }, result.status);
}

function tarballUrl(request: Request, packageName: string, tarballFile: string): string {
  const url = new URL(request.url);
  return `${url.protocol}//${request.headers.get('host') ?? url.host}/${packageName}/-/${tarballFile}`;
}

type NameCheck =
  | { verdict: 'public' | 'free' }
  | { verdict: 'unverified'; reason: string };

/**
 * Whether a name already belongs to a public package. Publishing such a name privately would
 * replace the real package for every client, so this fails closed: a name is free only when
 * npmjs says so clearly (200 without the name, or 404). Any other answer (429, 5xx, …) leaves it
 * unverified. Only when npmjs cannot be reached at all (an offline mirror) is a name taken as
 * free without asking, and only if it is clearly private: a scoped name whose scope has no public
 * package in our cache. An unscoped name could be any public package, so it waits for npmjs.
 *
 * A scoped name is never sent upstream: npmjs is asked only for the packages of its scope, and the
 * name is looked up in that list here. Unscoped names have no such list and are checked directly.
 */
async function checkPublicName(packageName: string): Promise<NameCheck> {
  const cached = await publicCacheFile({ kind: 'package', name: packageName });
  if (cached && (await isCached(cached))) return { verdict: 'public' };

  const scope = packageScope(packageName);
  const url = scope
    ? upstreamUrl(NPM_REGISTRY_URL, `-/org/${encodeURIComponent(scope)}/package`)
    : upstreamUrl(NPM_REGISTRY_URL, packageName);
  if (!url) return { verdict: 'unverified', reason: 'the name cannot be looked up' };

  let res: Response;
  try {
    res = await fetch(url, scope
      ? { signal: AbortSignal.timeout(15000) }
      : { method: 'HEAD', signal: AbortSignal.timeout(5000) });
  } catch {
    if (scope && !(await scopeIsCached(scope))) return { verdict: 'free' };
    return {
      verdict: 'unverified',
      reason: scope
        ? `npmjs.org cannot be reached, and @${scope} has public packages`
        : 'npmjs.org cannot be reached, and an unscoped name may be a public package',
    };
  }

  if (res.status === 404) {
    await res.body?.cancel().catch(() => {});
    return { verdict: 'free' };
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {});
    return { verdict: 'unverified', reason: `npmjs.org answered HTTP ${res.status}` };
  }
  if (!scope) return { verdict: 'public' };
  const list: unknown = await res.json().catch(() => null);
  if (!list || typeof list !== 'object' || Array.isArray(list)) {
    return { verdict: 'unverified', reason: 'npmjs.org sent an unreadable package list' };
  }
  return { verdict: scopeListsPackage(list, packageName) ? 'public' : 'free' };
}

/** Whether any package of the scope is in the public cache. */
async function scopeIsCached(scope: string): Promise<boolean> {
  const dir = insideDir(PUBLIC_PACKAGES_DIR, path.join(PUBLIC_PACKAGES_DIR, `_packages/@${scope}`));
  return (await fs.readdir(dir).catch(() => [])).length > 0;
}

async function loadPrivatePackage(
  request: Request,
  packageName: string,
  tarballFile?: string,
): Promise<{ data: Buffer; headers: Record<string, string> } | null> {
  const headers: Record<string, string> = { 'x-private-package': 'true' };

  if (tarballFile !== undefined) {
    try {
      const data = await privateStore.readTarball(packageName, tarballFile);
      return { data, headers: { ...headers, 'content-type': 'application/octet-stream' } };
    } catch {
      return null;
    }
  }

  const doc = await readPrivateDoc(packageName);
  if (!doc) return null;
  doc._rev = currentRev(doc);
  // Tarball URLs are computed per request: ones stored by older versions pointed at /npm/npm/….
  for (const version of Object.values<any>(doc.versions ?? {})) {
    const stored = version?.dist?.tarball;
    if (typeof stored === 'string' && stored.includes('/-/')) {
      version.dist.tarball = tarballUrl(request, doc.name, stored.slice(stored.lastIndexOf('/-/') + 3));
    }
  }
  return {
    data: Buffer.from(JSON.stringify(doc)),
    headers: { ...headers, 'content-type': 'application/json' },
  };
}

/**
 * Moves a response cached by an older version into the current layout, so a mirror that is offline
 * after the upgrade still has it. The old layout let names collide, so a packument is taken over only
 * if it names this package (`x.meta` used to hold x's metadata) and a tarball only if it is a file.
 */
async function adoptLegacyCache(route: NpmPath, cachePath: string): Promise<void> {
  const legacy = legacyPublicCachePath(route);
  if (!legacy || (await isCached(cachePath))) return;
  const from = insideDir(PUBLIC_PACKAGES_DIR, path.join(PUBLIC_PACKAGES_DIR, legacy));
  if (!(await fs.lstat(from).catch(() => null))?.isFile()) return;
  if (route.kind === 'package') {
    const doc = parseJsonObject(await fs.readFile(from, 'utf-8'));
    if (doc?.name !== route.name) return;
  }

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  // Metadata first: if this is interrupted, the data is still found in the old place next time.
  await fs.rename(`${from}.meta`, `${cachePath}.meta`).catch(() => {});
  await fs.rename(from, cachePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
  // Drop the directories the old layout leaves empty (<name>-tarballs/…/-/).
  for (let dir = path.dirname(from); dir !== path.resolve(PUBLIC_PACKAGES_DIR); dir = path.dirname(dir)) {
    if (!(await fs.rmdir(dir).then(() => true, () => false))) break;
  }
}

/** The cache file of a route in the public dir, or null for paths that are never cached. */
async function publicCacheFile(route: NpmPath): Promise<string | null> {
  const cacheFile = publicCachePath(route);
  if (!cacheFile) return null;
  const cachePath = insideDir(PUBLIC_PACKAGES_DIR, path.join(PUBLIC_PACKAGES_DIR, cacheFile));
  await adoptLegacyCache(route, cachePath).catch((error) => {
    console.error(`Could not move the cached ${cacheFile} into the current layout:`, error);
  });
  return cachePath;
}

/** Cached upstream response; metadata is revalidated after a TTL, tarballs never change. */
async function loadPublicPackage(
  packagePath: string,
  cachePath: string,
  originalHeaders: Record<string, string>,
): Promise<Upstream> {
  const cached = await loadFromCache(cachePath).catch(() => null);
  if (cached && (packagePath.includes('/-/') || isFresh(cached.headers['x-cached-at']))) {
    return { ...cached, status: 200 };
  }

  const { 'if-none-match': _, 'if-modified-since': __, ...forwarded } = originalHeaders;
  if (cached?.headers.etag) forwarded['if-none-match'] = cached.headers.etag;

  try {
    const fetched = await fetchFromNpm(packagePath, '', forwarded);
    // Only successful responses are cached; a 404 or an error is passed on as is.
    if (fetched.status === 200) await saveToCache(cachePath, fetched.data, fetched.headers);
    else if (cached && fetched.status >= 500) throw new Error(`Upstream returned ${fetched.status}`);
    fetched.headers['x-cache'] = 'MISS';
    return fetched;
  } catch (error) {
    if (!cached) throw error;
    const { 'x-cache': _c, 'x-cached-at': _a, ...stored } = cached.headers;
    if (error instanceof Error && error.message === '304_NOT_MODIFIED') {
      await saveToCache(cachePath, cached.data, stored);
      return { data: cached.data, headers: { ...stored, 'x-cache': 'REVALIDATED' }, status: 200 };
    }
    console.error(`Serving stale ${packagePath}, upstream failed:`, error);
    return { data: cached.data, headers: { ...cached.headers, 'x-cache': 'STALE' }, status: 200 };
  }
}

function stripNpmPrefix(pathname: string): string {
  let packagePath = pathname;
  if (packagePath.startsWith('/npm/')) {
    packagePath = packagePath.substring(5);
  } else if (packagePath.startsWith('/npm')) {
    packagePath = packagePath.substring(4);
  }
  return packagePath.replace(/^\/+/, '');
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!isRegistryRequest(request.headers.get('host'))) {
    return notFound();
  }

  const url = new URL(request.url);
  const packagePath = stripNpmPrefix(url.pathname);

  if (packagePath === '-/whoami' || packagePath === '-/npm/v1/user') {
    const auth = await extractNpmAuth(request);
    if (!auth) {
      return new Response(
        JSON.stringify({ error: 'Not authenticated' }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer realm="npm"',
          },
        },
      );
    }

    return new Response(
      JSON.stringify({ username: auth.username }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }

  if (!packagePath) {
    return notFound();
  }
  if (isWebLoginPath(packagePath)) return webLoginUnsupported();
  // Token paths carry a secret of this registry; they are never looked up upstream.
  if (logoutPathToken(packagePath) !== null) return notFound();
  if (!upstreamUrl(NPM_REGISTRY_URL, packagePath, url.search)) return invalidPath();

  const originalHeaders: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    originalHeaders[key.toLowerCase()] = value;
  }

  try {
    await ensureCacheDir();

    const route = parseNpmPath(packagePath);
    const target = pathPackage(packagePath);
    const isPrivate = !!target && (await isPrivatePackage(target.name));

    let data: Buffer;
    let headers: Record<string, string>;
    let status = 200;

    if (isPrivate && route.kind === 'distTags') {
      const doc = await readPrivateDoc(route.name);
      return jsonResponse(route.tag ? doc?.['dist-tags']?.[route.tag] : doc?.['dist-tags'] ?? {});
    } else if (isPrivate && (route.kind === 'package' || route.kind === 'tarball')) {
      const privatePackage = await loadPrivatePackage(
        request,
        route.name,
        route.kind === 'tarball' ? route.file : undefined,
      );
      if (!privatePackage) return notFound();
      data = privatePackage.data;
      headers = privatePackage.headers;
    } else if (isPrivate && target) {
      // A private package is never looked up upstream; /<name>/<version|tag> comes from its packument.
      const doc =
        target.rest.length === 1 && !packagePath.startsWith('-/')
          ? await loadPrivatePackage(request, target.name)
          : null;
      const version = doc && privateVersion(JSON.parse(doc.data.toString('utf-8')), target.rest[0]);
      return version ? jsonResponse(version) : notFound();
    } else {
      // Packuments and tarballs are cached; anything else (search, /<pkg>/<version>, …) is proxied.
      const cachePath = await publicCacheFile(route);
      ({ data, headers, status } = cachePath
        ? await loadPublicPackage(packagePath, cachePath, originalHeaders)
        : await fetchFromNpm(packagePath, url.search));
      headers['x-cache'] ??= 'BYPASS';
    }

    const contentType = headers['content-type'] || 'application/octet-stream';

    const responseHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': data.length.toString(),
      'X-Cache': headers['x-cache'] || 'UNKNOWN',
      'X-Cached-At': headers['x-cached-at'] || '',
    };

    const excludeHeaders = [
      'content-type',
      'content-length',
      'x-cache',
      'x-cached-at',
    ];
    for (const [key, value] of Object.entries(headers)) {
      if (!excludeHeaders.includes(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    }

    const response = new Response(new Uint8Array(data), {
      status,
      headers: responseHeaders,
    });

    return response;
  } catch (error) {
    return new Response('Internal Server Error', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }
}

async function publishPackage(
  request: Request,
  packageName: string,
  packageDocument: any,
  username: string,
): Promise<Response> {
  const versions = packageDocument.versions || {};
  const attachments = packageDocument._attachments || {};

  if (
    packageDocument.name !== packageName ||
    Object.keys(versions).some((v) => !isValidVersion(v))
  ) {
    return jsonResponse({ error: 'Invalid package name or version' }, 400);
  }

  const check = (await isPrivatePackage(packageName)) ? null : await checkPublicName(packageName);
  if (check?.verdict === 'unverified') {
    return jsonResponse(
      {
        error: 'Service Unavailable',
        reason: `Cannot check that "${packageName}" is not a public npm package (${check.reason}); try again later`,
      },
      503,
      { 'Retry-After': '60' },
    );
  }
  if (check?.verdict === 'public') {
    return jsonResponse(
      {
        error: 'Forbidden',
        reason: packageName.startsWith('@')
          ? `"${packageName}" is a public npm package; publish private packages under a scope of your own`
          : `"${packageName}" is a public npm package; publish private packages under a scope (e.g. @yourorg/${packageName})`,
      },
      403,
    );
  }

  return withPackageLock(packageName, async () => {
    const result = mergePublish(await readPrivateDoc(packageName), packageDocument, username);
    if ('status' in result) return docError(result);

    const tarballs: [string, Buffer][] = [];
    for (const version in versions) {
      const tarballName = `${packageName}-${version}.tgz`;
      const attachment = attachments[tarballName];
      if (!attachment?.data) {
        return jsonResponse({ error: `Missing tarball for ${packageName}@${version}` }, 400);
      }
      tarballs.push([tarballName, Buffer.from(attachment.data, 'base64')]);
      versions[version].dist = versions[version].dist || {};
      versions[version].dist.tarball = tarballUrl(request, packageName, tarballName);
    }

    for (const [tarballName, tarballBuffer] of tarballs) {
      await privateStore.writeTarball(packageName, tarballName, tarballBuffer);
      console.log(`Saved tarball: ${tarballName} (${tarballBuffer.length} bytes)`);
    }

    await writePrivateDoc(result.doc);
    console.log(
      `Published ${packageName}@${Object.keys(versions).join(', ')} by ${username}`,
    );
    return jsonResponse({ ok: true, id: packageName, rev: result.doc._rev });
  });
}

async function updatePackage(packageName: string, rev: string | undefined, body: any): Promise<Response> {
  return withPackageLock(packageName, async () => {
    const existing = await readPrivateDoc(packageName);
    if (!existing) return jsonResponse({ error: 'Not found' }, 404);
    if (!revMatches(existing, rev ?? body._rev)) {
      return jsonResponse({ error: 'Document update conflict' }, 409);
    }
    const result = applyDocUpdate(existing, body);
    if ('status' in result) return docError(result);
    await writePrivateDoc(result.doc);
    return jsonResponse({ ok: true, id: packageName, rev: result.doc._rev });
  });
}

async function unpublishPackage(
  packageName: string,
  rev: string | undefined,
  tarballFile?: string,
): Promise<Response> {
  return withPackageLock(packageName, async () => {
    const existing = await readPrivateDoc(packageName);
    if (!existing) {
      return jsonResponse({ error: `${packageName} is not a private package on this registry` }, 403);
    }
    if (!revMatches(existing, rev)) {
      return jsonResponse({ error: 'Document update conflict' }, 409);
    }

    if (tarballFile === undefined) {
      await privateStore.removePackage(packageName);
      console.log(`Unpublished ${packageName}`);
      return jsonResponse({ ok: true });
    }

    const stillPublished = Object.keys(existing.versions ?? {}).some(
      (v) => tarballFile === `${packageName}-${v}.tgz`,
    );
    if (stillPublished) {
      return jsonResponse({ error: 'Unpublish the version before deleting its tarball' }, 400);
    }
    try {
      await privateStore.removeTarball(packageName, tarballFile);
    } catch {
      return jsonResponse({ error: 'Not found' }, 404);
    }
    console.log(`Removed tarball ${tarballFile}`);
    return jsonResponse({ ok: true });
  });
}

async function changeDistTag(
  request: Request,
  packageName: string,
  tag: string | undefined,
): Promise<Response> {
  if (!tag || !isValidDistTag(tag)) {
    return jsonResponse({ error: 'Invalid dist-tag' }, 400);
  }
  if (request.method === 'DELETE' && tag === 'latest') {
    return jsonResponse({ error: 'The latest tag cannot be removed' }, 400);
  }

  let version: unknown;
  if (request.method === 'PUT') {
    try {
      version = JSON.parse(await request.text());
    } catch {
      version = undefined;
    }
  }

  return withPackageLock(packageName, async () => {
    const doc = await readPrivateDoc(packageName);
    if (!doc) return jsonResponse({ error: 'Not found' }, 404);

    const tags = { ...doc['dist-tags'] };
    if (request.method === 'PUT') {
      if (typeof version !== 'string' || !doc.versions?.[version]) {
        return jsonResponse({ error: `Version not found: ${String(version)}` }, 400);
      }
      tags[tag] = version;
    } else {
      if (!(tag in tags)) return jsonResponse({ error: `Tag not found: ${tag}` }, 404);
      delete tags[tag];
    }

    await writePrivateDoc({ ...doc, 'dist-tags': tags, _rev: nextRev(doc._rev) });
    return jsonResponse({ ok: true }, request.method === 'PUT' ? 201 : 200);
  });
}

/**
 * `npm logout`: `DELETE /-/user/token/<token>`. The token is ended here, never sent upstream.
 * nginx takes it out of the path, so that it is not written to any log, and passes it in
 * X-Npm-Logout-Token; without either, the request's own Bearer token is the one logged out.
 * The answer is the same whether or not the token was valid.
 */
async function npmLogout(request: Request, pathToken: string): Promise<Response> {
  const token =
    (pathToken && pathToken !== '-' ? pathToken : null) ??
    request.headers.get('x-npm-logout-token') ??
    bearerToken(request);
  if (token) await revokeNpmToken(token);
  return jsonResponse({ ok: true });
}

/** The audit request body without locally published packages, as plain JSON; null if unreadable. */
async function publicAuditBody(body: Buffer, encoding: string | undefined, bulk: boolean): Promise<Buffer | null> {
  let payload: unknown;
  try {
    const raw = encoding === 'gzip' ? zlib.gunzipSync(body) : encoding === 'deflate' ? zlib.inflateSync(body) : body;
    payload = JSON.parse(raw.toString('utf-8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const names = auditPackageNames(payload, bulk);
  const isPrivate = await Promise.all(names.map((name) => isValidName(name) && isPrivatePackage(name)));
  const drop = new Set(names.filter((_, i) => isPrivate[i]));
  return Buffer.from(JSON.stringify(withoutAuditPackages(payload as Record<string, any>, bulk, drop)));
}

export async function action({ request }: ActionFunctionArgs) {
  if (!isRegistryRequest(request.headers.get('host'))) {
    return notFound();
  }

  const url = new URL(request.url);
  const packagePath = stripNpmPrefix(url.pathname);


  if (
    request.method === 'PUT' &&
    packagePath.startsWith('-/user/org.couchdb.user:')
  ) {
    try {
      let username = packagePath.substring('-/user/org.couchdb.user:'.length);
      try {
        username = decodeURIComponent(username);
      } catch {}

      const body = parseJsonObject(await request.text());
      if (!body) {
        return jsonResponse({ error: 'Bad request', reason: 'Request body must be a JSON object' }, 400);
      }
      const password = typeof body.password === 'string' ? body.password : '';

      // The token is issued for the user whose password was checked.
      const login =
        body.name === undefined || body.name === username
          ? await attemptLogin(request, { username, password })
          : { ok: false };

      if (login.retryAfter) {
        return new Response(
          JSON.stringify({
            error: 'Too many requests',
            reason: tooManyAttemptsMessage(login.retryAfter),
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(login.retryAfter),
            },
          },
        );
      }

      if (!login.ok) {
        return new Response(
          JSON.stringify({
            error: 'Unauthorized',
            reason: 'Invalid username or password',
          }),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      }

      const token = await createNpmAuthToken(username);

      return new Response(
        JSON.stringify({
          ok: true,
          id: `org.couchdb.user:${username}`,
          rev: '_we_dont_use_revs_any_more',
          token: token,
        }),
        {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      // Log the exception, but do not send its text to the client.
      console.error('NPM login error:', error);
      return jsonResponse({ error: 'Login failed', reason: 'Login failed' }, 500);
    }
  }

  if (!packagePath) {
    return notFound();
  }

  const logoutToken = logoutPathToken(packagePath);
  if (logoutToken !== null) {
    if (request.method !== 'DELETE') return notFound();
    try {
      return await npmLogout(request, logoutToken);
    } catch (error) {
      console.error('npm logout failed:', error instanceof Error ? error.message : 'unknown error');
      return jsonResponse({ error: 'Logout failed' }, 500);
    }
  }

  const route = parseNpmPath(packagePath);
  const isWrite = request.method === 'PUT' || request.method === 'DELETE';
  const isLocalWrite =
    isWrite && (route.kind === 'distTags' || !packagePath.startsWith('-/'));

  if (isLocalWrite) {
    const auth = await extractNpmAuth(request);
    if (!auth) {
      return jsonResponse(
        {
          error: 'Authentication required',
          message: `You must be authenticated to change packages. Run: npm login --registry=http://${hostAddress('npm')}`,
        },
        401,
        { 'WWW-Authenticate': 'Bearer realm="npm"' },
      );
    }

    try {
      await ensureCacheDir();

      if (route.kind === 'distTags') {
        if (!(await isPrivatePackage(route.name))) {
          return jsonResponse({ error: `${route.name} is not a private package on this registry` }, 403);
        }
        return await changeDistTag(request, route.name, route.tag);
      }

      if (request.method === 'DELETE' && route.kind === 'package') {
        return await unpublishPackage(route.name, route.rev);
      }
      if (request.method === 'DELETE' && route.kind === 'tarball' && route.rev !== undefined) {
        return await unpublishPackage(route.name, route.rev, route.file);
      }

      if (request.method === 'PUT' && route.kind === 'package') {
        const body = parseJsonObject(await request.text());
        if (!body) return jsonResponse({ error: 'Request body must be a JSON object' }, 400);
        const hasTarballs = Object.keys(body._attachments ?? {}).length > 0;
        if (hasTarballs && route.rev === undefined) {
          return await publishPackage(request, route.name, body, auth.username);
        }
        return await updatePackage(route.name, route.rev, body);
      }

      return jsonResponse({ error: 'Invalid package name or version' }, 400);
    } catch (error) {
      console.error('Package write error:', error);
      return jsonResponse({ error: 'Request failed' }, 500);
    }
  }

  if (isWebLoginPath(packagePath)) return webLoginUnsupported();
  const target = pathPackage(packagePath);
  if (target && (await isPrivatePackage(target.name))) return notFound();

  // Only audits are sent upstream. Other writes to npmjs' API (token create, profile, hooks, …)
  // carry this registry's passwords and tokens, and npmjs would not accept them anyway.
  if (request.method !== 'POST' || !isAuditPath(packagePath)) {
    return jsonResponse(
      { error: 'Method Not Allowed', reason: 'This registry does not support this request' },
      405,
    );
  }
  const npmUrl = upstreamUrl(NPM_REGISTRY_URL, packagePath, url.search);
  if (!npmUrl) return invalidPath();

  const originalHeaders: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    originalHeaders[key.toLowerCase()] = value;
  }

  const isBulkAudit = packagePath === '-/npm/v1/security/advisories/bulk';
  // Without upstream there are no advisories to report; failing would break every install.
  const upstreamFailed = (status: number, message: string) =>
    isBulkAudit
      ? jsonResponse({})
      : new Response(message, { status, headers: { 'Content-Type': 'text/plain' } });

  try {
    const body = await publicAuditBody(
      Buffer.from(await request.arrayBuffer()),
      originalHeaders['content-encoding'],
      isBulkAudit,
    );
    if (!body) return jsonResponse({ error: 'Invalid audit payload' }, 400);
    delete originalHeaders['content-encoding'];
    originalHeaders['content-type'] = 'application/json';

    const forwardedHeaders = upstreamHeaders(
      originalHeaders,
      ['if-none-match', 'if-modified-since', 'range', 'content-encoding'],
      { 'Content-Type': originalHeaders['content-type'] || 'application/json' },
    );
    forwardedHeaders['content-length'] = body.length.toString();

    const options = {
      hostname: npmUrl.hostname,
      port: 443,
      path: npmUrl.pathname + npmUrl.search,
      method: request.method,
      headers: forwardedHeaders,
    };

    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          let data = Buffer.concat(chunks);
          const responseHeaders: Record<string, string> = {};

          const contentEncoding = res.headers['content-encoding'];
          if (contentEncoding === 'gzip') {
            try {
              data = Buffer.from(zlib.gunzipSync(data));
            } catch (error) {
              console.error('Failed to decompress gzip data:', error);
            }
          } else if (contentEncoding === 'deflate') {
            try {
              data = Buffer.from(zlib.inflateSync(data));
            } catch (error) {
              console.error('Failed to decompress deflate data:', error);
            }
          }

          if (isBulkAudit && (res.statusCode ?? 500) >= 500) {
            resolve(upstreamFailed(502, 'Bad Gateway'));
            return;
          }

          const relevantHeaders = [
            'content-type',
            'etag',
            'last-modified',
            'cache-control',
            'expires',
            'age',
            'location',
          ];

          for (const header of relevantHeaders) {
            const value = res.headers[header];
            if (value) {
              responseHeaders[header] = Array.isArray(value) ? value[0] : value;
            }
          }

          responseHeaders['content-length'] = data.length.toString();

          const response = new Response(new Uint8Array(data), {
            status: res.statusCode || 200,
            headers: responseHeaders,
          });

          resolve(response);
        });
      });

      req.on('error', (error) => {
        console.error('NPM proxy POST error:', error);
        resolve(upstreamFailed(500, 'Internal Server Error'));
      });

      req.setTimeout(30000, () => {
        req.destroy();
        resolve(upstreamFailed(408, 'Request timeout'));
      });

      req.end(body);
    });
  } catch (error) {
    console.error('NPM proxy action error:', error);
    return upstreamFailed(500, 'Internal Server Error');
  }
}
