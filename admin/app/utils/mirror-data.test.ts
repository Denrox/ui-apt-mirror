import { describe, expect, it } from 'vitest';
import { MirrorConfig } from '~/utils/mirror-config';
import { mirrorDirOf, unusedMirrorDirs } from './mirror-data';

describe('mirrorDirOf', () => {
  it.each([
    ['http://deb.debian.org/debian', 'deb.debian.org/debian'],
    ['https://download.docker.com/linux/ubuntu/', 'download.docker.com/linux/ubuntu'],
    ['http://user:pw@host.example:8080/repo', 'host.example:8080/repo'],
    ['http://host.example', 'host.example'],
  ])('%s -> %s', (uri, dir) => expect(mirrorDirOf(uri)).toBe(dir));

  it.each(['ftp://x/y', 'http://x/../y', 'file:///etc', 'http://x/a?b'])('refuses %s', (uri) =>
    expect(mirrorDirOf(uri)).toBeNull(),
  );
});

describe('unusedMirrorDirs', () => {
  const config = MirrorConfig.parse(
    [
      'deb http://a.org/debian trixie main',
      '#deb http://disabled.org/debian trixie main',
      '# ---start---S---',
      'deb http://b.org/debian/nested trixie main',
      '# ---end---S---',
    ].join('\n'),
  );
  it('lists only folders no enabled deb line overlaps', () => {
    expect(
      unusedMirrorDirs(config, ['http://a.org/debian/', 'http://disabled.org/debian', 'http://b.org/debian', 'http://c.org/x']),
    ).toEqual(['disabled.org/debian', 'c.org/x']);
  });
});
