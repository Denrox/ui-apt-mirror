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
    ['description (U+2028 line separator)', { description: 'x\u2028deb http://evil/ trixie main' }],
    ['description (U+2029 paragraph separator)', { description: 'x\u2029y' }],
    ['title (U+2028 line separator)', { title: 'Repo\u2028x' }],
    ['base URL (U+0085 next line)', { baseUrl: 'http://deb.debian.org/debian\u0085' }],
    ['filter value (U+2029)', { filters: { include_binary_packages: ['pkg\u2029x'] } }],
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

  it.each([
    ['suite', { suites: ['../../etc'] }],
    ['component', { components: ['main/..'] }],
    ['architecture', { arches: ['amd64]'] }],
  ])('rejects a path escape or bracket in a %s', (_name, change) => {
    expect(validateRepositoryInput({ ...valid, ...change }, [])).not.toBeNull();
  });

  it.each([
    ['fragment', 'http://example.com/debian#frag'],
    ['query', 'http://example.com/debian?x=1'],
  ])('rejects a base URL with a %s', (_name, baseUrl) => {
    expect(validateRepositoryInput({ ...valid, baseUrl }, [])).toMatch(/query or fragment/);
  });

  it('rejects a title that differs from an existing one only in case', () => {
    expect(validateRepositoryInput(valid, ['trixie updates'])).toMatch(/already exists/);
  });

  it('caps the description length', () => {
    expect(validateRepositoryInput({ ...valid, description: 'x'.repeat(501) }, [])).toMatch(/too long/);
    expect(validateRepositoryInput({ ...valid, description: 'x'.repeat(500) }, [])).toBeNull();
  });

  it('accepts flat-repository and nested component paths', () => {
    expect(validateRepositoryInput({ ...valid, suites: ['./'], components: ['main/debian-installer'] }, [])).toBeNull();
  });
});
