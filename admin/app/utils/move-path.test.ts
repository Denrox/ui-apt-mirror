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

const crossDevice = () =>
  vi.spyOn(fsp, 'rename').mockRejectedValue(Object.assign(new Error('EXDEV'), { code: 'EXDEV' }));

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
});
