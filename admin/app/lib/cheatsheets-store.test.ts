import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import appConfig from '~/config/config.json';
import { cleanLeftovers, listSources, refreshSource, removeSource } from './cheatsheets-store';

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
