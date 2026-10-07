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

async function tree(dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(path.relative(root, path.join(entry.parentPath, entry.name)));
  }
  return out.sort();
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

  it('moves packages of the old layout and keeps serving them', async () => {
    const write = async (rel: string, content = '') => {
      await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await fs.writeFile(path.join(root, rel), content);
    };
    await write('widget.json', JSON.stringify(doc('widget')));
    await write('widget/-/widget-1.0.0.tgz', 'w');
    await write('@acme/lib.json', JSON.stringify(doc('@acme/lib')));
    await write('@acme/lib/-/@acme/lib-1.0.0.tgz', 'l');
    // Left behind by the bug: left-pad.json's tarball dir sits where left-pad's document belongs.
    await write('left-pad.json.json', JSON.stringify(doc('left-pad.json')));
    await write('left-pad.json/-/left-pad.json-1.0.0.tgz', 'p');
    await write('stray.json.123.tmp', '{');

    const store = new PrivatePackageStore(root);
    expect(await store.isPrivate('widget')).toBe(true);
    expect((await store.readDoc('@acme/lib'))?.name).toBe('@acme/lib');
    expect((await store.readTarball('@acme/lib', '@acme/lib-1.0.0.tgz')).toString()).toBe('l');
    expect((await store.readTarball('widget', 'widget-1.0.0.tgz')).toString()).toBe('w');
    expect(await store.isPrivate('left-pad.json')).toBe(true);
    expect(await store.isPrivate('left-pad')).toBe(false);

    expect(await tree()).toEqual([
      '_packages/@acme/lib/-/@acme/lib-1.0.0.tgz',
      '_packages/@acme/lib/package.json',
      '_packages/left-pad.json/-/left-pad.json-1.0.0.tgz',
      '_packages/left-pad.json/package.json',
      '_packages/widget/-/widget-1.0.0.tgz',
      '_packages/widget/package.json',
      'stray.json.123.tmp',
    ]);
    expect((await fs.readdir(root)).sort()).toEqual(['_packages', 'stray.json.123.tmp']);
  });

  it('finishes a migration that was interrupted', async () => {
    await fs.mkdir(path.join(root, '_packages/widget/-'), { recursive: true });
    await fs.writeFile(path.join(root, '_packages/widget/-/widget-1.0.0.tgz'), 'w');
    await fs.writeFile(path.join(root, 'widget.json'), JSON.stringify(doc('widget')));

    const store = new PrivatePackageStore(root);
    expect(await store.isPrivate('widget')).toBe(true);
    expect(await tree()).toEqual(['_packages/widget/-/widget-1.0.0.tgz', '_packages/widget/package.json']);
  });
});
