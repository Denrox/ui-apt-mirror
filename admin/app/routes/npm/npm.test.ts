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
  revokeNpmToken: vi.fn(async () => true),
  validateNpmAuthToken: vi.fn(async (token: string) => (token === 'alice-token' ? { username: 'alice' } : null)),
}));

// Every request the proxy sends upstream (https or http), answered with an empty JSON object.
const upstream = vi.hoisted(() => {
  const calls: { scheme: string; hostname: string; path: string; method: string }[] = [];
  const fake = (scheme: string) => {
    const { EventEmitter } = require('events') as typeof import('events');
    const request = (options: any, onResponse: (res: any) => void) => {
      const req = Object.assign(new EventEmitter(), {
        setTimeout: () => req,
        destroy: () => {},
        end: () => {
          calls.push({ scheme, hostname: options.hostname, path: options.path, method: options.method });
          setImmediate(() => {
            const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'application/json' } });
            onResponse(res);
            res.emit('data', Buffer.from('{}'));
            res.emit('end');
          });
        },
      });
      return req;
    };
    return { default: { request }, request };
  };
  return { calls, fake };
});
vi.mock('https', () => upstream.fake('https:'));
vi.mock('http', () => upstream.fake('http:'));

const { action, loader } = await import('./npm');
const serverAuth = await import('~/utils/server-auth');

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
});

