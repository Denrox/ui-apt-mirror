import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  isWithin,
  MANAGED_DIR_ERROR,
  resolveEntry,
  resolveInside,
  SYNC_RUNNING_ERROR,
  writeBlockedReason,
  MIRROR_STRUCTURE_ERROR,
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
    ['sibling whose name starts with the root name', () => `${files}-x/a.txt`],
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

describe('resolveEntry', () => {
  it('never returns a root itself', () => {
    expect(resolveEntry(files, [files])).toBeNull();
    expect(resolveEntry(`${files}/`, [files])).toBeNull();
    expect(resolveEntry(`${files}/.`, [files])).toBeNull();
    expect(resolveEntry(`${files}/docs/..`, [files])).toBeNull();
    expect(resolveEntry(path.join(files, 'docs'), [files])).toBe(path.join(files, 'docs'));
  });

  it('keeps a symlink as the link, not its target', () => {
    expect(resolveEntry(path.join(files, 'docs-link'), [files])).toBe(path.join(files, 'docs-link'));
    expect(resolveEntry(path.join(files, 'escape'), [files])).toBe(path.join(files, 'escape'));
  });

  it('resolves symlinks in the parent directories', () => {
    expect(resolveEntry(path.join(files, 'docs-link', 'a.txt'), [files])).toBe(path.join(files, 'docs', 'a.txt'));
  });

  it.each([
    ['traversal', () => path.join(files, '..', 'outside', 'x')],
    ['entry below a symlink leading outside', () => path.join(files, 'escape', 'x.txt')],
    ['private files when not allowed', () => path.join(priv, 'secret.txt')],
    ['sibling whose name starts with the root name', () => `${files}-x/a.txt`],
    ['the parent of a root', () => base],
  ])('rejects %s', (_name, p) => {
    expect(resolveEntry(p(), [files])).toBeNull();
  });

  it('rejects non-strings and NUL bytes', () => {
    expect(resolveEntry(undefined, [files])).toBeNull();
    expect(resolveEntry(`${files}/a\0b`, [files])).toBeNull();
  });
});

describe('writeBlockedReason', () => {
  const dirs = () => ({
    mirror: path.join(base, 'apt-mirror'),
    mirrorRoot: path.join(base, 'apt-mirror', 'mirror'),
    npm: path.join(base, 'npm'),
  });

  it('allows anything outside the managed dirs, even during a sync', () => {
    expect(writeBlockedReason(path.join(files, 'new'), 'add', true, dirs())).toBeNull();
    expect(writeBlockedReason(path.join(files, 'docs'), 'remove', true, dirs())).toBeNull();
  });

  it('only allows removal in the mirror and npm dirs', () => {
    for (const dir of [dirs().mirrorRoot, dirs().npm]) {
      expect(writeBlockedReason(path.join(dir, 'x'), 'add', false, dirs())).toBe(MANAGED_DIR_ERROR);
      expect(writeBlockedReason(path.join(dir, 'x'), 'remove', false, dirs())).toBeNull();
    }
  });

  it('keeps the signing keys and the mirror folders themselves (r3-files-4)', () => {
    const d = dirs();
    for (const name of ['gpg', 'gpg/keys.json', 'gpg/gnupg', 'gpg/gnupg/private-keys-v1.d/K.key', 'mirror', 'mirror/', 'skel', 'var', 'other']) {
      expect(writeBlockedReason(path.join(d.mirror, name), 'remove', false, d)).toBe(MIRROR_STRUCTURE_ERROR);
    }
    expect(writeBlockedReason(path.join(d.mirror, 'mirror', 'deb.debian.org'), 'remove', false, d)).toBeNull();
    expect(writeBlockedReason(path.join(d.mirror, 'mirror', 'deb.debian.org', 'pool'), 'remove', false, d)).toBeNull();
  });

  it('judges a link in the mirror by where it is, not where it points (r3-files-4)', () => {
    const d = dirs();
    fs.mkdirSync(path.join(d.mirror, 'gpg'), { recursive: true });
    fs.mkdirSync(d.mirrorRoot, { recursive: true });
    // A link inside the published tree to the keys can go; removing it leaves the keys.
    fs.symlinkSync(path.join(d.mirror, 'gpg'), path.join(d.mirrorRoot, 'keys-link'));
    expect(writeBlockedReason(path.join(d.mirrorRoot, 'keys-link'), 'remove', false, d)).toBeNull();
    // Reaching the keys through a link to them is still the keys.
    expect(writeBlockedReason(path.join(d.mirrorRoot, 'keys-link', 'keys.json'), 'remove', false, d)).toBe(
      MIRROR_STRUCTURE_ERROR,
    );
    // A link from public files into the mirror folders removes only the link.
    fs.symlinkSync(d.mirrorRoot, path.join(files, 'mirror-link'));
    expect(writeBlockedReason(path.join(files, 'mirror-link'), 'remove', false, d)).toBeNull();
  });

  it('judges a symlink by where it is and where it points', () => {
    const d = dirs();
    fs.mkdirSync(path.join(d.npm, 'pkg'), { recursive: true });
    fs.symlinkSync(path.join(d.npm, 'pkg'), path.join(files, 'npm-link'));
    fs.symlinkSync(files, path.join(d.npm, 'files-link'));
    expect(writeBlockedReason(path.join(files, 'npm-link'), 'add', false, d)).toBe(MANAGED_DIR_ERROR);
    expect(writeBlockedReason(path.join(d.npm, 'files-link'), 'add', false, d)).toBe(MANAGED_DIR_ERROR);
    expect(writeBlockedReason(path.join(files, 'npm-link'), 'remove', false, d)).toBeNull();
  });

  it('blocks every write in the mirror while a sync runs, but not in npm', () => {
    expect(writeBlockedReason(path.join(dirs().mirror, 'x'), 'remove', true, dirs())).toBe(SYNC_RUNNING_ERROR);
    expect(writeBlockedReason(path.join(dirs().npm, 'x'), 'remove', true, dirs())).toBeNull();
  });
});
