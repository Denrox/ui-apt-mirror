import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { promises as fs } from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import zlib from 'zlib';
import { isWithin } from '~/utils/safe-path';
import appConfig from '~/config/config.json';
import {
  attemptLogin,
  createNpmAuthToken,
  validateNpmAuthToken,
} from '~/utils/server-auth';
import { tooManyAttemptsMessage } from '~/utils/login-limiter';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const PRIVATE_PACKAGES_DIR = path.join(appConfig.npmPackagesDir, 'private');

// npm's own rules for package names; anything else could escape the storage dirs.
const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const NPM_VERSION_RE = /^[0-9A-Za-z.+-]{1,256}$/;

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

    const forwardedHeaders: Record<string, string> = {
      'User-Agent': 'npm-cache-proxy/1.0',
      Accept: '*/*',
      'Accept-Encoding': 'gzip, deflate',
    };

    const authHeaders = [
      'authorization',
      'x-npm-auth-token',
      'x-npm-session',
      'x-npm-auth-type',
    ];
    for (const header of authHeaders) {
      if (originalHeaders[header]) {
        forwardedHeaders[header] = originalHeaders[header];
      }
    }

    const otherHeaders = ['if-none-match', 'if-modified-since', 'range'];
    for (const header of otherHeaders) {
      if (originalHeaders[header]) {
        forwardedHeaders[header] = originalHeaders[header];
      }
    }

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

async function isPrivatePackage(packagePath: string): Promise<boolean> {
  if (packagePath.includes('/-/')) {
    const privatePath = getPrivatePackagePath(packagePath);
    return await isCached(privatePath);
  }
  
  const metadataPath = getPrivatePackagePath(`${packagePath}.json`);
  return await isCached(metadataPath);
}

/** Where clients reach this registry: npm.<domain>/ maps to /npm/ in nginx, other hosts need /npm. */
function registryBase(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? url.host;
  return `${url.protocol}//${host}${host.startsWith('npm.') ? '' : '/npm'}`;
}

