import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import appConfig from '~/config/config.json';
import {
  addSource,
  cleanLeftovers,
  giveTreeToOwner,
  isPublicCheatsheetsRequest,
  listSources,
  loadIndex,
  refreshSource,
  removeSource,
} from './cheatsheets-store';

let dir: string;
const originalDir = appConfig.cheatsheetsDir;

const source = (id: string) => ({
  id,
  name: id,
  url: `https://github.com/o/${id}`,
  owner: 'o',
  repo: id,
  ref: null,
  path: '',
  status: 'ready',
  error: null,
  fileCount: 1,
  revision: null,
  addedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: null,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cheatsheets-store-'));
  appConfig.cheatsheetsDir = dir;
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify({ sources: [source('a')] }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  appConfig.cheatsheetsDir = originalDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

describe('refreshSource', () => {
  it('starts only one download for parallel requests and blocks removal meanwhile', async () => {
    let finish: () => void = () => {};
    const fetchMock = vi.fn(
      () => new Promise((resolve) => (finish = () => resolve({ status: 404, ok: false }))),
    );
    vi.stubGlobal('fetch', fetchMock);

    const results = await Promise.allSettled([refreshSource('a'), refreshSource('a'), refreshSource('a')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(removeSource('a')).rejects.toThrow(/Wait for the download/);

    await waitFor(() => fetchMock.mock.calls.length === 1);
    finish();
    await waitFor(() => !fs.readdirSync(dir).some((n) => n.startsWith('.tmp-')));
    await waitFor(() => JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf-8')).sources[0].status === 'error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await removeSource('a');
  });
});

describe('addSource', () => {
  it('stores a cleaned, length-capped name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 404, ok: false })));
    const long = await addSource('https://github.com/o/long', `Line one\nline\u202Etwo ${'x'.repeat(200_000)}`);
    expect(long.name).toMatch(/^Line one line two x+$/);
    expect(long.name).toHaveLength(100);
    expect(long.nameFromUser).toBe(true);
    const blank = await addSource('https://github.com/o/blank', ' \n ');
    expect(blank).toMatchObject({ name: 'o/blank', nameFromUser: false });
    await waitFor(() =>
      JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf-8'))
        .sources.filter((s: { id: string }) => s.id !== 'a')
        .every((s: { status: string }) => s.status === 'error'),
    );
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf-8')).sources;
    expect(stored.find((s: { url: string }) => s.url.endsWith('/long')).name).toBe(long.name);
  });

  it('cleans names stored before names were cleaned', async () => {
    fs.writeFileSync(
      path.join(dir, 'sources.json'),
      JSON.stringify({ sources: [{ ...source('a'), name: `Old\nname ${'y'.repeat(500)}` }] }),
    );
    const [s] = await listSources();
    expect(s.name).toHaveLength(100);
    expect(s.name.startsWith('Old name y')).toBe(true);
  });
});

describe('giveTreeToOwner', () => {
  it("gives every file and folder of a source to the data directory's owner", async () => {
    const src = path.join(dir, 'sources', 'a');
    fs.mkdirSync(path.join(src, 'files', 'common'), { recursive: true });
    fs.writeFileSync(path.join(src, 'files', 'common', 'tar.md'), '# tar');
    fs.writeFileSync(path.join(src, 'index.json'), '[]');
    const lchown = vi.spyOn(fsp, 'lchown').mockResolvedValue(undefined);
    try {
      const me = fs.statSync(dir);
      await giveTreeToOwner(src);
      expect(lchown).not.toHaveBeenCalled();

      await giveTreeToOwner(src, { uid: me.uid + 1, gid: me.gid + 1 });
      expect(lchown.mock.calls.map(([p]) => path.relative(src, String(p))).sort()).toEqual(
        ['', 'files', 'files/common', 'files/common/tar.md', 'index.json'].sort(),
      );
      expect(lchown).toHaveBeenCalledWith(src, me.uid + 1, me.gid + 1);
    } finally {
      lchown.mockRestore();
    }
  });
});

describe('cleanLeftovers', () => {
  it('removes stray work dirs and source dirs without a registry entry', async () => {
    fs.mkdirSync(path.join(dir, '.tmp-gone-123'));
    fs.mkdirSync(path.join(dir, 'sources', 'a'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'sources', 'orphan'), { recursive: true });

    await cleanLeftovers();
    expect(fs.existsSync(path.join(dir, '.tmp-gone-123'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'sources', 'orphan'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'sources', 'a'))).toBe(true);
    expect((await listSources()).map((s) => s.id)).toEqual(['a']);
  });
});

describe('loadIndex', () => {
  it('adds headings from the stored pages to an index written before they were indexed', async () => {
    const src = path.join(dir, 'sources', 'a');
    fs.mkdirSync(path.join(src, 'files'), { recursive: true });
    fs.writeFileSync(path.join(src, 'files', 'ch4.md'), '# Chapter 4\n\n## Tourniquets\n\nText.\n');
    fs.writeFileSync(
      path.join(src, 'index.json'),
      JSON.stringify([
        { path: 'ch4.md', title: 'Chapter 4', categories: ['General'], text: 'Text.' },
        { path: 'gone.md', title: 'Gone', categories: ['General'], text: '' },
        { path: 'new.md', title: 'New', categories: ['General'], text: '', headings: 'Kept' },
      ]),
    );
    const [first, second] = await Promise.all([loadIndex('a'), loadIndex('a')]);
    expect(first).toBe(second);
    expect(first.map((e) => e.headings)).toEqual(['Tourniquets', '', 'Kept']);
  });
});

describe('isPublicCheatsheetsRequest', () => {
  it('goes by the host and ignores the Referer', () => {
    const req = (url: string, referer?: string) =>
      new Request(url, { headers: referer ? { Referer: referer } : {} });
    expect(isPublicCheatsheetsRequest(req('http://cheatsheets.uam.test/api/cheatsheets/search'))).toBe(true);
    expect(isPublicCheatsheetsRequest(req('http://admin.uam.test/cheatsheets', 'http://cheatsheets.x/'))).toBe(false);
  });
});
