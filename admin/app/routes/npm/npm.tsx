import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { promises as fs } from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import zlib from 'zlib';
import { isWithin } from '~/utils/safe-path';
import { hostAddress } from '~/utils/hosts';
import appConfig from '~/config/config.json';
import {
  attemptLogin,
  createNpmAuthToken,
  validateNpmAuthToken,
} from '~/utils/server-auth';
import { tooManyAttemptsMessage } from '~/utils/login-limiter';
import {
  NPM_VERSION_RE,
  applyDocUpdate,
  auditPackageNames,
  currentRev,
  isAuditPath,
  isFresh,
  isRegistryRequest,
  isValidDistTag,
  isValidName,
  mergePublish,
  nextRev,
  parseNpmPath,
  revMatches,
  type DocResult,
  upstreamHeaders,
  withoutAuditPackages,
  type PackageDoc,
} from '~/utils/npm-registry';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const PRIVATE_PACKAGES_DIR = path.join(appConfig.npmPackagesDir, 'private');

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

async function extractNpmAuth(request: Request): Promise<{ username: string } | null> {
  const authHeader = request.headers.get('Authorization');
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      const token = match[1];
      const user = await validateNpmAuthToken(token);
      if (user) {
        return { username: user.username };
      }
    }
  }
  return null;
}

function getCachePath(packagePath: string): string {
  const cleanPath = packagePath.replace(/^\/+/, '').replace(/\/+$/, '');

  if (cleanPath.includes('/-/')) {
    const parts = cleanPath.split('/');
    const packageName = parts[0];
    const tarballPath = parts.slice(1).join('/');
    const cachePath = insideDir(
      PUBLIC_PACKAGES_DIR,
      path.join(PUBLIC_PACKAGES_DIR, `${packageName}-tarballs`, tarballPath),
    );

    const dir = path.dirname(cachePath);
    fs.mkdir(dir, { recursive: true }).catch((error) => {
      console.error('Failed to create tarball directory:', dir, error);
    });

    return cachePath;
  } else {
    const cachePath = insideDir(PUBLIC_PACKAGES_DIR, path.join(PUBLIC_PACKAGES_DIR, cleanPath));

    const dir = path.dirname(cachePath);
    fs.mkdir(dir, { recursive: true }).catch((error) => {
      console.error('Failed to create metadata directory:', dir, error);
    });

    return cachePath;
  }
}

