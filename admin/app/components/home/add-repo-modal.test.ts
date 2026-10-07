import { describe, expect, it } from 'vitest';
import { sharedFilterWarning, type NewRepoValues } from './add-repo-modal';

const values = (over: Partial<NewRepoValues> = {}): NewRepoValues => ({
  title: 'Updates',
  description: '',
  baseUrl: 'http://DEB.debian.org/debian/',
  suites: 'trixie-updates',
  components: 'main',
  includeSrc: false,
  trusted: false,
  arches: '',
  includeSourceName: '',
  includeBinaryPackages: '',
  excludeBinaryPackages: '',
  includeSections: '',
  ...over,
});
const upstreams = [
  { url: 'http://deb.debian.org/debian', title: 'Hello', filtered: true },
  { url: 'http://archive.ubuntu.com/ubuntu', title: 'Ubuntu', filtered: false },
];

describe('sharedFilterWarning (r3-repos-3)', () => {
  it('warns about an unfiltered repository on a filtered upstream', () => {
    expect(sharedFilterWarning(values(), upstreams)).toMatch(/only get the packages "Hello" selects/);
  });
  it('warns about a filter on an upstream an unfiltered repository uses', () => {
    const v = values({ baseUrl: 'http://archive.ubuntu.com/ubuntu', includeBinaryPackages: 'sl' });
    expect(sharedFilterWarning(v, upstreams)).toMatch(/would restrict "Ubuntu" too/);
  });
  it('is quiet when both are filtered, for other upstreams, and for the edited repository itself', () => {
    expect(sharedFilterWarning(values({ includeBinaryPackages: 'sl' }), upstreams)).toBeNull();
    expect(sharedFilterWarning(values({ arches: 'amd64', baseUrl: 'http://other.org/x' }), upstreams)).toBeNull();
    expect(sharedFilterWarning(values({ title: 'Hello' }), upstreams, 'Hello')).toBeNull();
  });
  it('does not count architectures as a package filter', () => {
    expect(sharedFilterWarning(values({ arches: 'amd64' }), upstreams)).toMatch(/"Hello"/);
  });
});
