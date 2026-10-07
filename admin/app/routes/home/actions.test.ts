import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MirrorConfig } from '~/utils/mirror-config';

const state = vi.hoisted(() => ({ dir: '', syncRunning: false }));

vi.mock('~/config/config.json', () => ({
  default: {
    get mirrorListPath() {
      return `${state.dir}/mirror.list`;
    },
    get gpgKeysIndex() {
      return `${state.dir}/keys.json`;
    },
    get mirrorRoot() {
      return `${state.dir}/mirror`;
    },
    hosts: [{ id: 'mirror', address: 'mirror.intra' }],
  },
}));
vi.mock('~/utils/auth-middleware', () => ({ requireAuthMiddleware: async () => undefined }));
vi.mock('~/utils/sync', () => ({ checkLockFile: async () => state.syncRunning }));

const { action } = await import('./actions');

const MULTI = [
  '# ---start---Debian Trixie---',
  '## Debian 13',
  '#deb http://deb.debian.org/debian trixie main',
  '#deb http://security.debian.org/debian-security trixie-security main',
  '# Usage start',
  '#Types: deb',
  '# Usage end',
  '# ---end---Debian Trixie---',
];
const SIMPLE = (enabled: boolean) => [
  '# ---start---Simple---',
  '## A simple one',
  `${enabled ? '' : '#'}deb http://example.com/debian stable main`,
  '# ---end---Simple---',
];

function writeList(...sections: string[][]) {
  const body = [...sections.flatMap((s) => [...s, '']), 'clean http://example.com/debian', ''].join('\n');
  fs.writeFileSync(`${state.dir}/mirror.list`, body);
}
const readList = () => fs.readFileSync(`${state.dir}/mirror.list`, 'utf-8');
function revisionOf(title: string): string {
  const config = MirrorConfig.parse(readList());
  return config.sectionRevision(config.getSection(title)!);
}

async function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return (await action({ request: new Request('http://admin/home.data', { method: 'POST', body }) })) as {
    success?: boolean;
    error?: string;
    message?: string;
  };
}

const editFields = (originalTitle: string, revision?: string) => ({
  action: 'editRepository',
  originalTitle,
  ...(revision ? { revision } : {}),
  title: originalTitle,
  description: 'edited',
  baseUrl: 'http://example.com/debian',
  suites: 'stable',
  components: 'main',
});

beforeEach(() => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uam-actions-'));
  state.syncRunning = false;
});
afterEach(() => fs.rmSync(state.dir, { recursive: true, force: true }));

describe('editRepository guards', () => {
  it('refuses a section the form cannot represent and leaves the file alone', async () => {
    writeList(MULTI);
    const before = readList();
    const result = await post({ ...editFields('Debian Trixie', revisionOf('Debian Trixie')) });
    expect(result.error).toMatch(/cannot be edited/);
    expect(readList()).toBe(before);
  });

  it('keeps a disabled section disabled', async () => {
    writeList(SIMPLE(false));
    const result = await post(editFields('Simple', revisionOf('Simple')));
    expect(result.success).toBe(true);
    const config = MirrorConfig.parse(readList());
    const section = config.getSection('Simple')!;
    expect(config.isSectionEnabled(section)).toBe(false);
    expect(readList()).toContain('## edited');
  });

  it('keeps an enabled section enabled', async () => {
    writeList(SIMPLE(true));
    expect((await post(editFields('Simple', revisionOf('Simple')))).success).toBe(true);
    const config = MirrorConfig.parse(readList());
    expect(config.isSectionEnabled(config.getSection('Simple')!)).toBe(true);
  });
});

describe('revision is required for changes to an existing section', () => {
  it.each([
    ['editRepository', (rev?: string) => editFields('Simple', rev)],
    ['deleteRepository', (rev?: string) => ({ action: 'deleteRepository', sectionTitle: 'Simple', ...(rev ? { revision: rev } : {}) })],
    ['removeRepository', (rev?: string) => ({ action: 'removeRepository', sectionTitle: 'Simple', ...(rev ? { revision: rev } : {}) })],
  ])('%s without a revision is refused', async (_name, fields) => {
    writeList(SIMPLE(true));
    const before = readList();
    expect((await post(fields())).error).toMatch(/Reload the page/);
    expect(readList()).toBe(before);
    expect((await post(fields(revisionOf('Simple')))).success).toBe(true);
  });
});

describe('changes while a sync runs', () => {
  it.each(['addRepository', 'editRepository', 'removeRepository', 'deleteRepository', 'restoreRepository'])(
    '%s is refused',
    async (name) => {
      writeList(SIMPLE(true));
      state.syncRunning = true;
      const before = readList();
      const result = await post({ ...editFields('Simple', revisionOf('Simple')), action: name, sectionTitle: 'Simple' });
      expect(result.error).toMatch(/sync is running/);
      expect(readList()).toBe(before);
    },
  );
});

