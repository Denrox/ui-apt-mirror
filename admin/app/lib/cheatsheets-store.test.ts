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
  MAX_EXTRACTED_BYTES,
  parseIndex,
  planExtraction,
  refreshSource,
  removeSource,
  unescapeTarName,
  writeIndex,
} from './cheatsheets-store';
import { execFileSync } from 'child_process';

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
  it('reads an index once while it is unchanged', async () => {
    const src = path.join(dir, 'sources', 'a');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(
      path.join(src, 'index.json'),
      JSON.stringify([{ path: 'ch4.md', title: 'Chapter 4', categories: ['General'], text: 'Text.', headings: 'Tourniquets' }]),
    );
    const [first, second] = await Promise.all([loadIndex('a'), loadIndex('a')]);
    expect(first).toBe(second);
    expect(first.map((e) => e.headings)).toEqual(['Tourniquets']);
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

describe('planExtraction', () => {
  const line = (type: string, size: number, name: string) =>
    `${type}rw-r--r-- 0/0 ${String(size).padStart(9)} 2026-10-07 09:47:47 ${name}`;

  it('takes only regular .md files and categories.json inside the folder', () => {
    const plan = planExtraction(
      [
        line('d', 0, 'o-r-abc/'),
        line('-', 10, 'o-r-abc/README.md'),
        line('d', 0, 'o-r-abc/pages/'),
        line('-', 10, 'o-r-abc/pages/a.md'),
        line('-', 10, 'o-r-abc/pages/categories.json'),
        line('-', 999, 'o-r-abc/pages/video.mp4'),
        line('l', 0, 'o-r-abc/pages/link.md -> /etc/passwd'),
        line('-', 3 * 1024 * 1024, 'o-r-abc/pages/huge.md'),
        line('-', 10, 'o-r-abc/pages2/b.md'),
        line('-', 10, 'o-r-abc/pages/sub dir/\\303\\274ber.md'),
      ],
      'pages',
    );
    expect(plan.folderFound).toBe(true);
    expect(plan.members).toEqual([
      'o-r-abc/pages/a.md',
      'o-r-abc/pages/categories.json',
      'o-r-abc/pages/sub dir/\\303\\274ber.md',
    ]);
    expect(plan.bytes).toBe(30);
  });

  it('notices a missing folder', () => {
    expect(planExtraction([line('-', 1, 'o-r-abc/x.md')], 'nope').folderFound).toBe(false);
  });

  it('refuses archives whose markdown would unpack to too much', () => {
    const lines = Array.from({ length: 300 }, (_, i) => line('-', 2 * 1024 * 1024, `o-r-abc/p/${i}.md`));
    expect(300 * 2 * 1024 * 1024).toBeGreaterThan(MAX_EXTRACTED_BYTES);
    expect(() => planExtraction(lines, 'p')).toThrow(/larger than 512 MB/);
  });

  it('reads the names tar escapes', () => {
    expect(unescapeTarName('a\\nb\\\\c/\\303\\274ber.md')).toBe('a\nb\\c/über.md');
  });
});

describe('index files', () => {
  it('round-trip one page per line', async () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({
      path: `p/${i}.md`,
      title: `Page "${i}"\n`,
      categories: ['x'],
      text: 'line\nbreak, comma,',
      headings: '',
    }));
    const file = path.join(dir, 'index.json');
    await writeIndex(file, entries);
    const text = fs.readFileSync(file, 'utf-8');
    expect(JSON.parse(text)).toEqual(entries);
    expect(text.split('\n')).toHaveLength(entries.length + 3);
    expect(await parseIndex(text)).toEqual(entries);
    await writeIndex(file, []);
    expect(await parseIndex(fs.readFileSync(file, 'utf-8'))).toEqual([]);
  });
});

describe('downloading a source', () => {
  it('unpacks only the markdown of the folder, never symlinks', async () => {
    const build = path.join(dir, 'build');
    const top = path.join(build, 'o-r-0123abc');
    fs.mkdirSync(path.join(top, 'pages', 'sub'), { recursive: true });
    fs.mkdirSync(path.join(top, 'other'));
    fs.writeFileSync(path.join(top, 'README.md'), '# Whole repo');
    fs.writeFileSync(path.join(top, 'pages', 'README.md'), '# Pages folder');
    fs.writeFileSync(path.join(top, 'pages', 'a.md'), '# Alpha\nhelp');
    fs.writeFileSync(path.join(top, 'pages', 'sub', 'b.md'), '# Beta');
    fs.writeFileSync(path.join(top, 'pages', 'blob.bin'), Buffer.alloc(1024 * 1024));
    fs.writeFileSync(path.join(top, 'other', 'c.md'), '# Gamma');
    fs.symlinkSync('/etc/hostname', path.join(top, 'pages', 'link.md'));
    const archive = path.join(dir, 'repo.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', build, 'o-r-0123abc']);
    fs.rmSync(build, { recursive: true });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(fs.readFileSync(archive), { status: 200 })),
    );
    const added = await addSource('https://github.com/o/r/tree/main/pages');
    await waitFor(() =>
      JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf-8')).sources.some(
        (s: { id: string; status: string }) => s.id === added.id && s.status !== 'downloading',
      ),
    );
    const stored = (await listSources()).find((s) => s.id === added.id)!;
    expect(stored).toMatchObject({ status: 'ready', fileCount: 2, name: 'Pages folder', revision: '0123abc' });
    const files = path.join(dir, 'sources', added.id, 'files');
    const list = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? list(path.join(d, e.name)).map((n) => `${e.name}/${n}`) : [e.name],
      );
    expect(list(files).sort()).toEqual(['a.md', 'sub/b.md']);
    expect((await loadIndex(added.id)).map((e) => e.title).sort()).toEqual(['Alpha', 'Beta']);
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('.tmp-'))).toEqual([]);
  });

  it('says so when the folder is not in the repository', async () => {
    const build = path.join(dir, 'build2', 'o-r-0123abc');
    fs.mkdirSync(build, { recursive: true });
    fs.writeFileSync(path.join(build, 'a.md'), '# A');
    const archive = path.join(dir, 'repo2.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', path.dirname(build), 'o-r-0123abc']);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(fs.readFileSync(archive), { status: 200 })));
    const added = await addSource('https://github.com/o/r/tree/main/missing');
    await waitFor(() =>
      JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf-8')).sources.some(
        (s: { id: string; status: string }) => s.id === added.id && s.status === 'error',
      ),
    );
    expect((await listSources()).find((s) => s.id === added.id)?.error).toBe(
      'Folder "missing" not found in the repository',
    );
  });
});
