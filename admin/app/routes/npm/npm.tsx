import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { promises as fs } from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import zlib from 'zlib';
import appConfig from '~/config/config.json';
import {
  validateCredentials,
  createNpmAuthToken,
  validateNpmAuthToken,
} from '~/utils/server-auth';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const PRIVATE_PACKAGES_DIR = path.join(appConfig.npmPackagesDir, 'private');
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
    const cachePath = path.join(
      PUBLIC_PACKAGES_DIR,
      `${packageName}-tarballs`,
      tarballPath,
    );

    const dir = path.dirname(cachePath);
    fs.mkdir(dir, { recursive: true }).catch((error) => {
      console.error('Failed to create tarball directory:', dir, error);
    });

    return cachePath;
  } else {
    const cachePath = path.join(PUBLIC_PACKAGES_DIR, cleanPath);

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
  return path.join(PRIVATE_PACKAGES_DIR, cleanPath);
}

async function isPrivatePackage(packagePath: string): Promise<boolean> {
  if (packagePath.includes('/-/')) {
    const privatePath = getPrivatePackagePath(packagePath);
    return await isCached(privatePath);
  }
  
  const metadataPath = getPrivatePackagePath(`${packagePath}.json`);
  return await isCached(metadataPath);
}

async function loadPrivatePackage(
  packagePath: string,
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

  const data = await fs.readFile(privatePath);

  const headers: Record<string, string> = {
    'content-type': contentType,
    'x-private-package': 'true',
  };

  return { data, headers };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
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
      const privatePackage = await loadPrivatePackage(packagePath);
      data = privatePackage.data;
      headers = privatePackage.headers;
    } else {
      const cachePath = getCachePath(packagePath);
      const isPackageCached = await isCached(cachePath);

      if (isPackageCached) {
        const cached = await loadFromCache(cachePath);
        data = cached.data;
        headers = cached.headers;
      } else {
        const fetched = await fetchFromNpm(packagePath, originalHeaders);
        data = fetched.data;
        headers = fetched.headers;

        await saveToCache(cachePath, data, headers);

        headers['x-cache'] = 'MISS';
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
      const username = packagePath.substring('-/user/org.couchdb.user:'.length);
      
      const bodyText = await request.text();
      const body = JSON.parse(bodyText);

      const isValid = await validateCredentials({
        username: body.name || username,
        password: body.password,
      });

      if (!isValid) {
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

      const packageName = packageDocument.name || packagePath;
      const versions = packageDocument.versions || {};
      const attachments = packageDocument._attachments || {};

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

          const url = new URL(request.url);
          const baseUrl = `${url.protocol}//${url.host}`;
          versionData.dist = versionData.dist || {};
          versionData.dist.tarball = `${baseUrl}/npm/${packageName}/-/${tarballName}`;
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

    return new Promise((resolve, reject) => {
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
