import { describe, it, expect } from 'vitest';
import {
  applyDocUpdate,
  auditPackageNames,
  isFresh,
  isRegistryRequest,
  isValidDistTag,
  isValidVersion,
  isWebLoginPath,
  mergePublish,
  nextRev,
  packageScope,
  parseJsonObject,
  parseNpmPath,
  pathPackage,
  privateVersion,
  publicCachePath,
  revMatches,
  scopeListsPackage,
  upstreamHeaders,
  withoutAuditPackages,
  type PackageDoc,
} from './npm-registry';

const NOW = '2026-10-06T12:00:00.000Z';

function publishBody(name: string, version: string, tags?: Record<string, string>) {
  return {
    name,
    versions: { [version]: { name, version, dist: { shasum: version } } },
    'dist-tags': tags ?? { latest: version },
    _attachments: { [`${name}-${version}.tgz`]: { data: 'eA==' } },
  };
}

function published(...versions: string[]): PackageDoc {
  let doc: PackageDoc | null = null;
  for (const v of versions) {
    const result = mergePublish(doc, publishBody('@acme/widget', v), 'alice', NOW);
    if ('status' in result) throw new Error(result.reason);
    doc = result.doc;
  }
  return doc!;
}

describe('parseNpmPath', () => {
  it('decodes scoped names', () => {
    expect(parseNpmPath('@acme%2fwidget')).toEqual({ kind: 'package', name: '@acme/widget' });
    expect(parseNpmPath('@acme%2Fwidget/-rev/3-abc')).toEqual({
      kind: 'package',
      name: '@acme/widget',
      rev: '3-abc',
    });
    expect(parseNpmPath('widget')).toEqual({ kind: 'package', name: 'widget' });
  });

  it('parses tarball paths, with and without a revision', () => {
    expect(parseNpmPath('widget/-/widget-1.0.0.tgz')).toEqual({
      kind: 'tarball',
      name: 'widget',
      file: 'widget-1.0.0.tgz',
    });
    expect(parseNpmPath('@acme/widget/-/@acme/widget-1.0.0.tgz/-rev/2-x')).toEqual({
      kind: 'tarball',
      name: '@acme/widget',
      file: '@acme/widget-1.0.0.tgz',
      rev: '2-x',
    });
  });

  it('parses dist-tag paths', () => {
    expect(parseNpmPath('-/package/@acme%2fwidget/dist-tags')).toEqual({
      kind: 'distTags',
      name: '@acme/widget',
      tag: undefined,
    });
    expect(parseNpmPath('-/package/widget/dist-tags/beta')).toEqual({
      kind: 'distTags',
      name: 'widget',
      tag: 'beta',
    });
  });

  it('leaves everything else alone', () => {
    for (const p of [
      '-/whoami',
      '-/npm/v1/security/advisories/bulk',
      'widget/1.0.0',
      'Widget',
      '..%2f..%2fetc',
      'widget/-/../../x',
      '@acme',
      '%E0%A4%A',
    ]) {
      expect(parseNpmPath(p)).toEqual({ kind: 'other' });
    }
  });
});

