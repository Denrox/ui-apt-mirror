import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

const dirs = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const { tmpdir } = require('os') as typeof import('os');
  return { npm: mkdtempSync(join(tmpdir(), 'npm-route-')) };
});

vi.mock('~/config/config.json', async (importOriginal) => {
  const original = (await importOriginal<{ default: Record<string, unknown> }>()).default;
  return { default: { ...original, npmPackagesDir: dirs.npm } };
});

vi.mock('~/utils/server-auth', () => ({
  attemptLogin: vi.fn(async () => ({ ok: false })),
  createNpmAuthToken: vi.fn(async () => 'token'),
  validateNpmAuthToken: vi.fn(async (token: string) => (token === 'alice-token' ? { username: 'alice' } : null)),
}));

const { action, loader } = await import('./npm');

const HOST = 'npm.mirror.intra';
const fetchMock = vi.fn<typeof fetch>();

function request(urlPath: string, init: RequestInit = {}): Request {
  const req = new Request(`http://${HOST}${urlPath}`, init);
  req.headers.set('host', HOST);
  return req;
}

const call = (req: Request) => (req.method === 'GET' ? loader({ request: req } as any) : action({ request: req } as any)) as Promise<Response>;

function publish(name: string, version = '1.0.0', tags?: Record<string, string>) {
  const tarball = `${name}-${version}.tgz`;
  const body = {
    name,
    versions: { [version]: { name, version, dist: {} } },
    'dist-tags': tags ?? { latest: version },
    _attachments: { [tarball]: { data: Buffer.from(`${name}@${version}`).toString('base64') } },
  };
  return call(
    request(`/${name.replace('/', '%2f')}`, {
      method: 'PUT',
      headers: { authorization: 'Bearer alice-token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

const upstreamScopes: Record<string, Record<string, string>> = {
  types: { '@types/node': 'write', '@types/react': 'write' },
};

beforeAll(async () => {
  process.env.NPM_PROXY_ENABLED = 'true';
  // A private package in the layout of earlier versions, published before the upgrade.
  const legacy = path.join(dirs.npm, 'private');
  await fs.mkdir(path.join(legacy, '@legacy/pkg/-/@legacy'), { recursive: true });
  await fs.writeFile(
    path.join(legacy, '@legacy/pkg.json'),
    JSON.stringify({
      name: '@legacy/pkg',
      versions: { '1.0.0': { name: '@legacy/pkg', version: '1.0.0', dist: { tarball: 'http://old/@legacy/pkg/-/@legacy/pkg-1.0.0.tgz' } } },
      'dist-tags': { latest: '1.0.0' },
    }),
  );
  await fs.writeFile(path.join(legacy, '@legacy/pkg/-/@legacy/pkg-1.0.0.tgz'), 'legacy tarball');
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    const scope = /\/-\/org\/([^/]+)\/package$/.exec(url)?.[1];
    if (scope && upstreamScopes[scope]) return new Response(JSON.stringify(upstreamScopes[scope]));
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await fs.rm(dirs.npm, { recursive: true, force: true });
});

describe('npm registry route', () => {
  it('keeps serving private packages stored in the old layout', async () => {
    const res = await call(request('/@legacy%2fpkg'));
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc['dist-tags'].latest).toBe('1.0.0');
    expect(doc.versions['1.0.0'].dist.tarball).toBe(`http://${HOST}/@legacy/pkg/-/@legacy/pkg-1.0.0.tgz`);

    const tgz = await call(request('/@legacy/pkg/-/@legacy/pkg-1.0.0.tgz'));
    expect(tgz.status).toBe(200);
    expect(await tgz.text()).toBe('legacy tarball');
    expect(await publish('@legacy/pkg', '1.1.0')).toHaveProperty('status', 200);
  });

  it('publishes <name>.json without breaking <name> (r2-npm-1)', async () => {
    expect((await publish('@acme/coll')).status).toBe(200);
    expect((await publish('@acme/coll.json')).status).toBe(200);
    expect((await publish('@acme/coll', '1.1.0')).status).toBe(200);

    const coll = await call(request('/@acme%2fcoll'));
    expect(coll.status).toBe(200);
    expect(Object.keys((await coll.json()).versions)).toEqual(['1.0.0', '1.1.0']);
    const json = await call(request('/@acme%2fcoll.json'));
    expect((await json.json()).name).toBe('@acme/coll.json');
    const tgz = await call(request('/@acme/coll/-/@acme/coll-1.1.0.tgz'));
    expect(await tgz.text()).toBe('@acme/coll@1.1.0');

    const docRes = await call(request('/@acme%2fcoll.json'));
    const rev = (await docRes.json())._rev;
    const del = await call(
      request(`/@acme%2fcoll.json/-rev/${rev}`, { method: 'DELETE', headers: { authorization: 'Bearer alice-token' } }),
    );
    expect(del.status).toBe(200);
    expect((await call(request('/@acme%2fcoll'))).status).toBe(200);
  });

  it('refuses to shadow a scoped public package without sending its name upstream (r2-npm-2)', async () => {
    const res = await publish('@types/node', '99.0.0');
    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://registry.npmjs.org/-/org/types/package');
    await expect(fs.stat(path.join(dirs.npm, 'private/_packages/@types/node'))).rejects.toThrow();

    // A new name in a scope that exists upstream, or in one that does not, is fine.
    expect((await publish('@types/our-internal-thing')).status).toBe(200);
    expect((await publish('@acme-internal/widget')).status).toBe(200);
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).not.toMatch(/our-internal-thing|widget/);
    }
  });

  it('refuses a scoped name that is in the public cache, also when npmjs cannot be reached', async () => {
    await fs.mkdir(path.join(dirs.npm, 'public/@babel'), { recursive: true });
    await fs.writeFile(path.join(dirs.npm, 'public/@babel/core'), '{}');
    fetchMock.mockRejectedValue(new Error('offline'));
    expect((await publish('@babel/core', '99.0.0')).status).toBe(403);
  });

  it('refuses versions and dist-tags that are not valid (r2-npm-4)', async () => {
    expect((await publish('@acme/trav', '..')).status).toBe(400);
    expect((await publish('@acme/trav', '1.0.0', { latest: '..' })).status).toBe(400);
    await expect(fs.stat(path.join(dirs.npm, 'private/_packages/@acme/trav'))).rejects.toThrow();
  });

  it('answers a malformed login body without the parser message (r2-npm-3)', async () => {
    for (const body of ['notjson', '[]', 'null', '"x"']) {
      const res = await call(request('/-/user/org.couchdb.user:alice', { method: 'PUT', body }));
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).not.toMatch(/Unexpected|position|JSON\.parse|token/i);
    }
  });
});