beforeEach(() => {
  upstream.calls.length = 0;
  vi.mocked(serverAuth.revokeNpmToken).mockClear();
  vi.mocked(serverAuth.attemptLogin).mockClear();
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
    await fs.mkdir(path.join(dirs.npm, 'public/_packages/@babel/core'), { recursive: true });
    await fs.writeFile(path.join(dirs.npm, 'public/_packages/@babel/core/package.json'), JSON.stringify({ name: '@babel/core' }));
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

  it('sends audits only to npmjs, and no other write (r3-npm-1, r3-npm-3)', async () => {
    const post = (p: string, body = '{}', headers: Record<string, string> = {}) =>
      call(request(p, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } }));
    expect((await post('/-/npm/v1/security/advisories/bulk', '{"ms":["2.1.3"]}')).status).toBe(200);
    expect(upstream.calls).toEqual([
      { scheme: 'https:', hostname: 'registry.npmjs.org', path: '/-/npm/v1/security/advisories/bulk', method: 'POST' },
    ]);
    upstream.calls.length = 0;

    // SSRF through a URL in the path, and writes that would carry a password or token to npmjs.
    expect((await post('/http:/example.com/')).status).toBe(405);
    expect((await post('/http:/example.com/-/npm/v1/security/audits')).status).toBe(405);
    expect((await post('/-/npm/v1/tokens', '{"password":"secret"}', { authorization: 'Bearer alice-token' })).status).toBe(405);
    expect((await post('/-/npm/v1/user', '{"password":{"old":"a","new":"b"}}')).status).toBe(405);
    expect((await post('/-/npm/v1/hooks/hook', '{"secret":"s"}')).status).toBe(405);
    expect((await call(request('/-/org/acme/user', { method: 'PUT', body: '{}' }))).status).toBe(405);
    expect((await post('/-/npm/v1/security/audits/..%2f..%2fx')).status).toBe(400);
    expect(upstream.calls).toEqual([]);
  });

  it('logs out locally: revokes the token and never sends it upstream (r3-npm-3, r3-auth-1)', async () => {
    const del = (p: string, headers: Record<string, string> = {}) => call(request(p, { method: 'DELETE', headers }));
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VybmFtZSI6ImFsaWNlIn0.sig';

    // As npm logout sends it, straight to the app.
    let res = await del(`/-/user/token/${token}`, { authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(serverAuth.revokeNpmToken).toHaveBeenLastCalledWith(token);

    // Through nginx, which moves the token out of the path into a header.
    res = await del('/-/user/token/-', { 'x-npm-logout-token': 'from-nginx', authorization: 'Bearer other' });
    expect(res.status).toBe(200);
    expect(serverAuth.revokeNpmToken).toHaveBeenLastCalledWith('from-nginx');

    // No token in the path or header: the request's own token.
    await del('/-/user/token/-', { authorization: 'Bearer own-token' });
    expect(serverAuth.revokeNpmToken).toHaveBeenLastCalledWith('own-token');

    // Same answer for a token that is not valid; other methods are not logouts.
    vi.mocked(serverAuth.revokeNpmToken).mockResolvedValueOnce(false);
    expect((await del('/-/user/token/garbage')).status).toBe(200);
    expect((await call(request(`/-/user/token/${token}`, { method: 'PUT' }))).status).toBe(404);
    expect((await call(request(`/-/user/token/${token}`))).status).toBe(404);
    expect(upstream.calls).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a scoped name when npmjs gives no clear answer (r3-npm-2)', async () => {
    for (const status of [429, 500, 503, 401]) {
      fetchMock.mockResolvedValueOnce(new Response('{"error":"x"}', { status }));
      const res = await publish(`@unclear${status}/pkg`);
      expect(res.status, String(status)).toBe(503);
      expect((await res.json()).reason).toContain(`HTTP ${status}`);
    }
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    expect((await publish('@garbled/pkg')).status).toBe(503);
    fetchMock.mockResolvedValueOnce(new Response('["@garbled/pkg"]', { status: 200 }));
    expect((await publish('@garbled/pkg')).status).toBe(503);
    await expect(fs.stat(path.join(dirs.npm, 'private/_packages/@unclear429'))).rejects.toThrow();

    // A clear answer: the scope does not exist on npmjs.
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    expect((await publish('@ours/pkg')).status).toBe(200);
    // Once published, new versions are not checked again.
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    expect((await publish('@ours/pkg', '1.1.0')).status).toBe(200);
  });

  it('when npmjs cannot be reached, takes only clearly private names (r3-npm-2)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    // No package of the scope ever came from npmjs through this mirror.
    expect((await publish('@offline-corp/tool')).status).toBe(200);
    // The scope has public packages in the cache: this one may be public too.
    await fs.mkdir(path.join(dirs.npm, 'public/_packages/@cached-scope/known'), { recursive: true });
    await fs.writeFile(path.join(dirs.npm, 'public/_packages/@cached-scope/known/package.json'), '{}');
    expect((await publish('@cached-scope/other')).status).toBe(503);
    // An unscoped name may be any public package.
    expect((await publish('offline-unscoped')).status).toBe(503);
  });

  it('checks unscoped names with npmjs (r3-npm-2)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    expect((await publish('lodash')).status).toBe(403);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await publish('rate-limited-name')).status).toBe(503);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await publish('free-unscoped-name')).status).toBe(200);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe('https://registry.npmjs.org/free-unscoped-name');
  });

  it('does not read a login body larger than 64 KiB (r3-npm-4)', async () => {
    const big = JSON.stringify({ name: 'alice', password: 'x', pad: 'a'.repeat(70 * 1024) });
    const res = await call(request('/-/user/org.couchdb.user:alice', { method: 'PUT', body: big }));
    expect(res.status).toBe(413);
    // Without a Content-Length (chunked), reading stops at the limit too.
    // The rest is left unread, not cancelled, so that the client still gets the answer.
    const cancel = vi.fn();
    const chunked = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 100; i++) controller.enqueue(new TextEncoder().encode('a'.repeat(1024)));
        controller.close();
      },
      cancel,
    });
    const req = request('/-/user/org.couchdb.user:alice', { method: 'PUT', body: chunked, duplex: 'half' } as RequestInit);
    expect((await call(req)).status).toBe(413);
    expect(cancel).not.toHaveBeenCalled();
    expect(serverAuth.attemptLogin).not.toHaveBeenCalled();
    // A normal login body is still read.
    await call(request('/-/user/org.couchdb.user:alice', { method: 'PUT', body: '{"name":"alice","password":"x"}' }));
    expect(serverAuth.attemptLogin).toHaveBeenCalledTimes(1);
  });

  it('refuses Object.prototype names as dist-tags (r3-npm-5)', async () => {
    expect((await publish('@acme/tags')).status).toBe(200);
    const tagPath = (tag: string) => `/-/package/@acme%2ftags/dist-tags/${tag}`;
    for (const tag of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      const res = await call(
        request(tagPath(tag), { method: 'PUT', body: '"1.0.0"', headers: { authorization: 'Bearer alice-token' } }),
      );
      expect(res.status, tag).toBe(400);
      expect((await call(request(tagPath(tag)))).status, tag).toBe(404);
    }
    expect((await publish('@acme/tags', '1.1.0', { latest: '1.1.0', constructor: '1.1.0' })).status).toBe(400);
    const tags = await (await call(request('/-/package/@acme%2ftags/dist-tags'))).json();
    expect(tags).toEqual({ latest: '1.0.0' });

  });
});
