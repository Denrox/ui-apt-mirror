import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';

const env = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const { tmpdir } = require('os') as typeof import('os');
  return {
    npm: mkdtempSync(join(tmpdir(), 'npm-public-')),
    online: true,
    upstream: new Map<string, string>(),
    requests: [] as string[],
  };
});

vi.mock('~/config/config.json', async (importOriginal) => {
  const original = (await importOriginal<{ default: Record<string, unknown> }>()).default;
  return { default: { ...original, npmPackagesDir: env.npm } };
});

vi.mock('~/utils/server-auth', () => ({
  attemptLogin: vi.fn(),
  createNpmAuthToken: vi.fn(),
  validateNpmAuthToken: vi.fn(async () => null),
}));

// A fake npmjs: serves `env.upstream` by path, or fails every request while offline.
vi.mock('https', () => {
  const request = (options: { path: string }, onResponse: (res: EventEmitter) => void) => {
    const req = Object.assign(new EventEmitter(), {
      setTimeout: () => req,
      destroy: () => {},
      end: () => {
        const key = decodeURIComponent(options.path.replace(/^\//, ''));
        env.requests.push(key);
        setImmediate(() => {
          if (!env.online) return req.emit('error', new Error('offline'));
          const body = env.upstream.get(key);
          const res = Object.assign(new EventEmitter(), {
            statusCode: body === undefined ? 404 : 200,
            headers: { 'content-type': 'application/octet-stream', etag: `"${key}"` },
          });
          onResponse(res);
          if (body !== undefined) res.emit('data', Buffer.from(body));
          res.emit('end');
        });
      },
    });
    return req;
  };
  return { default: { request }, request };
});

const { loader } = await import('./npm');

const HOST = 'npm.mirror.intra';

async function get(urlPath: string): Promise<{ status: number; body: string; cache: string | null }> {
  const req = new Request(`http://${HOST}${urlPath}`);
  req.headers.set('host', HOST);
  const res = (await loader({ request: req } as any)) as Response;
  return { status: res.status, body: await res.text(), cache: res.headers.get('x-cache') };
}

const packument = (name: string) => JSON.stringify({ name, versions: {}, 'dist-tags': {} });

beforeAll(() => {
  process.env.NPM_PROXY_ENABLED = 'true';
});

beforeEach(() => {
  env.online = true;
  env.requests.length = 0;
  env.upstream.clear();
});

afterAll(async () => {
  await fs.rm(env.npm, { recursive: true, force: true });
});

describe('public npm cache', () => {
  it('keeps x, x.meta and x-tarballs apart, and serves all of them offline', async () => {
    for (const name of ['x', 'x.meta', 'x-tarballs', '@s/y', '@s-tarballs/y']) env.upstream.set(name, packument(name));
    env.upstream.set('x/-/x-1.0.0.tgz', 'x tarball');
    env.upstream.set('@s/y/-/y-1.0.0.tgz', 'y tarball');

    const paths = ['x', 'x/-/x-1.0.0.tgz', 'x.meta', 'x-tarballs', '@s%2fy', '@s/y/-/y-1.0.0.tgz', '@s-tarballs%2fy'];
    for (const p of paths) expect((await get(`/${p}`)).status, p).toBe(200);

    env.online = false;
    const expected: Record<string, string> = {
      x: packument('x'),
      'x/-/x-1.0.0.tgz': 'x tarball',
      'x.meta': packument('x.meta'),
      'x-tarballs': packument('x-tarballs'),
      '@s%2fy': packument('@s/y'),
      '@s/y/-/y-1.0.0.tgz': 'y tarball',
      '@s-tarballs%2fy': packument('@s-tarballs/y'),
    };
    const served: Record<string, string> = {};
    for (const p of Object.keys(expected)) {
      const res = await get(`/${p}`);
      served[p] = res.status === 200 ? res.body : `HTTP ${res.status}`;
    }
    expect(served).toEqual(expected);
  });

  it('does not serve the cache metadata of a package as the package <name>.meta', async () => {
    env.upstream.set('w', packument('w'));
    expect((await get('/w')).status).toBe(200);
    env.online = false;
    expect((await get('/w.meta')).status).not.toBe(200);
  });

  it('does not serve the cache metadata of a tarball as a tarball', async () => {
    env.upstream.set('z/-/z-1.0.0.tgz', 'z tarball');
    expect((await get('/z/-/z-1.0.0.tgz')).body).toBe('z tarball');
    const meta = await get('/z/-/z-1.0.0.tgz.meta');
    expect(meta.status).toBe(404);
    expect(env.requests).toContain('z/-/z-1.0.0.tgz.meta');
  });
});
