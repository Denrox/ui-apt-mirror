import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import appConfig from '~/config/config.json';
import { publicSearches } from '~/lib/search-limiter';
import { loader } from './api.cheatsheets.search';

let dir: string;
const originalDir = appConfig.cheatsheetsDir;
const url = 'http://cheatsheets.mirror.intra/api/cheatsheets/search?q=help';
const from = (ip: string, signal?: AbortSignal) => new Request(url, { headers: { 'X-Real-IP': ip }, signal });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cheatsheets-search-'));
  appConfig.cheatsheetsDir = dir;
  const source = {
    id: 'a', name: 'A', url: 'https://github.com/o/a', owner: 'o', repo: 'a', ref: null, path: '',
    status: 'ready', error: null, fileCount: 1, revision: null, addedAt: '2026-01-01T00:00:00.000Z', updatedAt: null,
  };
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify({ sources: [source] }));
  fs.mkdirSync(path.join(dir, 'sources', 'a'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'sources', 'a', 'index.json'),
    JSON.stringify([{ path: 'x.md', title: 'Help', categories: [], text: 'help me', headings: '' }]),
  );
});

afterEach(() => {
  appConfig.cheatsheetsDir = originalDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/cheatsheets/search', () => {
  it('answers a public search', async () => {
    const res = await loader({ request: new Request(url) });
    expect(res.status).toBe(200);
    expect((await res.json()).total).toBe(1);
    expect(publicSearches.active).toBe(0);
  });

  it('turns public searches away with 503 once the slots and the queue are full', async () => {
    const held = [];
    for (let i = 0; i < publicSearches.maxRunning; i++) held.push(await publicSearches.acquire());
    const controllers = Array.from({ length: publicSearches.maxQueued }, () => new AbortController());
    const queued = controllers.map((c, i) => loader({ request: from(`192.168.0.${i + 1}`, c.signal) }));
    await new Promise((r) => setTimeout(r, 10));
    expect(publicSearches.queued).toBe(publicSearches.maxQueued);

    const busy = await loader({ request: from('192.168.0.100') });
    expect(busy.status).toBe(503);
    expect(busy.headers.get('Retry-After')).toBe('1');

    // Clients that hang up while queued leave the queue and cost nothing.
    controllers.slice(1).forEach((c) => c.abort());
    expect(publicSearches.queued).toBe(1);
    for (const res of await Promise.all(queued.slice(1))) expect(res.status).toBe(499);

    held.forEach((release) => release!());
    expect((await queued[0]).status).toBe(200);
    expect(publicSearches.active).toBe(0);
  });

  it('gives one public client at most two places, leaving the rest of the queue to others', async () => {
    const held = [];
    for (let i = 0; i < publicSearches.maxRunning; i++) held.push(await publicSearches.acquire());
    const controllers = [new AbortController(), new AbortController()];
    const queued = controllers.map((c) => loader({ request: from('192.168.0.1', c.signal) }));
    await new Promise((r) => setTimeout(r, 10));

    const third = await loader({ request: from('192.168.0.1') });
    expect(third.status).toBe(503);
    expect(publicSearches.queued).toBe(2);

    const other = new AbortController();
    const fromOther = loader({ request: from('192.168.0.2', other.signal) });
    await new Promise((r) => setTimeout(r, 10));
    expect(publicSearches.queued).toBe(3);

    // A client that hung up gets its place back.
    controllers[0].abort();
    expect((await queued[0]).status).toBe(499);
    const again = new AbortController();
    const queuedAgain = loader({ request: from('192.168.0.1', again.signal) });
    await new Promise((r) => setTimeout(r, 10));
    expect(publicSearches.queued).toBe(3);

    again.abort();
    other.abort();
    controllers[1].abort();
    await Promise.all([queued[1], fromOther, queuedAgain]);
    held.forEach((release) => release!());
    expect(publicSearches.active).toBe(0);
    expect(publicSearches.queued).toBe(0);
  });
});
