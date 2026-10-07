import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { moveFile } from './move-path';

let base: string;
let from: string;
let to: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'move-path-'));
  from = path.join(base, 'files');
  to = path.join(base, 'files-private');
  fs.mkdirSync(path.join(from, 'dir', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(from, 'a.txt'), 'a');
  fs.writeFileSync(path.join(from, 'dir', 'sub', 'b.txt'), 'b');
  fs.symlinkSync('sub/b.txt', path.join(from, 'dir', 'link'));
  fs.mkdirSync(to);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(base, { recursive: true, force: true });
});

const realRename = fsp.rename;
// `from` and `to` behave like separate mounts: renames between them fail with EXDEV.
const crossDevice = () =>
  vi.spyOn(fsp, 'rename').mockImplementation(async (oldPath, newPath) => {
    const mount = (p: unknown) => (String(p).startsWith(to) ? 'to' : 'from');
    if (mount(oldPath) !== mount(newPath)) {
      throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
    }
    return realRename(oldPath, newPath);
  });

describe('moveFile', () => {
  it('moves within one filesystem', async () => {
    expect(await moveFile(path.join(from, 'a.txt'), to)).toBe(true);
    expect(fs.readFileSync(path.join(to, 'a.txt'), 'utf-8')).toBe('a');
    expect(fs.existsSync(path.join(from, 'a.txt'))).toBe(false);
  });

  it('copies and removes a file across filesystems', async () => {
    crossDevice();
    expect(await moveFile(path.join(from, 'a.txt'), to)).toBe(true);
    expect(fs.readFileSync(path.join(to, 'a.txt'), 'utf-8')).toBe('a');
    expect(fs.existsSync(path.join(from, 'a.txt'))).toBe(false);
  });

  it('copies a directory across filesystems, keeping symlinks as links', async () => {
    crossDevice();
    expect(await moveFile(path.join(from, 'dir'), to)).toBe(true);
    expect(fs.readFileSync(path.join(to, 'dir', 'sub', 'b.txt'), 'utf-8')).toBe('b');
    expect(fs.readlinkSync(path.join(to, 'dir', 'link'))).toBe('sub/b.txt');
    expect(fs.existsSync(path.join(from, 'dir'))).toBe(false);
  });

  it('refuses existing targets and moving a folder into itself', async () => {
    fs.writeFileSync(path.join(to, 'a.txt'), 'other');
    crossDevice();
    expect(await moveFile(path.join(from, 'a.txt'), to)).toBe(false);
    expect(fs.readFileSync(path.join(to, 'a.txt'), 'utf-8')).toBe('other');
    expect(fs.existsSync(path.join(from, 'a.txt'))).toBe(true);
    expect(await moveFile(path.join(from, 'dir'), path.join(from, 'dir', 'sub'))).toBe(false);
  });

  it('keeps the source when the copy fails', async () => {
    crossDevice();
    vi.spyOn(fsp, 'cp').mockRejectedValue(new Error('ENOSPC'));
    expect(await moveFile(path.join(from, 'dir'), to)).toBe(false);
    expect(fs.existsSync(path.join(from, 'dir', 'sub', 'b.txt'))).toBe(true);
    expect(fs.existsSync(path.join(to, 'dir'))).toBe(false);
  });

  it('of two concurrent cross-mount moves of one item, one wins and the data survives', async () => {
    crossDevice();
    fs.writeFileSync(path.join(from, 'big.bin'), Buffer.alloc(4 * 1024 * 1024, 7));
    const results = await Promise.all([
      moveFile(path.join(from, 'big.bin'), to),
      moveFile(path.join(from, 'big.bin'), to),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(fs.statSync(path.join(to, 'big.bin')).size).toBe(4 * 1024 * 1024);
    expect(fs.existsSync(path.join(from, 'big.bin'))).toBe(false);
    expect(fs.readdirSync(to)).toEqual(['big.bin']);
  });

  it('never removes a target it did not create', async () => {
    crossDevice();
    vi.spyOn(fsp, 'cp').mockImplementation(async () => {
      // Someone else fills the claimed name while the copy runs, then the copy fails.
      fs.writeFileSync(path.join(to, 'a.txt'), 'theirs');
      throw new Error('ENOSPC');
    });
    expect(await moveFile(path.join(from, 'a.txt'), to)).toBe(false);
    expect(fs.readFileSync(path.join(to, 'a.txt'), 'utf-8')).toBe('theirs');
    expect(fs.readFileSync(path.join(from, 'a.txt'), 'utf-8')).toBe('a');
  });

  it('leaves no placeholder or temp dir behind when the copy fails', async () => {
    crossDevice();
    vi.spyOn(fsp, 'cp').mockRejectedValue(new Error('ENOSPC'));
    expect(await moveFile(path.join(from, 'a.txt'), to)).toBe(false);
    expect(fs.readdirSync(to)).toEqual([]);
  });

  it('moves a symlink as a link across filesystems', async () => {
    crossDevice();
    fs.symlinkSync(path.join(from, 'dir'), path.join(from, 'dir-link'));
    expect(await moveFile(path.join(from, 'dir-link'), to)).toBe(true);
    expect(fs.readlinkSync(path.join(to, 'dir-link'))).toBe(path.join(from, 'dir'));
    expect(fs.existsSync(path.join(from, 'dir', 'sub', 'b.txt'))).toBe(true);
  });
});
