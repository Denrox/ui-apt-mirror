import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { moveFile, renameEntry, restoreParkedMoves, MOVE_SOURCE_PREFIX } from './move-path';

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
  it('keeps what is added to a folder while it is copied (r3-files-1)', async () => {
    crossDevice();
    const realCp = fsp.cp;
    vi.spyOn(fsp, 'cp').mockImplementation(async (...args) => {
      // An upload and a new folder arrive under the old path while the copy runs.
      fs.mkdirSync(path.join(from, 'dir'), { recursive: true });
      fs.writeFileSync(path.join(from, 'dir', 'late.txt'), 'late');
      fs.mkdirSync(path.join(from, 'dir', 'late-folder'));
      return realCp(...args);
    });
    expect(await moveFile(path.join(from, 'dir'), to)).toBe(true);
    expect(fs.readFileSync(path.join(to, 'dir', 'sub', 'b.txt'), 'utf-8')).toBe('b');
    expect(fs.existsSync(path.join(to, 'dir', 'late.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(from, 'dir', 'late.txt'), 'utf-8')).toBe('late');
    expect(fs.existsSync(path.join(from, 'dir', 'late-folder'))).toBe(true);
    expect(fs.readdirSync(from).filter((n) => n.startsWith('.'))).toEqual([]);
  });

  it('removes only what was copied unchanged and puts the rest back (r3-files-1)', async () => {
    crossDevice();
    const realCp = fsp.cp;
    vi.spyOn(fsp, 'cp').mockImplementation(async (src, ...rest) => {
      await realCp(src, ...rest);
      // A write through a handle opened before the move lands in the parked source after it was copied.
      fs.appendFileSync(path.join(String(src), 'sub', 'b.txt'), '-more');
      fs.writeFileSync(path.join(String(src), 'new.txt'), 'new');
    });
    expect(await moveFile(path.join(from, 'dir'), to)).toBe(true);
    expect(fs.readFileSync(path.join(to, 'dir', 'sub', 'b.txt'), 'utf-8')).toBe('b');
    expect(fs.readFileSync(path.join(from, 'dir', 'sub', 'b.txt'), 'utf-8')).toBe('b-more');
    expect(fs.readFileSync(path.join(from, 'dir', 'new.txt'), 'utf-8')).toBe('new');
    // The link was copied as is, so it is gone from the source.
    expect(fs.existsSync(path.join(from, 'dir', 'link'))).toBe(false);
    expect(fs.readdirSync(from).filter((n) => n.startsWith('.'))).toEqual([]);
  });

  it('puts a failed move back under a free name when the old one was taken meanwhile', async () => {
    crossDevice();
    vi.spyOn(fsp, 'cp').mockImplementation(async () => {
      fs.mkdirSync(path.join(from, 'dir'));
      fs.writeFileSync(path.join(from, 'dir', 'late.txt'), 'late');
      throw new Error('ENOSPC');
    });
    expect(await moveFile(path.join(from, 'dir'), to)).toBe(false);
    expect(fs.readFileSync(path.join(from, 'dir', 'late.txt'), 'utf-8')).toBe('late');
    expect(fs.readFileSync(path.join(from, 'dir (not moved)', 'sub', 'b.txt'), 'utf-8')).toBe('b');
    expect(fs.readdirSync(to)).toEqual([]);
  });

  it('puts back a source a restart left parked', async () => {
    const parked = path.join(from, `${MOVE_SOURCE_PREFIX}0123456789abcdef`);
    fs.renameSync(path.join(from, 'dir'), parked);
    fs.writeFileSync(parked + '.name', 'dir');
    await restoreParkedMoves(base);
    expect(fs.readFileSync(path.join(from, 'dir', 'sub', 'b.txt'), 'utf-8')).toBe('b');
    expect(fs.readdirSync(from).filter((n) => n.startsWith('.'))).toEqual([]);
  });
});

describe('renameEntry', () => {
  it('renames files, symlinks (not their targets) and directories', async () => {
    expect(await renameEntry(path.join(from, 'a.txt'), 'c.txt')).toBe(true);
    expect(fs.readFileSync(path.join(from, 'c.txt'), 'utf-8')).toBe('a');
    expect(fs.existsSync(path.join(from, 'a.txt'))).toBe(false);
    expect(fs.statSync(path.join(from, 'c.txt')).nlink).toBe(1);

    expect(await renameEntry(path.join(from, 'dir', 'link'), 'link2')).toBe(true);
    expect(fs.readlinkSync(path.join(from, 'dir', 'link2'))).toBe('sub/b.txt');
    expect(fs.readFileSync(path.join(from, 'dir', 'sub', 'b.txt'), 'utf-8')).toBe('b');

    expect(await renameEntry(path.join(from, 'dir'), 'dir2')).toBe(true);
    expect(fs.readFileSync(path.join(from, 'dir2', 'sub', 'b.txt'), 'utf-8')).toBe('b');
  });

  it('refuses a taken name, a dangling symlink included', async () => {
    fs.writeFileSync(path.join(from, 'taken.txt'), 'keep');
    fs.symlinkSync('nowhere', path.join(from, 'dangling'));
    fs.mkdirSync(path.join(from, 'empty'));
    expect(await renameEntry(path.join(from, 'a.txt'), 'taken.txt')).toBe(false);
    expect(await renameEntry(path.join(from, 'a.txt'), 'dangling')).toBe(false);
    expect(await renameEntry(path.join(from, 'dir'), 'empty')).toBe(false);
    expect(await renameEntry(path.join(from, 'a.txt'), 'a.txt')).toBe(false);
    expect(fs.readFileSync(path.join(from, 'taken.txt'), 'utf-8')).toBe('keep');
    expect(fs.readFileSync(path.join(from, 'a.txt'), 'utf-8')).toBe('a');
    expect(fs.readlinkSync(path.join(from, 'dangling'))).toBe('nowhere');
    expect(fs.existsSync(path.join(from, 'dir', 'sub', 'b.txt'))).toBe(true);
  });

  // Someone else creates the new name right after the first file system call that looks at it,
  // i.e. between a taken-name check and the rename.
  /** Returns a function telling whether their create happened. */
  function raceOn(target: string, create: () => void): () => boolean {
    let raced = false;
    let created = false;
    for (const name of ['lstat', 'stat', 'access', 'link', 'mkdir', 'open', 'rename'] as const) {
      const real = (fsp as any)[name].bind(fsp);
      vi.spyOn(fsp as any, name).mockImplementation(async (...args: unknown[]) => {
        try {
          return await real(...args);
        } finally {
          if (!raced && args.some((a) => String(a) === target)) {
            raced = true;
            try {
              create();
              created = true;
            } catch {
              // The name is already ours: nothing to race with.
            }
          }
        }
      });
    }
    return () => created;
  }

  it('never replaces a file created while it runs', async () => {
    const target = path.join(from, 'new.txt');
    const theyCreated = raceOn(target, () => fs.writeFileSync(target, 'theirs', { flag: 'wx' }));
    const renamed = await renameEntry(path.join(from, 'a.txt'), 'new.txt');
    vi.restoreAllMocks();
    const contents = [path.join(from, 'a.txt'), target]
      .filter((p) => fs.existsSync(p))
      .map((p) => fs.readFileSync(p, 'utf-8'));
    // Either we got the name first, or they did and both files survive.
    expect(renamed).toBe(!theyCreated());
    expect(contents.sort()).toEqual(renamed ? ['a'] : ['a', 'theirs']);
  });

  it('never replaces an empty directory created while it runs', async () => {
    const target = path.join(from, 'new-dir');
    // An empty directory is the one thing rename() replaces, so they leave it empty.
    const theyCreated = raceOn(target, () => fs.mkdirSync(target));
    const renamed = await renameEntry(path.join(from, 'dir'), 'new-dir');
    vi.restoreAllMocks();
    expect(renamed).toBe(!theyCreated());
    const moved = renamed ? path.join(target, 'sub', 'b.txt') : path.join(from, 'dir', 'sub', 'b.txt');
    expect(fs.readFileSync(moved, 'utf-8')).toBe('b');
  });

  it('falls back to claiming the name where hard links are refused', async () => {
    vi.spyOn(fsp, 'link').mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }));
    expect(await renameEntry(path.join(from, 'a.txt'), 'c.txt')).toBe(true);
    expect(fs.readFileSync(path.join(from, 'c.txt'), 'utf-8')).toBe('a');
    fs.writeFileSync(path.join(from, 'taken.txt'), 'keep');
    expect(await renameEntry(path.join(from, 'c.txt'), 'taken.txt')).toBe(false);
    expect(fs.readFileSync(path.join(from, 'taken.txt'), 'utf-8')).toBe('keep');
    expect(fs.readFileSync(path.join(from, 'c.txt'), 'utf-8')).toBe('a');
  });
});
