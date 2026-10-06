import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createdLevels, mkdirOwned } from './file-owner';

let dir: string | undefined;
afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }));

describe('createdLevels', () => {
  it('lists every directory from the first created one down to the target', () => {
    expect(createdLevels('/var/www/files/a', '/var/www/files/a/b/c')).toEqual([
      '/var/www/files/a',
      '/var/www/files/a/b',
      '/var/www/files/a/b/c',
    ]);
    expect(createdLevels('/var/www/files/a', '/var/www/files/a')).toEqual(['/var/www/files/a']);
  });
});

describe('mkdirOwned', () => {
  it('creates nested directories with the parent owner and tolerates existing ones', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-owner-'));
    const target = path.join(dir, 'a', 'b');
    await mkdirOwned(target);
    await mkdirOwned(target);
    const parent = fs.statSync(dir);
    const created = fs.statSync(target);
    expect(created.isDirectory()).toBe(true);
    expect([created.uid, created.gid]).toEqual([parent.uid, parent.gid]);
  });
});
