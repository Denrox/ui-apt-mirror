import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  isWithin,
  MANAGED_DIR_ERROR,
  resolveBelow,
  resolveInside,
  SYNC_RUNNING_ERROR,
  writeBlockedReason,
} from './safe-path';

let base: string;
let files: string;
let priv: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'safe-path-')));
  files = path.join(base, 'files');
  priv = path.join(base, 'files-private');
  fs.mkdirSync(path.join(files, 'docs'), { recursive: true });
  fs.mkdirSync(priv);
  fs.writeFileSync(path.join(priv, 'secret.txt'), 'x');
  fs.mkdirSync(path.join(base, 'outside'));
  fs.symlinkSync(path.join(base, 'outside'), path.join(files, 'escape'));
  fs.symlinkSync(path.join(files, 'docs'), path.join(files, 'docs-link'));
});

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe('isWithin', () => {
  it('does not treat a sibling with the same prefix as inside', () => {
    expect(isWithin('/var/www/files-private/a', '/var/www/files')).toBe(false);
    expect(isWithin('/var/www/files/a', '/var/www/files')).toBe(true);
    expect(isWithin('/var/www/files', '/var/www/files')).toBe(true);
  });
});

describe('resolveInside', () => {
  it('accepts paths inside a root, including ones that do not exist yet', () => {
    expect(resolveInside(path.join(files, 'docs'), [files])).toBe(path.join(files, 'docs'));
    expect(resolveInside(path.join(files, 'new', 'dir'), [files])).toBe(path.join(files, 'new', 'dir'));
  });

  it.each([
    ['traversal', () => path.join(files, '..', 'outside')],
    ['absolute path elsewhere', () => '/etc'],
    ['private files when not allowed', () => path.join(priv, 'secret.txt')],
    ['symlink leading outside', () => path.join(files, 'escape')],
    ['path below a symlink leading outside', () => path.join(files, 'escape', 'x.txt')],
  ])('rejects %s', (_name, p) => {
    expect(resolveInside(p(), [files])).toBeNull();
  });

  it('follows symlinks that stay inside the roots', () => {
    expect(resolveInside(path.join(files, 'docs-link'), [files])).toBe(path.join(files, 'docs'));
  });

  it('rejects non-strings and NUL bytes', () => {
    expect(resolveInside(null, [files])).toBeNull();
    expect(resolveInside(`${files}/a\0b`, [files])).toBeNull();
  });
});

describe('resolveBelow', () => {
  it('never returns a root itself', () => {
    expect(resolveBelow(files, [files])).toBeNull();
    expect(resolveBelow(`${files}/`, [files])).toBeNull();
    expect(resolveBelow(path.join(files, 'docs'), [files])).toBe(path.join(files, 'docs'));
  });
});

describe('writeBlockedReason', () => {
  const dirs = () => ({ mirror: path.join(base, 'apt-mirror'), npm: path.join(base, 'npm') });

  it('allows anything outside the managed dirs, even during a sync', () => {
    expect(writeBlockedReason(path.join(files, 'new'), 'add', true, dirs())).toBeNull();
    expect(writeBlockedReason(path.join(files, 'docs'), 'remove', true, dirs())).toBeNull();
  });

  it('only allows removal in the mirror and npm dirs', () => {
    for (const dir of Object.values(dirs())) {
      expect(writeBlockedReason(path.join(dir, 'x'), 'add', false, dirs())).toBe(MANAGED_DIR_ERROR);
      expect(writeBlockedReason(path.join(dir, 'x'), 'remove', false, dirs())).toBeNull();
    }
  });

  it('blocks every write in the mirror while a sync runs, but not in npm', () => {
    expect(writeBlockedReason(path.join(dirs().mirror, 'x'), 'remove', true, dirs())).toBe(SYNC_RUNNING_ERROR);
    expect(writeBlockedReason(path.join(dirs().npm, 'x'), 'remove', true, dirs())).toBeNull();
  });
});