describe('deleteGpgKey', () => {
  it('says there is no key instead of claiming it deleted one', async () => {
    const result = await post({ action: 'deleteGpgKey', host: 'nokey.example.com' });
    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(/no signing key for nokey\.example\.com/);
  });
});

describe('removeRepository with deleteData', () => {
  const OTHER = [
    '# ---start---Other---',
    'deb http://example.com/debian testing main',
    '# ---end---Other---',
  ];
  function seedData() {
    for (const root of ['mirror', 'skel']) {
      fs.mkdirSync(`${state.dir}/${root}/example.com/debian/dists/stable`, { recursive: true });
      fs.writeFileSync(`${state.dir}/${root}/example.com/debian/dists/stable/Release`, 'x');
      fs.mkdirSync(`${state.dir}/${root}/keep.org/debian`, { recursive: true });
    }
  }
  const remove = (deleteData: boolean) =>
    post({ action: 'removeRepository', sectionTitle: 'Simple', revision: revisionOf('Simple'), ...(deleteData ? { deleteData: 'true' } : {}) });

  it('keeps the files unless asked', async () => {
    writeList(SIMPLE(true));
    seedData();
    expect((await remove(false)).success).toBe(true);
    expect(fs.existsSync(`${state.dir}/mirror/example.com/debian`)).toBe(true);
  });

  it('deletes the mirrored and skel files of an upstream nothing else uses', async () => {
    writeList(SIMPLE(true));
    seedData();
    const result = await remove(true);
    expect(result.message).toMatch(/mirrored files deleted/);
    for (const root of ['mirror', 'skel']) {
      expect(fs.existsSync(`${state.dir}/${root}/example.com`)).toBe(false);
      expect(fs.existsSync(`${state.dir}/${root}/keep.org/debian`)).toBe(true);
    }
  });

  it('keeps files another enabled repository still uses', async () => {
    writeList(SIMPLE(true), OTHER);
    seedData();
    const result = await remove(true);
    expect(result.message).toMatch(/kept because another enabled repository/);
    expect(fs.existsSync(`${state.dir}/mirror/example.com/debian/dists/stable/Release`)).toBe(true);
  });
});

describe('package filters shared through one upstream (r3-repos-3)', () => {
  const FILTERED = (enabled: boolean) => [
    '# ---start---Hello---',
    `${enabled ? '' : '#'}deb http://example.com/debian stable main`,
    `${enabled ? '' : '#'}include_binary_packages http://example.com/debian hello`,
    '# ---end---Hello---',
  ];
  const addFields = (over: Record<string, string> = {}) => ({
    action: 'addRepository',
    title: 'Updates',
    baseUrl: 'http://example.com/debian/',
    suites: 'stable-updates',
    components: 'main',
    ...over,
  });

  it('refuses an unfiltered repository on a filtered upstream', async () => {
    writeList(FILTERED(true));
    const result = await post(addFields());
    expect(result.error).toMatch(/"Updates" has no package filter but shares its upstream with "Hello"/);
    expect(readList()).not.toContain('Updates');
  });

  it('refuses a filtered repository on an upstream an unfiltered one uses', async () => {
    writeList(SIMPLE(true));
    const result = await post(addFields({ includeBinaryPackages: 'sl' }));
    expect(result.error).toMatch(/"Simple" has no package filter but shares its upstream with "Updates"/);
  });

  it('accepts it next to a disabled filtered repository, or on another upstream', async () => {
    writeList(FILTERED(false));
    expect((await post(addFields())).success).toBe(true);
    expect((await post(addFields({ title: 'Other', baseUrl: 'http://other.example.com/debian' }))).success).toBe(true);
  });

  it('accepts two filtered repositories on one upstream', async () => {
    writeList(FILTERED(true));
    expect((await post(addFields({ includeBinaryPackages: 'sl' }))).success).toBe(true);
  });

  it('refuses a second filtered repository whose filter is of another kind', async () => {
    writeList(FILTERED(true));
    const result = await post(addFields({ includeSourceName: 'hello' }));
    expect(result.error).toMatch(/filters of "Updates" and "Hello" \(same upstream\) do not add up/);
    expect(readList()).not.toContain('Updates');
  });

  it('refuses to enable a repository into such a clash', async () => {
    writeList(SIMPLE(true), FILTERED(false));
    const result = await post({ action: 'restoreRepository', sectionTitle: 'Hello', revision: revisionOf('Hello') });
    expect(result.error).toMatch(/shares its upstream/);
    const config = MirrorConfig.parse(readList());
    expect(config.isSectionEnabled(config.getSection('Hello')!)).toBe(false);
  });

  it('refuses an edit that removes the filter of one of two filtered repositories', async () => {
    writeList(FILTERED(true));
    await post(addFields({ includeBinaryPackages: 'sl' }));
    const result = await post({
      ...editFields('Updates', revisionOf('Updates')),
      suites: 'stable-updates',
      includeBinaryPackages: '',
    });
    expect(result.error).toMatch(/"Updates" has no package filter/);
  });
});

