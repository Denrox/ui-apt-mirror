import { describe, expect, it } from 'vitest';
import { sharedFilterWarning, sourceFilterWarning, type NewRepoValues } from './add-repo-modal';

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

describe('sharedFilterWarning for base URLs that share a mirror folder', () => {
  it('warns about https next to the same http upstream, filtered or not', () => {
    expect(sharedFilterWarning(values({ baseUrl: 'https://deb.debian.org/debian' }), upstreams)).toMatch(
      /same mirror folder under the base URL http:\/\/deb\.debian\.org\/debian.*use http:\/\/deb\.debian\.org\/debian here/,
    );
    expect(
      sharedFilterWarning(values({ baseUrl: 'https://deb.debian.org/debian', includeBinaryPackages: 'sl' }), upstreams),
    ).toMatch(/delete each other's files/);
  });
  it('warns about a nested folder', () => {
    expect(sharedFilterWarning(values({ baseUrl: 'http://deb.debian.org/debian/sub' }), upstreams)).toMatch(
      /mirror them under one base URL/,
    );
  });
  it('is quiet for another spelling of the same base URL', () => {
    expect(sharedFilterWarning(values({ baseUrl: 'HTTP://deb.debian.org:80/debian/', includeBinaryPackages: 'x' }), upstreams)).toBeNull();
  });
});

describe('sharedFilterWarning for two filtered repositories', () => {
  const filteredUpstreams = [
    { url: 'http://deb.debian.org/debian', title: 'Hello', filtered: true, filters: { include_binary_packages: ['hello'] } },
  ];
  it('warns when the filters are of different kinds', () => {
    expect(sharedFilterWarning(values({ includeSourceName: 'hello' }), filteredUpstreams)).toMatch(
      /"Hello" uses the same upstream with other kinds of package filters/,
    );
  });
  it('is quiet when only the include list differs', () => {
    expect(sharedFilterWarning(values({ includeBinaryPackages: 'sl' }), filteredUpstreams)).toBeNull();
  });
});

describe('sourceFilterWarning', () => {
  it('warns about source packages with a binary package filter', () => {
    expect(sourceFilterWarning(values({ includeSrc: true, includeBinaryPackages: 'hello' }))).toMatch(
      /every source package of the upstream/,
    );
    expect(sourceFilterWarning(values({ includeSrc: true, excludeBinaryPackages: 'hello' }))).not.toBeNull();
  });
  it('is quiet without deb-src or with a source name filter', () => {
    expect(sourceFilterWarning(values({ includeBinaryPackages: 'hello' }))).toBeNull();
    expect(sourceFilterWarning(values({ includeSrc: true, includeSourceName: 'hello' }))).toBeNull();
  });
});