describe('mergePublish', () => {
  it('keeps earlier versions, tags and times', () => {
    const doc = published('1.0.0', '1.1.0');
    expect(Object.keys(doc.versions)).toEqual(['1.0.0', '1.1.0']);
    expect(doc['dist-tags']).toEqual({ latest: '1.1.0' });
    expect(doc.time).toMatchObject({ '1.0.0': NOW, '1.1.0': NOW, created: NOW, modified: NOW });
    expect(doc._rev).toMatch(/^2-/);
  });

  it('adds a tag without moving latest', () => {
    const result = mergePublish(published('1.0.0'), publishBody('@acme/widget', '2.0.0-rc.1', { next: '2.0.0-rc.1' }), 'bob');
    if ('status' in result) throw new Error(result.reason);
    expect(result.doc['dist-tags']).toEqual({ latest: '1.0.0', next: '2.0.0-rc.1' });
    expect(result.doc._publishedBy).toBe('bob');
  });

  it('refuses to publish over an existing version', () => {
    const result = mergePublish(published('1.0.0'), publishBody('@acme/widget', '1.0.0'), 'alice');
    expect(result).toMatchObject({ status: 403 });
  });

  it('refuses versions that are not semver', () => {
    for (const v of ['..', '.', '1', '1.0', 'v1.0.0', '01.0.0', '1.0.0-', '1.0.0+', 'latest', '1.0.0-a..b', `1.0.0-${'a'.repeat(260)}`]) {
      const result = mergePublish(null, publishBody('@acme/widget', v), 'alice', NOW);
      expect(result, v).toMatchObject({ status: 400 });
      expect(isValidVersion(v), v).toBe(false);
    }
    for (const v of ['0.0.0', '1.2.3', '1.0.0-beta.1', '1.0.0-0.3.7', '1.0.0-x-y.z', '1.0.0+build.5', '99.0.0-r2']) {
      expect(isValidVersion(v), v).toBe(true);
    }
  });

  it('refuses dist-tags that do not name a valid tag and a published version', () => {
    const bad: Record<string, unknown>[] = [{ latest: '..' }, { latest: '2.0.0' }, { 'v1': '1.0.0' }, { latest: 1 }, { 'a/b': '1.0.0' }];
    for (const tags of bad) {
      const body = publishBody('@acme/widget', '1.0.0', tags as Record<string, string>);
      expect(mergePublish(null, body, 'alice', NOW), JSON.stringify(tags)).toMatchObject({ status: 400 });
    }
    const body = { ...publishBody('@acme/widget', '1.1.0'), 'dist-tags': 'latest' };
    expect(mergePublish(published('1.0.0'), body, 'alice', NOW)).toMatchObject({ status: 400 });
    // A tag may point at a version published earlier.
    expect(
      mergePublish(published('1.0.0'), publishBody('@acme/widget', '1.1.0', { latest: '1.1.0', old: '1.0.0' }), 'alice', NOW),
    ).toHaveProperty('doc');
  });

  it('refuses an empty publish', () => {
    expect(mergePublish(null, { name: 'x', versions: {} }, 'alice')).toMatchObject({ status: 400 });
  });
});

describe('applyDocUpdate', () => {
  it('removes a version and its tags and times', () => {
    const doc = published('1.0.0', '1.1.0');
    doc['dist-tags'].old = '1.1.0';
    const incoming = structuredClone(doc);
    delete incoming.versions['1.1.0'];
    incoming['dist-tags'] = { latest: '1.0.0', old: '1.1.0' };

    const result = applyDocUpdate(doc, incoming, 'later');
    if ('status' in result) throw new Error(result.reason);
    expect(Object.keys(result.doc.versions)).toEqual(['1.0.0']);
    expect(result.doc['dist-tags']).toEqual({ latest: '1.0.0' });
    expect(result.doc.time).toEqual({ '1.0.0': NOW, created: NOW, modified: 'later' });
  });

  it('takes over only the deprecation message of a version', () => {
    const doc = published('1.0.0');
    const incoming = structuredClone(doc);
    incoming.versions['1.0.0'].deprecated = 'use 2.x';
    incoming.versions['1.0.0'].dist = { tarball: 'http://evil/x.tgz' };

    const result = applyDocUpdate(doc, incoming);
    if ('status' in result) throw new Error(result.reason);
    expect(result.doc.versions['1.0.0'].deprecated).toBe('use 2.x');
    expect(result.doc.versions['1.0.0'].dist).toEqual(doc.versions['1.0.0'].dist);

    incoming.versions['1.0.0'].deprecated = '';
    const undone = applyDocUpdate(result.doc, incoming);
    if ('status' in undone) throw new Error(undone.reason);
    expect(undone.doc.versions['1.0.0']).not.toHaveProperty('deprecated');
  });

  it('rejects new versions and removing every version', () => {
    const doc = published('1.0.0');
    expect(applyDocUpdate(doc, { versions: { ...doc.versions, '9.9.9': {} } })).toMatchObject({ status: 400 });
    expect(applyDocUpdate(doc, { versions: {} })).toMatchObject({ status: 400 });
  });
});

describe('revisions', () => {
  it('increments and checks the current revision', () => {
    expect(nextRev()).toMatch(/^1-[0-9a-f]{16}$/);
    expect(nextRev('7-abc')).toMatch(/^8-/);
    const doc = published('1.0.0');
    expect(revMatches(doc, undefined)).toBe(true);
    expect(revMatches(doc, doc._rev)).toBe(true);
    expect(revMatches(doc, '1-stale')).toBe(false);
  });
});

describe('isValidDistTag', () => {
  it('rejects tags that look like versions', () => {
    expect(isValidDistTag('beta')).toBe(true);
    expect(isValidDistTag('lts-2026')).toBe(true);
    expect(isValidDistTag('1.0.0')).toBe(false);
    expect(isValidDistTag('v2')).toBe(false);
    expect(isValidDistTag('a/b')).toBe(false);
  });
});