async function isCached(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchFromNpm(
  packagePath: string,
  originalHeaders: Record<string, string> = {},
): Promise<{ data: Buffer; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const npmUrl = new URL(packagePath, NPM_REGISTRY_URL);
    const client = npmUrl.protocol === 'https:' ? https : http;

    const forwardedHeaders = upstreamHeaders(originalHeaders, ['if-none-match', 'if-modified-since', 'range'], {
      Accept: '*/*',
      'Accept-Encoding': 'gzip, deflate',
    });

    const options = {
      hostname: npmUrl.hostname,
      port: npmUrl.port || (npmUrl.protocol === 'https:' ? 443 : 80),
      path: npmUrl.pathname + npmUrl.search,
      method: 'GET',
      headers: forwardedHeaders,
    };

    const req = client.request(options, (res) => {
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
        
        if (data.length === 0 && res.statusCode !== 304) {
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

        if (data.length === 0) {
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

        resolve({ data, headers });
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

function getPrivatePackagePath(packagePath: string): string {
  const cleanPath = packagePath.replace(/^\/+/, '').replace(/\/+$/, '');
  return insideDir(PRIVATE_PACKAGES_DIR, path.join(PRIVATE_PACKAGES_DIR, cleanPath));
}

function privateDocPath(packageName: string): string {
  return getPrivatePackagePath(`${packageName}.json`);
}

function privateTarballPath(packageName: string, tarballFile: string): string {
  return getPrivatePackagePath(`${packageName}/-/${tarballFile}`);
}

async function isPrivatePackage(packageName: string): Promise<boolean> {
  return await isCached(privateDocPath(packageName));
}

async function readPrivateDoc(packageName: string): Promise<PackageDoc | null> {
  try {
    return JSON.parse(await fs.readFile(privateDocPath(packageName), 'utf-8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writePrivateDoc(doc: PackageDoc) {
  const target = privateDocPath(doc.name);
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(doc, null, 2));
  await fs.rename(tmp, target);
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

function docError(result: Extract<DocResult, { status: number }>): Response {
  return jsonResponse({ error: result.reason, reason: result.reason }, result.status);
}

function tarballUrl(request: Request, packageName: string, tarballFile: string): string {
  const url = new URL(request.url);
  return `${url.protocol}//${request.headers.get('host') ?? url.host}/${packageName}/-/${tarballFile}`;
}

/**
 * Whether an unscoped name already belongs to a public package (upstream, or in our cache when
 * offline). Publishing such a name privately would replace the real package for every client.
 */
async function isPublicPackageName(packageName: string): Promise<boolean> {
  if (packageName.startsWith('@')) return false;
  if (await isCached(path.join(PUBLIC_PACKAGES_DIR, packageName))) return true;
  try {
    const res = await fetch(`${NPM_REGISTRY_URL}/${packageName}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function loadPrivatePackage(
  request: Request,
  packageName: string,
  tarballFile?: string,
): Promise<{ data: Buffer; headers: Record<string, string> } | null> {
  const headers: Record<string, string> = { 'x-private-package': 'true' };

  if (tarballFile !== undefined) {
    try {
      const data = await fs.readFile(privateTarballPath(packageName, tarballFile));
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

/** Cached upstream response; metadata is revalidated after a TTL, tarballs never change. */
async function loadPublicPackage(
  packagePath: string,
  originalHeaders: Record<string, string>,
): Promise<{ data: Buffer; headers: Record<string, string> }> {
  const cachePath = getCachePath(packagePath);
  const cached = await loadFromCache(cachePath).catch(() => null);
  if (cached && (packagePath.includes('/-/') || isFresh(cached.headers['x-cached-at']))) {
    return cached;
  }

  const { 'if-none-match': _, 'if-modified-since': __, ...forwarded } = originalHeaders;
  if (cached?.headers.etag) forwarded['if-none-match'] = cached.headers.etag;

  try {
    const fetched = await fetchFromNpm(packagePath, forwarded);
    await saveToCache(cachePath, fetched.data, fetched.headers);
    fetched.headers['x-cache'] = 'MISS';
    return fetched;
  } catch (error) {
    if (!cached) throw error;
    const { 'x-cache': _c, 'x-cached-at': _a, ...stored } = cached.headers;
    if (error instanceof Error && error.message === '304_NOT_MODIFIED') {
      await saveToCache(cachePath, cached.data, stored);
      return { data: cached.data, headers: { ...stored, 'x-cache': 'REVALIDATED' } };
    }
    console.error(`Serving stale ${packagePath}, upstream failed:`, error);
    return { data: cached.data, headers: { ...cached.headers, 'x-cache': 'STALE' } };
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

  const originalHeaders: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    originalHeaders[key.toLowerCase()] = value;
  }

  try {
    await ensureCacheDir();

    const route = parseNpmPath(packagePath);
    const isPrivate = route.kind !== 'other' && (await isPrivatePackage(route.name));

    let data: Buffer;
    let headers: Record<string, string>;

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
    } else {
      ({ data, headers } = await loadPublicPackage(packagePath, originalHeaders));
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
      status: 200,
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
    Object.keys(versions).some((v) => !NPM_VERSION_RE.test(v))
  ) {
    return jsonResponse({ error: 'Invalid package name or version' }, 400);
  }

  if (!(await isPrivatePackage(packageName)) && (await isPublicPackageName(packageName))) {
    return jsonResponse(
      {
        error: 'Forbidden',
        reason: `"${packageName}" is a public npm package; publish private packages under a scope (e.g. @yourorg/${packageName})`,
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
      const tarballFullPath = privateTarballPath(packageName, tarballName);
      await fs.mkdir(path.dirname(tarballFullPath), { recursive: true });
      await fs.writeFile(tarballFullPath, tarballBuffer);
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
      await fs.rm(privateDocPath(packageName));
      await fs.rm(getPrivatePackagePath(`${packageName}/-`), { recursive: true, force: true });
      await fs.rmdir(getPrivatePackagePath(packageName)).catch(() => {});
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
      await fs.rm(privateTarballPath(packageName, tarballFile));
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

      const bodyText = await request.text();
      const body = JSON.parse(bodyText);

      // The token is issued for the user whose password was checked.
      const login =
        body.name === undefined || body.name === username
          ? await attemptLogin(request, { username, password: body.password })
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
      console.error('NPM login error:', error);
      return new Response(
        JSON.stringify({
          error: 'Bad request',
          reason: error instanceof Error ? error.message : 'Invalid request',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }
  }

  if (!packagePath) {
    return notFound();
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
        const body = JSON.parse(await request.text());
        const hasTarballs = Object.keys(body?._attachments ?? {}).length > 0;
        if (hasTarballs && route.rev === undefined) {
          return await publishPackage(request, route.name, body, auth.username);
        }
        return await updatePackage(route.name, route.rev, body);
      }

      return jsonResponse({ error: 'Invalid package name or version' }, 400);
    } catch (error) {
      console.error('Package write error:', error);
      return jsonResponse(
        {
          error: 'Request failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      );
    }
  }

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
    const npmUrl = new URL(packagePath, NPM_REGISTRY_URL);
    const client = npmUrl.protocol === 'https:' ? https : http;
    let body =
      request.method !== 'GET' && request.method !== 'HEAD'
        ? Buffer.from(await request.arrayBuffer())
        : null;
    if (body && isAuditPath(packagePath)) {
      body = await publicAuditBody(body, originalHeaders['content-encoding'], isBulkAudit);
      if (!body) return jsonResponse({ error: 'Invalid audit payload' }, 400);
      delete originalHeaders['content-encoding'];
      originalHeaders['content-type'] = 'application/json';
    }

    const forwardedHeaders = upstreamHeaders(
      originalHeaders,
      ['if-none-match', 'if-modified-since', 'range', 'content-encoding'],
      { 'Content-Type': originalHeaders['content-type'] || 'application/json' },
    );
    if (body) {
      forwardedHeaders['content-length'] = body.length.toString();
    }

    const options = {
      hostname: npmUrl.hostname,
      port: npmUrl.port || (npmUrl.protocol === 'https:' ? 443 : 80),
      path: npmUrl.pathname + npmUrl.search,
      method: request.method,
      headers: forwardedHeaders,
    };

    return new Promise((resolve) => {
      const req = client.request(options, (res) => {
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

      req.end(body ?? undefined);
    });
  } catch (error) {
    console.error('NPM proxy action error:', error);
    return upstreamFailed(500, 'Internal Server Error');
  }
}
