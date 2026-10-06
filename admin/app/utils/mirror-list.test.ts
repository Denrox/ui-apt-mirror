import { describe, it, expect } from 'vitest';
import { validateRepositoryInput } from './mirror-list';

const valid = {
  title: 'Trixie Updates',
  description: 'Debian 13 updates',
  baseUrl: 'http://deb.debian.org/debian',
  suites: ['trixie-updates'],
  components: ['main', 'non-free-firmware'],
  includeSrc: false,
  trusted: false,
  arches: ['amd64'],
  filters: { include_binary_packages: ['docker-ce*'] },
};

describe('validateRepositoryInput', () => {
  it('accepts a normal repository', () => {
    expect(validateRepositoryInput(valid, [])).toBeNull();
  });

  // Any of these would add lines to mirror.list, which apt-mirror runs as root.
  it.each([
    ['description', { description: 'ok\nset base_path /tmp' }],
    ['base URL', { baseUrl: 'http://example.com/debian\nset nthreads 99' }],
    ['base URL with a carriage return', { baseUrl: 'http://example.com/\rdeb http://x y z' }],
    ['title', { title: 'Repo\nclean http://x' }],
    ['filter value', { filters: { include_binary_packages: ['pkg\nset x y'] } }],
    ['other control characters', { description: 'bell\u0007' }],
  ])('rejects a line break or control character in the %s', (_name, change) => {
    expect(validateRepositoryInput({ ...valid, ...change }, [])).toMatch(/line breaks|control/);
  });

  it.each([
    ['suite', { suites: ['trixie;rm'] }],
    ['component', { components: ['main$(x)'] }],
    ['architecture', { arches: ['amd64 i386'] }],
  ])('rejects unusual characters in a %s', (_name, change) => {
    expect(validateRepositoryInput({ ...valid, ...change }, [])).not.toBeNull();
  });

  it('rejects spaces in the base URL', () => {
    expect(validateRepositoryInput({ ...valid, baseUrl: 'http://example.com/a b' }, [])).toMatch(/spaces/);
  });
});
