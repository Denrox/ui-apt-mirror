import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readTail } from './read-tail';

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-tail-'));
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('readTail', () => {
  it('returns small files whole', async () => {
    const file = path.join(dir, 'small.log');
    fs.writeFileSync(file, 'a\nb\n');
    expect(await readTail(file, 100)).toEqual({ content: 'a\nb\n', size: 4, truncated: false, firstLine: 1 });
  });

  it('returns only whole trailing lines of large files', async () => {
    const file = path.join(dir, 'big.log');
    fs.writeFileSync(file, 'line-1\nline-2\nline-3\n');
    const tail = await readTail(file, 10);
    expect(tail).toEqual({ content: 'line-3\n', size: 21, truncated: true, firstLine: 3 });
  });

  it('numbers the tail by its lines in the whole file, also as the file grows', async () => {
    const file = path.join(dir, 'growing.log');
    const lines = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}\n`).join('');
    fs.writeFileSync(file, lines(1, 5000));
    const check = async (maxBytes: number) => {
      const { content, firstLine } = await readTail(file, maxBytes);
      expect(content.split('\n')[0]).toBe(`line ${firstLine}`);
      return firstLine;
    };
    const first = await check(1000);
    expect(first).toBeGreaterThan(4800);
    // Cut exactly after a newline: the whole line before the cut is dropped too.
    const size = fs.statSync(file).size;
    expect(await check(size - lines(1, 10).length)).toBe(12);

    fs.appendFileSync(file, lines(5001, 9000));
    expect(await check(1000)).toBeGreaterThan(8800);

    // Rotated or truncated in place: counted again from the start.
    fs.writeFileSync(file, lines(1, 300));
    await check(100);
    fs.rmSync(file);
    fs.writeFileSync(file, `x\n${lines(2, 400)}`);
    await check(100);
  });
});