describe('isFresh', () => {
  it('expires cached metadata after the TTL', () => {
    const now = Date.parse(NOW);
    expect(isFresh('2026-10-06T11:55:00.000Z', now)).toBe(true);
    expect(isFresh('2026-10-06T11:45:00.000Z', now)).toBe(false);
    expect(isFresh('2026-10-06T13:00:00.000Z', now)).toBe(false);
    expect(isFresh(undefined, now)).toBe(false);
    expect(isFresh('garbage', now)).toBe(false);
  });
});

describe('isRegistryRequest', () => {
  it('serves only the npm host, and only when enabled', () => {
    expect(isRegistryRequest('npm.mirror.intra', 'true')).toBe(true);
    expect(isRegistryRequest('NPM.example.org:8080', 'true')).toBe(true);
    expect(isRegistryRequest('admin.mirror.intra', 'true')).toBe(false);
    expect(isRegistryRequest('mirror.intra', 'true')).toBe(false);
    expect(isRegistryRequest(null, 'true')).toBe(false);
    expect(isRegistryRequest('npm.mirror.intra', 'false')).toBe(false);
    expect(isRegistryRequest('npm.mirror.intra', undefined)).toBe(false);
  });
});

describe('upstreamHeaders', () => {
  it('never forwards the client\'s credentials', () => {
    const original = {
      authorization: 'Bearer local-token',
      'x-npm-auth-token': 't',
      'x-npm-session': 's',
      cookie: 'c=1',
      'if-none-match': '"etag"',
      range: 'bytes=0-1',
    };
    const headers = upstreamHeaders(original, [...Object.keys(original), 'if-modified-since'], {
      Accept: '*/*',
    });
    expect(headers).toEqual({
      'User-Agent': 'npm-cache-proxy/1.0',
      Accept: '*/*',
      'if-none-match': '"etag"',
      range: 'bytes=0-1',
    });
  });
});

describe('audit payloads', () => {
  const drop = new Set(['@acme/widget', 'acme-app']);

  it('drops private packages from a bulk audit', () => {
    const bulk = { '@acme/widget': ['1.0.0'], lodash: ['4.17.20'] };
    expect(auditPackageNames(bulk, true)).toEqual(['@acme/widget', 'lodash']);
    expect(withoutAuditPackages(bulk, true, drop)).toEqual({ lodash: ['4.17.20'] });
  });

  it('drops private packages from every level of a quick audit tree', () => {
    const quick = {
      name: 'acme-app',
      version: '1.0.0',
      install: ['@acme/widget', 'lodash'],
      remove: [],
      requires: { '@acme/widget': '^1.0.0', express: '^4.0.0' },
      dependencies: {
        '@acme/widget': { version: '1.0.0', requires: { lodash: '^4.0.0' } },
        express: {
          version: '4.21.0',
          requires: { '@acme/widget': '^1.0.0' },
          dependencies: { '@acme/widget': { version: '1.0.1' }, debug: { version: '2.6.9' } },
        },
        lodash: { version: '4.17.20' },
      },
    };
    expect(auditPackageNames(quick, false).sort()).toEqual(
      ['@acme/widget', 'acme-app', 'debug', 'express', 'lodash'],
    );
    const sent = withoutAuditPackages(quick, false, drop);
    expect(sent).toEqual({
      install: ['lodash'],
      remove: [],
      requires: { express: '^4.0.0' },
      dependencies: {
        express: { version: '4.21.0', requires: {}, dependencies: { debug: { version: '2.6.9' } } },
        lodash: { version: '4.17.20' },
      },
    });
    expect(JSON.stringify(sent)).not.toMatch(/acme/);
  });

  it('ignores payloads that are not objects', () => {
    expect(auditPackageNames(null, true)).toEqual([]);
    expect(auditPackageNames(['x'], false)).toEqual([]);
  });
});

