import { describe, expect, it } from 'vitest';
import { configuredHosts, withMirrorHost } from './hosts';

describe('configuredHosts', () => {
  it('puts the install domain in place of mirror.intra', () => {
    const byId = Object.fromEntries(configuredHosts('uam.test').map((h) => [h.id, h.address]));
    expect(byId).toEqual({
      mirror: 'uam.test',
      admin: 'admin.uam.test',
      files: 'files.uam.test',
      npm: 'npm.uam.test',
      cheatsheets: 'cheatsheets.uam.test',
    });
  });

  it('keeps the built-in names by default', () => {
    expect(configuredHosts('mirror.intra').map((h) => h.address)).toContain('admin.mirror.intra');
  });
});

describe('withMirrorHost', () => {
  it('rewrites mirror.intra URLs only', () => {
    expect(
      withMirrorHost(
        ['deb http://mirror.intra/deb.debian.org/debian trixie main', 'URIs: http://mirror.intra:8080/x', 'deb http://admin.mirror.intra/x', 'http://mirror.intranet/x'],
        'uam.test',
      ),
    ).toEqual(['deb http://uam.test/deb.debian.org/debian trixie main', 'URIs: http://uam.test:8080/x', 'deb http://admin.mirror.intra/x', 'http://mirror.intranet/x']);
  });
});