describe('base URLs that share a mirror folder', () => {
  it('refuses an https repository next to the same http upstream', async () => {
    writeList(SIMPLE(true));
    const result = await post({
      action: 'addRepository',
      title: 'Secure',
      baseUrl: 'https://example.com/debian',
      suites: 'testing',
      components: 'main',
    });
    expect(result.error).toMatch(/same mirror folder \(example\.com\/debian\).*Use the base URL http:\/\/example\.com\/debian/);
    expect(readList()).not.toContain('Secure');
  });

  it('refuses to enable a repository into such a clash, and accepts the same spelling', async () => {
    writeList(SIMPLE(false), [
      '# ---start---Secure---',
      'deb https://example.com/debian testing main',
      '# ---end---Secure---',
    ]);
    const result = await post({ action: 'restoreRepository', sectionTitle: 'Simple', revision: revisionOf('Simple') });
    expect(result.error).toMatch(/same mirror folder/);
    const ok = await post({
      action: 'addRepository',
      title: 'Backports',
      baseUrl: 'HTTPS://Example.com:443/debian/',
      suites: 'testing-backports',
      components: 'main',
    });
    expect(ok.success).toBe(true);
  });
});

describe('disabling a repository with deleteData', () => {
  const OTHER = (enabled: boolean) => [
    '# ---start---Other---',
    `${enabled ? '' : '#'}deb http://example.com/debian testing main`,
    '# ---end---Other---',
  ];
  function seedData() {
    for (const root of ['mirror', 'skel']) {
      fs.mkdirSync(`${state.dir}/${root}/example.com/debian/dists/stable`, { recursive: true });
      fs.writeFileSync(`${state.dir}/${root}/example.com/debian/dists/stable/Release`, 'x');
      fs.mkdirSync(`${state.dir}/${root}/keep.org/debian`, { recursive: true });
    }
  }
  const disable = (deleteData: boolean) =>
    post({
      action: 'deleteRepository',
      sectionTitle: 'Simple',
      revision: revisionOf('Simple'),
      ...(deleteData ? { deleteData: 'true' } : {}),
    });
  const isEnabled = (title: string) => {
    const config = MirrorConfig.parse(readList());
    return config.isSectionEnabled(config.getSection(title)!);
  };

  it('keeps the files by default', async () => {
    writeList(SIMPLE(true));
    seedData();
    const result = await disable(false);
    expect(result.message).toMatch(/disabled successfully/);
    expect(isEnabled('Simple')).toBe(false);
    expect(fs.existsSync(`${state.dir}/mirror/example.com/debian/dists/stable/Release`)).toBe(true);
  });

  it('deletes the mirrored and skel files of an upstream nothing else enabled uses', async () => {
    writeList(SIMPLE(true), OTHER(false));
    seedData();
    const result = await disable(true);
    expect(result.message).toMatch(/disabled and its mirrored files deleted/);
    expect(isEnabled('Simple')).toBe(false);
    expect(readList()).toContain('Simple');
    for (const root of ['mirror', 'skel']) {
      expect(fs.existsSync(`${state.dir}/${root}/example.com`)).toBe(false);
      expect(fs.existsSync(`${state.dir}/${root}/keep.org/debian`)).toBe(true);
    }
  });

  it('keeps files another enabled repository still uses', async () => {
    writeList(SIMPLE(true), OTHER(true));
    seedData();
    const result = await disable(true);
    expect(result.message).toMatch(/kept because another enabled repository/);
    expect(isEnabled('Simple')).toBe(false);
    expect(fs.existsSync(`${state.dir}/mirror/example.com/debian/dists/stable/Release`)).toBe(true);
  });

  it('never deletes anything when enabling', async () => {
    writeList(SIMPLE(false));
    seedData();
    const result = await post({
      action: 'restoreRepository',
      sectionTitle: 'Simple',
      revision: revisionOf('Simple'),
      deleteData: 'true',
    });
    expect(result.message).toMatch(/enabled successfully/);
    expect(fs.existsSync(`${state.dir}/mirror/example.com/debian/dists/stable/Release`)).toBe(true);
  });

  it('is refused while a sync runs, like every repository change', async () => {
    writeList(SIMPLE(true));
    seedData();
    state.syncRunning = true;
    expect((await disable(true)).error).toMatch(/sync is running/);
    expect(fs.existsSync(`${state.dir}/mirror/example.com/debian`)).toBe(true);
  });
});
