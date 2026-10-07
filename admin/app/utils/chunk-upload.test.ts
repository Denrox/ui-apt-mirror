import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  abortUpload,
  FINISHED_UPLOAD_MS,
  isStaleTempDir,
  removeStaleTempDirs,
  sweepStaleUploads,
  uploadTempDir,
  withBusyTempDir,
  writeChunk,
} from './chunk-upload';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-upload-'));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const chunk = (fileId: string, chunkIndex: number, totalChunks: number, data: string, fileName = 'f.bin') =>
  writeChunk({ fileId, dir, fileName, chunkIndex, totalChunks, data: Buffer.from(data) });

describe('writeChunk', () => {
  it('assembles chunks and removes the temp dir', async () => {
    expect(await chunk('a', 0, 3, 'one')).toBe('chunk');
    expect(await chunk('a', 1, 3, 'two')).toBe('chunk');
    expect(await chunk('a', 2, 3, 'three')).toBe('done');
    expect(fs.readFileSync(path.join(dir, 'f.bin'), 'utf-8')).toBe('onetwothree');
    expect(fs.existsSync(uploadTempDir(dir, 'a'))).toBe(false);
  });

  it('ignores a repeated chunk instead of appending it twice', async () => {
    await chunk('b', 0, 3, 'one');
    await chunk('b', 1, 3, 'two');
    await chunk('b', 1, 3, 'two');
    await chunk('b', 2, 3, 'three');
    expect(fs.readFileSync(path.join(dir, 'f.bin'), 'utf-8')).toBe('onetwothree');
  });

  it('appends a chunk once when copies of it arrive while the first is still being written', async () => {
    const big = (c: string) => c.repeat(2 * 1024 * 1024);
    await chunk('dup', 0, 3, big('a'));
    const copies = await Promise.all(Array.from({ length: 6 }, () => chunk('dup', 1, 3, big('b'))));
    expect(copies).toEqual(Array(6).fill('chunk'));
    expect(await chunk('dup', 2, 3, big('c'))).toBe('done');
    expect(fs.readFileSync(path.join(dir, 'f.bin'), 'utf-8')).toBe(big('a') + big('b') + big('c'));
  });

  it('accepts names up to 255 bytes and an empty file', async () => {
    const name = 'r2-files-' + 'M'.repeat(246);
    expect(Buffer.byteLength(name)).toBe(255);
    expect(await chunk('long', 0, 1, 'x', name)).toBe('done');
    expect(fs.readFileSync(path.join(dir, name), 'utf-8')).toBe('x');
    expect(await chunk('empty', 0, 1, '', 'empty.txt')).toBe('done');
    expect(fs.statSync(path.join(dir, 'empty.txt')).size).toBe(0);
  });

  it('removes its temp dir when a chunk cannot be stored', async () => {
    const name = 'x'.repeat(300);
    await expect(chunk('toolong', 0, 1, 'x', name)).rejects.toThrow();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('restarts cleanly when chunk 0 is sent again', async () => {
    await chunk('c', 0, 2, 'old');
    await chunk('c', 0, 2, 'new');
    await chunk('c', 1, 2, '!');
    expect(fs.readFileSync(path.join(dir, 'f.bin'), 'utf-8')).toBe('new!');
  });

  it('refuses unknown uploads and gaps, and drops their partial data', async () => {
    fs.mkdirSync(uploadTempDir(dir, 'd'));
    await expect(chunk('d', 1, 3, 'x')).rejects.toThrow(/interrupted/);
    expect(fs.existsSync(uploadTempDir(dir, 'd'))).toBe(false);

    await chunk('e', 0, 3, 'one');
    await expect(chunk('e', 2, 3, 'three')).rejects.toThrow(/Missing chunk/);
    expect(fs.existsSync(uploadTempDir(dir, 'e'))).toBe(false);
    await expect(chunk('e', 1, 3, 'two')).rejects.toThrow(/interrupted/);
  });

  it('rejects out-of-range chunk indexes', async () => {
    await expect(chunk('f', 3, 3, 'x')).rejects.toThrow(/Invalid/);
    await expect(chunk('f', Number.NaN, 3, 'x')).rejects.toThrow(/Invalid/);
  });

  it('refuses to replace an existing file', async () => {
    fs.writeFileSync(path.join(dir, 'f.bin'), 'old');
    await expect(chunk('g', 0, 1, 'new')).rejects.toThrow(/already exists/);
    expect(fs.readFileSync(path.join(dir, 'f.bin'), 'utf-8')).toBe('old');
    expect(fs.existsSync(uploadTempDir(dir, 'g'))).toBe(false);
  });

  it('refuses at the end when the name was taken during the upload', async () => {
    expect(await chunk('h', 0, 2, 'one')).toBe('chunk');
    fs.writeFileSync(path.join(dir, 'f.bin'), 'other');
    await expect(chunk('h', 1, 2, 'two')).rejects.toThrow(/already exists/);
    expect(fs.readFileSync(path.join(dir, 'f.bin'), 'utf-8')).toBe('other');
    expect(fs.existsSync(uploadTempDir(dir, 'h'))).toBe(false);
  });
});

describe('a resent last chunk', () => {
  it('is acknowledged for a 2-chunk upload without writing it again', async () => {
    expect(await chunk('last2', 0, 2, 'one')).toBe('chunk');
    expect(await chunk('last2', 1, 2, 'two')).toBe('done');
    expect(await chunk('last2', 1, 2, 'two')).toBe('done');
    expect(fs.readFileSync(path.join(dir, 'f.bin'), 'utf-8')).toBe('onetwo');
  });

  it('is acknowledged for a 1-chunk upload', async () => {
    expect(await chunk('last1', 0, 1, 'only')).toBe('done');
    expect(await chunk('last1', 0, 1, 'only')).toBe('done');
    expect(fs.readFileSync(path.join(dir, 'f.bin'), 'utf-8')).toBe('only');
  });

  it('is not acknowledged once the file is gone, or for another name', async () => {
    expect(await chunk('last3', 0, 1, 'x')).toBe('done');
    // The same id for another name is a new upload.
    expect(await chunk('last3', 0, 1, 'y', 'g.bin')).toBe('done');
    expect(fs.readFileSync(path.join(dir, 'g.bin'), 'utf-8')).toBe('y');
    expect(await chunk('last4', 0, 2, 'a', 'k.bin')).toBe('chunk');
    expect(await chunk('last4', 1, 2, 'b', 'k.bin')).toBe('done');
    fs.rmSync(path.join(dir, 'k.bin'));
    await expect(chunk('last4', 1, 2, 'b', 'k.bin')).rejects.toThrow(/interrupted/);
  });

  it('is forgotten after a while', async () => {
    expect(await chunk('last5', 0, 1, 'x', 'h.bin')).toBe('done');
    await sweepStaleUploads(undefined, Date.now() + FINISHED_UPLOAD_MS + 1);
    await expect(chunk('last5', 0, 1, 'x', 'h.bin')).rejects.toThrow(/already exists/);
  });
});

describe('cleanup', () => {
  it('abortUpload removes the partial data', async () => {
    await chunk('g', 0, 2, 'one');
    await abortUpload('g', dir);
    expect(fs.existsSync(uploadTempDir(dir, 'g'))).toBe(false);
  });

  it('sweeps uploads that stopped receiving chunks', async () => {
    await chunk('h', 0, 2, 'one');
    await sweepStaleUploads(60_000, Date.now() + 120_000);
    expect(fs.existsSync(uploadTempDir(dir, 'h'))).toBe(false);
    await expect(chunk('h', 1, 2, 'two')).rejects.toThrow(/interrupted/);
  });

  it('removes stale temp dirs left on disk, keeping fresh and active ones', async () => {
    const nested = path.join(dir, 'sub');
    const stale = uploadTempDir(nested, 'old');
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, 'x.temp'), 'x');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(path.join(stale, 'x.temp'), old, old);
    fs.utimesSync(stale, old, old);
    const fresh = uploadTempDir(dir, 'fresh');
    fs.mkdirSync(fresh);
    await chunk('active', 0, 2, 'one');
    fs.utimesSync(uploadTempDir(dir, 'active'), old, old);

    expect(await removeStaleTempDirs(dir, 60 * 60 * 1000)).toEqual([stale]);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(uploadTempDir(dir, 'active'))).toBe(true);
  });

  it('never treats a temp dir that a move is still writing as stale', async () => {
    const busy = path.join(dir, '.tmp-move-x');
    fs.mkdirSync(busy);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(busy, old, old);
    await withBusyTempDir(busy, async () => {
      expect(await isStaleTempDir(busy, 60_000)).toBe(false);
    });
    expect(await isStaleTempDir(busy, 60_000)).toBe(true);
  });
});