describe('publicCachePath', () => {
  it('caches each package in a directory of its own', () => {
    expect(publicCachePath(parseNpmPath('left-pad'))).toBe('_packages/left-pad/package.json');
    expect(publicCachePath(parseNpmPath('@babel%2fcore'))).toBe('_packages/@babel/core/package.json');
    expect(publicCachePath(parseNpmPath('left-pad/-/left-pad-1.3.0.tgz'))).toBe(
      '_packages/left-pad/-/left-pad-1.3.0.tgz',
    );
    expect(publicCachePath(parseNpmPath('@babel/core/-/core-7.0.0.tgz'))).toBe(
      '_packages/@babel/core/-/core-7.0.0.tgz',
    );
  });

  it('gives names that could collide (x.meta, x-tarballs) paths that do not overlap', () => {
    const names = ['x', 'x.meta', 'x-tarballs', '@s/y', '@s-tarballs/y', '@s/y.meta'];
    const files = names.flatMap((n) => [
      publicCachePath(parseNpmPath(n))!,
      publicCachePath(parseNpmPath(`${n}/-/${n.split('/').pop()}-1.0.0.tgz`))!,
    ]);
    const all = files.flatMap((f) => [f, `${f}.meta`]);
    expect(new Set(all).size).toBe(all.length);
    for (const a of all) for (const b of all) expect(b.startsWith(`${a}/`), `${a} / ${b}`).toBe(false);
  });

  it('caches only .tgz tarballs, so none can be named like a .meta file', () => {
    expect(publicCachePath(parseNpmPath('x/-/x-1.0.0.tgz.meta'))).toBeNull();
    expect(publicCachePath(parseNpmPath('x/-/sub/x-1.0.0.tgz'))).toBeNull();
  });

  it('does not cache paths that would collide with a packument or depend on the query', () => {
    for (const p of ['left-pad/latest', 'left-pad/1.3.0', '-/v1/search', '-/package/left-pad/dist-tags', 'left-pad/-rev/1-a']) {
      expect(publicCachePath(parseNpmPath(p))).toBeNull();
    }
  });
});

describe('parseJsonObject', () => {
  it('accepts only JSON objects', () => {
    expect(parseJsonObject('{"name":"x"}')).toEqual({ name: 'x' });
    for (const text of ['not json', '', 'null', '[]', '"x"', '1']) expect(parseJsonObject(text)).toBeNull();
  });
});

describe('private package routing', () => {
  it('finds the package any path is about', () => {
    expect(pathPackage('@acme%2fwidget/1.0.0')).toEqual({ name: '@acme/widget', rest: ['1.0.0'] });
    expect(pathPackage('@acme/widget/latest')).toEqual({ name: '@acme/widget', rest: ['latest'] });
    expect(pathPackage('widget')).toEqual({ name: 'widget', rest: [] });
    expect(pathPackage('widget/-/widget-1.0.0.tgz')?.name).toBe('widget');
    expect(pathPackage('-/package/@acme%2fwidget/dist-tags/beta')).toEqual({
      name: '@acme/widget',
      rest: ['dist-tags', 'beta'],
    });
    expect(pathPackage('-/package/widget/collaborators')?.name).toBe('widget');
    for (const p of ['-/v1/search', '-/npm/v1/security/advisories/bulk', '-/whoami', '-/v1/login', '@acme', '%E0%A4%A']) {
      expect(pathPackage(p)).toBeNull();
    }
  });

  it('serves a private version by number or dist-tag', () => {
    const doc = published('1.0.0', '1.1.0');
    doc['dist-tags'].beta = '1.0.0';
    expect(privateVersion(doc, '1.1.0')?.version).toBe('1.1.0');
    expect(privateVersion(doc, 'latest')?.version).toBe('1.1.0');
    expect(privateVersion(doc, 'beta')?.version).toBe('1.0.0');
    expect(privateVersion(doc, '2.0.0')).toBeNull();
    expect(privateVersion(doc, 'constructor')).toBeNull();
  });

  it('recognizes web login paths', () => {
    expect(isWebLoginPath('-/v1/login')).toBe(true);
    expect(isWebLoginPath('-/v1/done')).toBe(true);
    expect(isWebLoginPath('-/v1/done/abc')).toBe(true);
    expect(isWebLoginPath('-/v1/search')).toBe(false);
    expect(isWebLoginPath('-/v1/loginx')).toBe(false);
  });
});

describe('scoped public names', () => {
  it('takes the scope from a scoped name only', () => {
    expect(packageScope('@types/node')).toBe('types');
    expect(packageScope('@sindresorhus/slugify')).toBe('sindresorhus');
    expect(packageScope('left-pad')).toBeNull();
  });

  it('looks a name up in the package list of its scope', () => {
    const list = { '@types/node': 'write', '@types/react': 'write', 'env-paths': 'write' };
    expect(scopeListsPackage(list, '@types/node')).toBe(true);
    expect(scopeListsPackage(list, '@types/not-there')).toBe(false);
    expect(scopeListsPackage(list, 'constructor')).toBe(false);
    for (const bad of [null, [], 'x', 1]) expect(scopeListsPackage(bad, '@types/node')).toBe(false);
  });
});
