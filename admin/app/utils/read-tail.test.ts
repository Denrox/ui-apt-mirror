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
    expect(await readTail(file, 100)).toEqual({ content: 'a\nb\n', size: 4, truncated: false });
  });

  it('returns only whole trailing lines of large files', async () => {
    const file = path.join(dir, 'big.log');
    fs.writeFileSync(file, 'line-1\nline-2\nline-3\n');
    const tail = await readTail(file, 10);
    expect(tail).toEqual({ content: 'line-3\n', size: 21, truncated: true });
  });
});
