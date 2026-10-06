import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkUpstreamUrl, fetchUpstream, isBlockedAddress, UpstreamFetchError } from './upstream-fetch';
import { closureOptionsError } from './dep-closure';

describe('isBlockedAddress', () => {
  const own = new Set(['172.20.0.5']);
  it.each(['127.0.0.1', '127.8.0.1', '0.0.0.0', '169.254.169.254', '::1', '::', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1', '172.20.0.5', 'nonsense'])(
    'refuses %s',
    (ip) => expect(isBlockedAddress(ip, own)).toBe(true),
  );
  it.each(['192.168.0.10', '10.1.2.3', '172.20.0.6', '151.101.2.132', '2a04:4e42::644'])('allows %s', (ip) =>
    expect(isBlockedAddress(ip, own)).toBe(false),
  );
});

describe('checkUpstreamUrl', () => {
  it('accepts http and https', () => {
    expect(checkUpstreamUrl('http://deb.debian.org/debian').hostname).toBe('deb.debian.org');
    expect(checkUpstreamUrl('https://download.docker.com/linux/debian').protocol).toBe('https:');
  });
  it.each(['file:///etc/passwd', 'ftp://example.com/', 'gopher://x/', 'not a url', 'http://user:pw@example.com/'])(
    'rejects %s',
    (url) => expect(() => checkUpstreamUrl(url)).toThrow(UpstreamFetchError),
  );
  it.each(['http://127.0.0.1:3000/', 'http://[::1]/', 'http://169.254.169.254/latest/'])('rejects address %s', (url) =>
    expect(() => checkUpstreamUrl(url)).toThrow(/Refusing/),
  );
});

describe('closureOptionsError', () => {
  const base = { baseUrl: 'http://deb.debian.org/debian', suite: 'trixie', components: ['main'], arches: ['amd64'], seeds: ['curl'] };
  it('accepts a normal request', () => expect(closureOptionsError(base)).toBeNull());
  it('accepts nested suites and components', () =>
    expect(closureOptionsError({ ...base, suite: 'stable/updates', components: ['main/debian-installer'] })).toBeNull());
  it.each([
    { suite: '../../x' },
    { suite: 'trixie/..' },
    { components: ['main/../../etc'] },
    { arches: ['amd64?x=1'] },
    { baseUrl: 'file:///etc' },
    { baseUrl: 'http://localhost.example/debian?x=1' },
    { baseUrl: 'http://127.0.0.1/debian' },
  ])('rejects %o', (patch) => expect(closureOptionsError({ ...base, ...patch })).not.toBeNull());
});

describe('fetchUpstream', () => {
  let server: http.Server;
  let origin: string;
  let port: number;
  const allowLoopback = { allowAddress: () => true };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/ok') return res.end('hello');
      if (req.url === '/big') return res.end(Buffer.alloc(2048));
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/ok' });
        return res.end();
      }
      if (req.url === '/loop') {
        res.writeHead(302, { Location: '/loop' });
        return res.end();
      }
      if (req.url === '/hang') return; // never answers
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
    origin = `http://127.0.0.1:${port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it('returns the body', async () => {
    const body = await fetchUpstream(`${origin}/ok`, { timeoutMs: 2000, maxBytes: 100, ...allowLoopback });
    expect(body?.toString()).toBe('hello');
  });

  it('returns null for a 404', async () => {
    expect(await fetchUpstream(`${origin}/missing`, { timeoutMs: 2000, maxBytes: 100, ...allowLoopback })).toBeNull();
  });

  it('follows a redirect and gives up on a loop', async () => {
    const body = await fetchUpstream(`${origin}/redirect`, { timeoutMs: 2000, maxBytes: 100, ...allowLoopback });
    expect(body?.toString()).toBe('hello');
    await expect(fetchUpstream(`${origin}/loop`, { timeoutMs: 2000, maxBytes: 100, ...allowLoopback })).rejects.toThrow(
      /redirects/,
    );
  });

  it('caps the size', async () => {
    await expect(fetchUpstream(`${origin}/big`, { timeoutMs: 2000, maxBytes: 1000, ...allowLoopback })).rejects.toThrow(
      /larger than/,
    );
  });

  it('times out', async () => {
    await expect(fetchUpstream(`${origin}/hang`, { timeoutMs: 300, maxBytes: 100, ...allowLoopback })).rejects.toThrow(
      /timed out/,
    );
  });

  it('refuses a name that resolves to loopback', async () => {
    await expect(fetchUpstream(`http://localhost:${port}/ok`, { timeoutMs: 2000, maxBytes: 100 })).rejects.toThrow(
      /Refusing/,
    );
    await expect(fetchUpstream(`${origin}/ok`, { timeoutMs: 2000, maxBytes: 100 })).rejects.toThrow(/Refusing/);
  });
});
