import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';

const env = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const { tmpdir } = require('os') as typeof import('os');
  return {
    npm: mkdtempSync(join(tmpdir(), 'npm-public-')),
    online: true,
    upstream: new Map<string, string>(),
    requests: [] as string[],
    // Paths whose upstream connection closes before the whole body arrived.
    cutShort: new Set<string>(),
    hosts: [] as string[],
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
const fakeHttp = vi.hoisted(() => (scheme: string) => {
  const { EventEmitter } = require('events') as typeof import('events');
  const request = (options: { hostname: string; port: number; path: string }, onResponse: (res: EventEmitter) => void) => {
    const req = Object.assign(new EventEmitter(), {
      setTimeout: () => req,
      destroy: () => {},
      end: () => {
        const key = decodeURIComponent(options.path.replace(/^\//, ''));
        env.requests.push(key);
        env.hosts.push(`${scheme}//${options.hostname}:${options.port ?? ''}`);
        setImmediate(() => {
          if (!env.online) return req.emit('error', new Error('offline'));
          const body = env.upstream.get(key);
          const res = Object.assign(new EventEmitter(), {
            complete: !env.cutShort.has(key),
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
vi.mock('https', () => fakeHttp('https:'));
// Only to catch requests that should never be made: the registry is reached over https.
vi.mock('http', () => fakeHttp('http:'));

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
  env.hosts.length = 0;
  env.upstream.clear();
  env.cutShort.clear();
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

describe('upstream requests', () => {
  it('only ever go to registry.npmjs.org, whatever the path', async () => {
    const paths = [
      '/http:/example.com/',
      '/https:/example.com:8443/x',
      '/http:%2f%2f192.168.0.10/',
      '//example.com/x',
      '/file:/etc/passwd',
      '/-/v1/search?text=x',
      '/is-number/7.0.0',
    ];
    for (const p of paths) await get(p);
    expect(env.hosts.length).toBeGreaterThan(0);
    expect(new Set(env.hosts)).toEqual(new Set(['https://registry.npmjs.org:443']));
  });

  it('refuses dot segments, which could reach another package upstream', async () => {
    // Plain ../ and %2e%2e are resolved by the URL parser before the route sees them.
    for (const p of ['/foo/..%2f@acme%2fsecret', '/foo%2f%2e%2e%2f@acme%2fsecret', '/is-number%2f.', '/a%5c..%5cb']) {
      expect((await get(p)).status, p).toBe(400);
    }
    expect(env.requests).toEqual([]);
  });

  it('does not look up token paths upstream', async () => {
    expect((await get('/-/user/token/eyJhbGciOiJIUzI1NiJ9.e30.x')).status).toBe(404);
    expect(env.requests).toEqual([]);
  });
});

describe('tarball URLs of public packages', () => {
  it('point at this registry, whose cache then serves the tarball offline', async () => {
    const doc = {
      name: '@t/yarnish',
      versions: { '1.0.0': { dist: { tarball: 'https://registry.npmjs.org/@t/yarnish/-/yarnish-1.0.0.tgz' } } },
    };
    env.upstream.set('@t/yarnish', JSON.stringify(doc));
    env.upstream.set('@t/yarnish/-/yarnish-1.0.0.tgz', 'yarnish tarball');
    const res = await get('/@t%2fyarnish');
    const tarball = JSON.parse(res.body).versions['1.0.0'].dist.tarball;
    expect(tarball).toBe(`http://${HOST}/@t/yarnish/-/yarnish-1.0.0.tgz`);
    expect((await get(new URL(tarball).pathname)).body).toBe('yarnish tarball');

    env.online = false;
    expect(JSON.parse((await get('/@t%2fyarnish')).body).versions['1.0.0'].dist.tarball).toBe(tarball);
    const offline = await get(new URL(tarball).pathname);
    expect([offline.status, offline.body, offline.cache]).toEqual([200, 'yarnish tarball', 'HIT']);
  });
});


describe('cached tarballs', () => {
  const tarballFile = (name: string, file: string) => path.join(env.npm, 'public/_packages', name, '-', file);

  it('are served only once written whole, with metadata of their size', async () => {
    env.upstream.set('half/-/half-1.0.0.tgz', 'the whole tarball');
    const file = tarballFile('half', 'half-1.0.0.tgz');
    // What a write still going on, or one cut short by a crash, leaves behind.
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'the who');
    let res = await get('/half/-/half-1.0.0.tgz');
    expect([res.body, res.cache]).toEqual(['the whole tarball', 'MISS']);
    expect(await fs.readFile(file, 'utf-8')).toBe('the whole tarball');
    expect((await fs.readdir(path.dirname(file))).sort()).toEqual(['half-1.0.0.tgz', 'half-1.0.0.tgz.meta']);

    // The metadata of an earlier, longer body.
    await fs.writeFile(file, 'the whole');
    res = await get('/half/-/half-1.0.0.tgz');
    expect([res.body, res.cache]).toEqual(['the whole tarball', 'MISS']);
    res = await get('/half/-/half-1.0.0.tgz');
    expect([res.body, res.cache]).toEqual(['the whole tarball', 'HIT']);
  });

  it('are not cached when the upstream connection closed early', async () => {
    env.upstream.set('cut/-/cut-1.0.0.tgz', 'the first part');
    env.cutShort.add('cut/-/cut-1.0.0.tgz');
    expect((await get('/cut/-/cut-1.0.0.tgz')).status).toBe(500);
    await expect(fs.stat(tarballFile('cut', 'cut-1.0.0.tgz'))).rejects.toThrow();
  });

  it('are cached only when they match the integrity in the cached packument', async () => {
    const body = 'signed tarball';
    const sha512 = createHash('sha512').update(body).digest('base64');
    const doc = {
      name: 'checked',
      versions: {
        '1.0.0': { dist: { tarball: 'https://registry.npmjs.org/checked/-/checked-1.0.0.tgz', integrity: `sha512-${sha512}` } },
      },
    };
    env.upstream.set('checked', JSON.stringify(doc));
    expect((await get('/checked')).status).toBe(200);

    env.upstream.set('checked/-/checked-1.0.0.tgz', 'signed tarbal');
    expect((await get('/checked/-/checked-1.0.0.tgz')).status).toBe(500);
    await expect(fs.stat(tarballFile('checked', 'checked-1.0.0.tgz'))).rejects.toThrow();

    env.upstream.set('checked/-/checked-1.0.0.tgz', body);
    const res = await get('/checked/-/checked-1.0.0.tgz');
    expect([res.status, res.body]).toEqual([200, body]);
    expect(await fs.readFile(tarballFile('checked', 'checked-1.0.0.tgz'), 'utf-8')).toBe(body);
  });
});
