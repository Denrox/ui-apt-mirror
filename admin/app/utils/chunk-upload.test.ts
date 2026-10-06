import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  abortUpload,
  removeStaleTempDirs,
  sweepStaleUploads,
  uploadTempDir,
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
});
