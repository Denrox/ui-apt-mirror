import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isTruncated, scanTrees } from './health-scan';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-scan-'));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (rel: string, size: number) => {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.alloc(size));
  return full;
};

describe('isTruncated', () => {
  it('leaves small or empty files of free-form formats alone', () => {
    expect(isTruncated('Packages', 0)).toBe(false);
    expect(isTruncated('keys.json', 3)).toBe(false);
    expect(isTruncated('note.txt', 0)).toBe(false);
  });

  it('flags archives below their format minimum', () => {
    expect(isTruncated('pkg.deb', 0)).toBe(true);
    expect(isTruncated('Packages.gz', 10)).toBe(true);
    expect(isTruncated('Packages.gz', 20)).toBe(false);
    expect(isTruncated('Packages.bz2', 14)).toBe(false);
    expect(isTruncated('Packages.XZ', 31)).toBe(true);
  });
});

describe('scanTrees', () => {
  it('counts files and dirs at every depth and reports only truncated files', async () => {
    write('a/b/c/Packages', 0);
    write('a/b/c/Packages.gz', 20);
    const broken = write('a/pool/x.deb', 0);
    write('top.txt', 1);
    write('.hidden', 1);

    const scan = await scanTrees([dir]);
    expect(scan.totalFiles).toBe(4);
    expect(scan.totalDirectories).toBe(4);
    expect(scan.invalidFiles).toEqual([{ path: broken, reason: 'truncated', size: 0 }]);
    expect(scan.scanErrors).toEqual([]);
  });

  it('removes stale upload temp dirs without counting them', async () => {
    const tmp = path.join(dir, '.tmp-abc');
    write('.tmp-abc/f.temp', 5);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(path.join(tmp, 'f.temp'), old, old);
    fs.utimesSync(tmp, old, old);

    const scan = await scanTrees([dir]);
    expect(scan.cleanedTmpDirs).toEqual([tmp]);
    expect(fs.existsSync(tmp)).toBe(false);
    expect(scan.totalDirectories).toBe(0);
  });

  it('does not loop on symlink cycles', async () => {
    fs.mkdirSync(path.join(dir, 'a'));
    fs.symlinkSync(dir, path.join(dir, 'a', 'back'));
    const scan = await scanTrees([dir]);
    expect(scan.totalDirectories).toBe(2);
  });
});

describe('scanTrees with symlinks (r2-files-7)', () => {
  it('never descends into or cleans up through links that leave the roots', async () => {
    const root = path.join(dir, 'files');
    const outside = path.join(dir, 'outside');
    write('files/ok.deb', 100);
    write('outside/broken.deb', 0);
    const outsideTemp = path.join(outside, '.tmp-outside');
    fs.mkdirSync(outsideTemp);
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    fs.utimesSync(outsideTemp, old, old);
    fs.symlinkSync(outside, path.join(root, 'link-out'));
    fs.symlinkSync(outsideTemp, path.join(root, '.tmp-link'));
    fs.symlinkSync(path.join(root, 'gone'), path.join(root, 'dangling'));

    const scan = await scanTrees([root]);
    expect(fs.existsSync(outsideTemp)).toBe(true);
    expect(scan.cleanedTmpDirs).toEqual([]);
    expect(scan.invalidFiles).toEqual([]);
    expect(scan.totalFiles).toBe(1);
    expect(scan.scanErrors).toEqual([]);
  });

  it('still follows links that stay inside the roots', async () => {
    const root = path.join(dir, 'files');
    write('files/sub/pkg.deb', 0);
    fs.symlinkSync(path.join(root, 'sub'), path.join(root, 'sub-link'));
    const scan = await scanTrees([root]);
    expect(scan.invalidFiles.map((f) => path.relative(root, f.path))).toEqual(['sub/pkg.deb']);
  });
});