function tarballUrl(request: Request, packageName: string, tarballFile: string): string {
  return `${registryBase(request)}/${packageName}/-/${tarballFile}`;
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
  packagePath: string,
  request: Request,
): Promise<{ data: Buffer; headers: Record<string, string> }> {
  let privatePath: string;
  let contentType: string;

  if (packagePath.includes('/-/')) {
    privatePath = getPrivatePackagePath(packagePath);
    contentType = 'application/octet-stream';
  } else {
    privatePath = getPrivatePackagePath(`${packagePath}.json`);
    contentType = 'application/json';
  }

  let data = await fs.readFile(privatePath);

  // Tarball URLs are computed per request: ones stored by older versions pointed at /npm/npm/….
  if (contentType === 'application/json') {
    const doc = JSON.parse(data.toString('utf-8'));
    for (const version of Object.values<any>(doc.versions ?? {})) {
      const stored = version?.dist?.tarball;
      if (typeof stored === 'string' && stored.includes('/-/')) {
        version.dist.tarball = tarballUrl(request, doc.name, stored.slice(stored.lastIndexOf('/-/') + 3));
      }
    }
    data = Buffer.from(JSON.stringify(doc));
  }

  const headers: Record<string, string> = {
    'content-type': contentType,
    'x-private-package': 'true',
  };

  return { data, headers };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  let packagePath = url.pathname;

  if (packagePath.startsWith('/npm/')) {
    packagePath = packagePath.substring(5);
  } else if (packagePath.startsWith('/npm')) {
    packagePath = packagePath.substring(4);
  }

  packagePath = packagePath.replace(/^\/+/, '');

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
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }

  const originalHeaders: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    originalHeaders[key.toLowerCase()] = value;
  }

  try {
    await ensureCacheDir();

    const isPrivate = await isPrivatePackage(packagePath);
    
    let data: Buffer;
    let headers: Record<string, string>;

    if (isPrivate) {
      const privatePackage = await loadPrivatePackage(packagePath, request);
      data = privatePackage.data;
      headers = privatePackage.headers;
    } else {
      const cachePath = getCachePath(packagePath);
      const isPackageCached = await isCached(cachePath);

      if (isPackageCached) {
        try {
          const cached = await loadFromCache(cachePath);
          data = cached.data;
          headers = cached.headers;
        } catch (error) {
          const fetched = await fetchFromNpm(packagePath, originalHeaders);
          data = fetched.data;
          headers = fetched.headers;

          await saveToCache(cachePath, data, headers);

          headers['x-cache'] = 'MISS';
        }
      } else {
        try {
          const fetched = await fetchFromNpm(packagePath, originalHeaders);
          data = fetched.data;
          headers = fetched.headers;

          await saveToCache(cachePath, data, headers);

          headers['x-cache'] = 'MISS';
        } catch (error) {
          if (error instanceof Error && error.message === '304_NOT_MODIFIED') {
            try {
              const cached = await loadFromCache(cachePath);
              data = cached.data;
              headers = cached.headers;
              console.log('Using cached version due to 304 response');
            } catch (cacheError) {
              console.log('304 received but no cached version available, fetching fresh copy...');
              const freshFetched = await fetchFromNpm(packagePath, {});
              data = freshFetched.data;
              headers = freshFetched.headers;

              await saveToCache(cachePath, data, headers);
              headers['x-cache'] = 'MISS';
              console.log('Fresh copy fetched and cached due to missing cache');
            }
          } else {
            throw error;
          }
        }
      }
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

export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  let packagePath = url.pathname;

  if (packagePath.startsWith('/npm/')) {
    packagePath = packagePath.substring(5);
  } else if (packagePath.startsWith('/npm')) {
    packagePath = packagePath.substring(4);
  }

  packagePath = packagePath.replace(/^\/+/, '');

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

  if (request.method === 'PUT' && packagePath && !packagePath.startsWith('-/')) {
    try {
      const auth = await extractNpmAuth(request);
      
      if (!auth) {
        return new Response(
          JSON.stringify({
            error: 'Authentication required',
            message: 'You must be authenticated to publish packages. Run: npm login --registry=http://npm.mirror.intra',
          }),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              'WWW-Authenticate': 'Bearer realm="npm"',
            },
          },
        );
      }

      await ensureCacheDir();

      const bodyText = await request.text();
      const packageDocument = JSON.parse(bodyText);

      const packageName = packageDocument.name;
      const versions = packageDocument.versions || {};
      const attachments = packageDocument._attachments || {};

      let requestedName = packagePath;
      try {
        requestedName = decodeURIComponent(packagePath);
      } catch {}
      if (
        typeof packageName !== 'string' ||
        packageName.length > 214 ||
        !NPM_NAME_RE.test(packageName) ||
        packageName !== requestedName ||
        Object.keys(versions).some((v) => !NPM_VERSION_RE.test(v))
      ) {
        return new Response(JSON.stringify({ error: 'Invalid package name or version' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!(await isPrivatePackage(packageName)) && (await isPublicPackageName(packageName))) {
        return new Response(
          JSON.stringify({
            error: 'Forbidden',
            reason: `"${packageName}" is a public npm package; publish private packages under a scope (e.g. @yourorg/${packageName})`,
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }

      for (const version in versions) {
        const versionData = versions[version];
        
        console.log(`Publishing ${packageName}@${version} by ${auth.username}`);

        const tarballName = `${packageName}-${version}.tgz`;
        const attachment = attachments[tarballName];

        if (attachment && attachment.data) {
          const tarballBuffer = Buffer.from(attachment.data, 'base64');
          
          const tarballPath = `${packageName}/-/${tarballName}`;
          const tarballFullPath = getPrivatePackagePath(tarballPath);
          const tarballDir = path.dirname(tarballFullPath);
          await fs.mkdir(tarballDir, { recursive: true });
          await fs.writeFile(tarballFullPath, tarballBuffer);

          console.log(`Saved tarball: ${tarballPath} (${tarballBuffer.length} bytes)`);

          versionData.dist = versionData.dist || {};
          versionData.dist.tarball = tarballUrl(request, packageName, tarballName);
        }
      }

      const updatedDocument = {
        _id: packageName,
        name: packageName,
        versions: versions,
        'dist-tags': packageDocument['dist-tags'] || { latest: Object.keys(versions)[0] },
        _attachments: {},
        time: {
          modified: new Date().toISOString(),
          created: new Date().toISOString(),
          ...packageDocument.time,
        },
        _publishedBy: auth.username,
      };

      const metadataPath = getPrivatePackagePath(`${packageName}.json`);
      await fs.writeFile(metadataPath, JSON.stringify(updatedDocument, null, 2));

      console.log(`Package ${packageName} published successfully by ${auth.username}`);

      return new Response(
        JSON.stringify({
          ok: true,
          id: packageName,
          rev: '1-' + Date.now().toString(36),
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      console.error('Package publish error:', error);
      return new Response(
        JSON.stringify({
          error: 'Publish failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }
  }

  if (!packagePath) {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }

  const originalHeaders: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    originalHeaders[key.toLowerCase()] = value;
  }

  try {
    const npmUrl = new URL(packagePath, NPM_REGISTRY_URL);
    const client = npmUrl.protocol === 'https:' ? https : http;

    const forwardedHeaders: Record<string, string> = {
      'User-Agent': 'npm-cache-proxy/1.0',
      'Content-Type': originalHeaders['content-type'] || 'application/json',
    };

    const authHeaders = [
      'authorization',
      'x-npm-auth-token',
      'x-npm-session',
      'x-npm-auth-type',
    ];
    for (const header of authHeaders) {
      if (originalHeaders[header]) {
        forwardedHeaders[header] = originalHeaders[header];
      }
    }

    const otherHeaders = [
      'if-none-match',
      'if-modified-since',
      'range',
      'content-length',
    ];
    for (const header of otherHeaders) {
      if (originalHeaders[header]) {
        forwardedHeaders[header] = originalHeaders[header];
      }
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
        resolve(
          new Response('Internal Server Error', {
            status: 500,
            headers: {
              'Content-Type': 'text/plain',
            },
          }),
        );
      });

      req.setTimeout(30000, () => {
        req.destroy();
        resolve(
          new Response('Request timeout', {
            status: 408,
            headers: {
              'Content-Type': 'text/plain',
            },
          }),
        );
      });

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        request.body?.pipeTo(
          new WritableStream({
            write(chunk) {
              req.write(chunk);
            },
            close() {
              req.end();
            },
          }),
        );
      } else {
        req.end();
      }
    });
  } catch (error) {
    console.error('NPM proxy action error:', error);
    return new Response('Internal Server Error', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }
}
