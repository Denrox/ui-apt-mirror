import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { promises as fs } from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import zlib from 'zlib';
import appConfig from '~/config/config.json';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org';

async function ensureCacheDir() {
  try {
    await fs.mkdir(appConfig.npmPackagesDir, { recursive: true });
  } catch (error) {
    console.error('Failed to create cache directory:', error);
  }
}

function getCachePath(packagePath: string): string {
  const cleanPath = packagePath.replace(/^\/+/, '').replace(/\/+$/, '');

  if (cleanPath.includes('/-/')) {
    const parts = cleanPath.split('/');
    const packageName = parts[0];
    const tarballPath = parts.slice(1).join('/');
    const cachePath = path.join(
      appConfig.npmPackagesDir,
      `${packageName}-tarballs`,
      tarballPath,
    );

    const dir = path.dirname(cachePath);
    console.log('Creating tarball directory:', dir);
    fs.mkdir(dir, { recursive: true }).catch((error) => {
      console.error('Failed to create tarball directory:', dir, error);
    });

    return cachePath;
  } else {
    const cachePath = path.join(appConfig.npmPackagesDir, cleanPath);

    const dir = path.dirname(cachePath);
    console.log('Creating metadata directory:', dir);
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

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  let packagePath = url.pathname;

  if (packagePath.startsWith('/npm/')) {
    packagePath = packagePath.substring(5);
  } else if (packagePath.startsWith('/npm')) {
    packagePath = packagePath.substring(4);
  }

  packagePath = packagePath.replace(/^\/+/, '');

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

    const cachePath = getCachePath(packagePath);
    const isPackageCached = await isCached(cachePath);

    let data: Buffer;
    let headers: Record<string, string>;

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
