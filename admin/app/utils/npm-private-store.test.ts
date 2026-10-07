import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { PrivatePackageStore } from './npm-private-store';
import type { PackageDoc } from './npm-registry';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'npm-private-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function doc(name: string, version = '1.0.0'): PackageDoc {
  return { name, versions: { [version]: { name, version } }, 'dist-tags': { latest: version } };
}

describe('PrivatePackageStore', () => {
  it('keeps <name>.json apart from <name>', async () => {
    const store = new PrivatePackageStore(root);
    await store.writeDoc(doc('left-pad.json'));
    await store.writeTarball('left-pad.json', 'left-pad.json-1.0.0.tgz', Buffer.from('a'));
    expect(await store.isPrivate('left-pad')).toBe(false);
    expect(await store.readDoc('left-pad')).toBeNull();

    await store.writeDoc(doc('@acme/coll'));
    await store.writeDoc(doc('@acme/coll.json'));
    await store.writeTarball('@acme/coll', '@acme/coll-1.0.0.tgz', Buffer.from('b'));
    await store.writeTarball('@acme/coll.json', '@acme/coll.json-1.0.0.tgz', Buffer.from('c'));
    expect((await store.readDoc('@acme/coll'))?.name).toBe('@acme/coll');
    expect((await store.readDoc('@acme/coll.json'))?.name).toBe('@acme/coll.json');
    expect((await store.readTarball('@acme/coll', '@acme/coll-1.0.0.tgz')).toString()).toBe('b');

    await store.removePackage('@acme/coll.json');
    expect(await store.isPrivate('@acme/coll.json')).toBe(false);
    expect(await store.isPrivate('@acme/coll')).toBe(true);
    expect((await store.readTarball('@acme/coll', '@acme/coll-1.0.0.tgz')).toString()).toBe('b');
  });

  it('removes a package with its tarballs and its empty scope', async () => {
    const store = new PrivatePackageStore(root);
    await store.writeDoc(doc('@acme/widget'));
    await store.writeTarball('@acme/widget', '@acme/widget-1.0.0.tgz', Buffer.from('x'));
    await store.removePackage('@acme/widget');
    expect(await fs.readdir(store.packagesDir)).toEqual([]);
  });

  it('refuses names and tarball paths outside the package', () => {
    const store = new PrivatePackageStore(root);
    for (const name of ['../x', '@acme/../../x', '', '_packages', 'A']) {
      expect(() => store.docPath(name)).toThrow();
    }
    expect(() => store.tarballPath('widget', '../package.json')).toThrow();
    expect(() => store.tarballPath('widget', '../../other/-/x.tgz')).toThrow();
    expect(() => store.tarballPath('widget', '')).toThrow();
  });
});
