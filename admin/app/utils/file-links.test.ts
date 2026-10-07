import { describe, it, expect } from 'vitest';
import { canDelete, encodePathSegments, fileUrl, relativeTo, viewOfPath } from './file-links';

const dirs = {
  filesDir: '/var/www/files',
  privateFilesDir: '/var/www/files-private',
  mirroredPackagesDir: '/var/spool/apt-mirror',
  mirrorRoot: '/var/spool/apt-mirror/mirror',
  npmPackagesDir: '/var/www/npm',
};
const hosts = { files: 'http://files.mirror.intra', mirror: 'http://mirror.intra' };

describe('relativeTo', () => {
  it('does not treat a sibling with the same prefix as inside', () => {
    expect(relativeTo('/var/www/files-private/a', '/var/www/files')).toBeNull();
    expect(relativeTo('/var/www/files/a/b', '/var/www/files')).toBe('a/b');
    expect(relativeTo('/var/www/files', '/var/www/files/')).toBe('');
  });
});

describe('viewOfPath (r2-files-11)', () => {
  it.each([
    [null, 'public-files'],
    ['/var/www/files/x', 'public-files'],
    ['/var/www/files-private', 'private-files'],
    ['/var/www/files-private/a', 'private-files'],
    ['/var/spool/apt-mirror/mirror/dists', 'mirrored-packages'],
    ['/var/www/npm/public', 'npm-packages'],
  ])('%s is in the %s view', (p, view) => {
    expect(viewOfPath(p, dirs)).toBe(view);
  });

  it('works with the relative dev paths, where one dir name prefixes another', () => {
    const dev = { ...dirs, filesDir: '../data/data/files', privateFilesDir: '../data/data/files-private' };
    expect(viewOfPath('../data/data/files-private/a', dev)).toBe('private-files');
    expect(viewOfPath('../data/data/files/a', dev)).toBe('public-files');
  });
});

describe('fileUrl (r2-files-9, r2-files-10)', () => {
  it('encodes every path segment', () => {
    expect(encodePathSegments('a b/hash#1.txt')).toBe('a%20b/hash%231.txt');
    expect(fileUrl('/var/www/files/names/r2-files-hash#1.txt', dirs, hosts)).toBe(
      'http://files.mirror.intra/downloads/names/r2-files-hash%231.txt',
    );
    expect(fileUrl('/var/www/files/r2-files-50%off.txt', dirs, hosts)).toBe(
      'http://files.mirror.intra/downloads/r2-files-50%25off.txt',
    );
    expect(fileUrl('/var/www/files/q?.txt', dirs, hosts)).toBe('http://files.mirror.intra/downloads/q%3F.txt');
  });

  it('links private files through the admin route', () => {
    expect(fileUrl('/var/www/files-private/a#b.txt', dirs, hosts)).toBe(
      '/api/download-private?path=%2Fvar%2Fwww%2Ffiles-private%2Fa%23b.txt',
    );
  });

  it('links mirror files to the mirror host', () => {
    expect(fileUrl('/var/spool/apt-mirror/mirror/deb.debian.org/debian/dists/Release', dirs, hosts)).toBe(
      'http://mirror.intra/deb.debian.org/debian/dists/Release',
    );
  });

  it('has no link for files no host serves', () => {
    expect(fileUrl('/var/spool/apt-mirror/gpg/keys.json', dirs, hosts)).toBeNull();
    expect(fileUrl('/var/www/npm/public/accepts', dirs, hosts)).toBeNull();
    expect(fileUrl('/etc/passwd', dirs, hosts)).toBeNull();
  });
});

describe('canDelete (r3-files-4)', () => {
  it('offers deletion in the mirror dir only inside the published tree', () => {
    for (const p of ['/var/spool/apt-mirror/gpg', '/var/spool/apt-mirror/gpg/keys.json', '/var/spool/apt-mirror/mirror', '/var/spool/apt-mirror/skel', '/var/spool/apt-mirror/var']) {
      expect(canDelete(p, dirs)).toBe(false);
    }
    expect(canDelete('/var/spool/apt-mirror/mirror/deb.debian.org', dirs)).toBe(true);
    expect(canDelete('/var/www/files/a', dirs)).toBe(true);
    expect(canDelete('/var/www/npm/public', dirs)).toBe(true);
  });
});
