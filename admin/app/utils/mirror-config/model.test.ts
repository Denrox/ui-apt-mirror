import { describe, it, expect } from 'vitest';
import { MirrorConfig } from './model';
import type { RepositoryInput } from './types';

const BASE = `set base_path /var/spool/apt-mirror
set defaultarch amd64

# ---start---Ubuntu Noble---
# Ubuntu repos
deb http://archive.ubuntu.com/ubuntu noble main restricted
# Usage start
#Types: deb
#URIs: http://mirror.intra/archive.ubuntu.com/ubuntu
# Usage end
# ---end---Ubuntu Noble---

# Clean up old packages
clean http://archive.ubuntu.com/ubuntu
`;

const input = (over: Partial<RepositoryInput> = {}): RepositoryInput => ({
  title: 'Docker Ubuntu',
  description: 'Docker CE',
  baseUrl: 'https://download.docker.com/linux/ubuntu',
  suites: ['noble'],
  components: ['stable'],
  includeSrc: false,
  trusted: true,
  ...over,
});

describe('globals', () => {
  it('reads an existing global', () => {
    const cfg = MirrorConfig.parse(BASE);
    expect(cfg.getGlobal('defaultarch')).toBe('amd64');
  });

  it('updates an existing global without disturbing others', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.setGlobal('defaultarch', 'arm64');
    const out = cfg.serialize();
    expect(out).toContain('set defaultarch arm64');
    expect(out).toContain('set base_path /var/spool/apt-mirror');
  });

  it('appends a new global after the last set directive', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.setGlobal('nthreads', '8');
    expect(cfg.getGlobal('nthreads')).toBe('8');
    const lines = cfg.serialize().split('\n');
    expect(lines[2]).toBe('set nthreads 8');
  });
});

describe('addSection', () => {
  it('inserts a section before the clean block and adds a clean directive', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.addSection(input(), 'mirror.intra');
    const out = cfg.serialize();

    expect(out).toContain('# ---start---Docker Ubuntu---');
    expect(out).toContain(
      'deb https://download.docker.com/linux/ubuntu noble stable',
    );
    expect(out).toContain('#Trusted: yes');
    expect(out).toContain('clean https://download.docker.com/linux/ubuntu');

    // Section must appear before the clean block.
    expect(out.indexOf('# ---start---Docker Ubuntu---')).toBeLessThan(
      out.indexOf('# Clean up old packages'),
    );
  });

  it('emits deb-src lines and a deb822 deb-src type when includeSrc is set', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.addSection(input({ includeSrc: true }), 'mirror.intra');
    const out = cfg.serialize();
    expect(out).toContain(
      'deb-src https://download.docker.com/linux/ubuntu noble stable',
    );
    expect(out).toContain('#Types: deb deb-src');
  });

  it('does not duplicate an existing clean directive', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.addSection(
      input({ baseUrl: 'http://archive.ubuntu.com/ubuntu', title: 'Dup' }),
      'mirror.intra',
    );
    const cleans = cfg
      .serialize()
      .split('\n')
      .filter((l) => l === 'clean http://archive.ubuntu.com/ubuntu');
    expect(cleans).toHaveLength(1);
  });

  it('writes the base URL in canonical form, so one upstream keeps one clean line', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.addSection(input({ baseUrl: 'HTTP://ARCHIVE.Ubuntu.com/ubuntu/', title: 'Upper' }), 'mirror.intra');
    const out = cfg.serialize();
    expect(out).toContain('deb http://archive.ubuntu.com/ubuntu noble stable');
    expect(out.split('\n').filter((l) => l.startsWith('clean '))).toEqual(['clean http://archive.ubuntu.com/ubuntu']);
    expect(out).toContain('#URIs: http://mirror.intra/archive.ubuntu.com/ubuntu');
  });
});

describe('removeSection', () => {
  it('removes the section and prunes its now-orphaned clean directive', () => {
    const cfg = MirrorConfig.parse(BASE);
    expect(cfg.removeSection('Ubuntu Noble')).toBe(true);
    const out = cfg.serialize();
    expect(out).not.toContain('# ---start---Ubuntu Noble---');
    expect(out).not.toContain('clean http://archive.ubuntu.com/ubuntu');
  });

  it('keeps a clean directive still referenced by another section', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.addSection(
      input({ baseUrl: 'http://archive.ubuntu.com/ubuntu', title: 'Other' }),
      'mirror.intra',
    );
    cfg.removeSection('Ubuntu Noble');
    expect(cfg.serialize()).toContain('clean http://archive.ubuntu.com/ubuntu');
  });

  it('returns false for an unknown section', () => {
    const cfg = MirrorConfig.parse(BASE);
    expect(cfg.removeSection('Nope')).toBe(false);
  });
});

describe('setSectionEnabled', () => {
  it('disables a section by commenting only its deb lines', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.setSectionEnabled('Ubuntu Noble', false);
    const out = cfg.serialize();
    expect(out).toContain(
      '# deb http://archive.ubuntu.com/ubuntu noble main restricted',
    );
    // The description comment and Usage snippet are untouched.
    expect(out).toContain('# Ubuntu repos');
    expect(out).toContain('#Types: deb');
  });

  it('re-enabling is the inverse of disabling for the deb lines', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.setSectionEnabled('Ubuntu Noble', false);
    cfg.setSectionEnabled('Ubuntu Noble', true);
    expect(cfg.serialize()).toContain(
      'deb http://archive.ubuntu.com/ubuntu noble main restricted',
    );
    const section = cfg.getSection('Ubuntu Noble')!;
    expect(cfg.isSectionEnabled(section)).toBe(true);
  });
});

describe('editSection', () => {
  it('rewrites suites/components/url and re-syncs clean directives', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.editSection(
      'Ubuntu Noble',
      input({
        title: 'Ubuntu Noble',
        baseUrl: 'http://archive.ubuntu.com/ubuntu',
        suites: ['noble', 'noble-updates'],
        components: ['main', 'universe'],
        trusted: false,
      }),
      'mirror.intra',
    );
    const out = cfg.serialize();
    expect(out).toContain(
      'deb http://archive.ubuntu.com/ubuntu noble main universe',
    );
    expect(out).toContain(
      'deb http://archive.ubuntu.com/ubuntu noble-updates main universe',
    );
    expect(out).toContain('clean http://archive.ubuntu.com/ubuntu');
  });

  it('prunes the old clean directive when the base URL changes', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.editSection(
      'Ubuntu Noble',
      input({ title: 'Ubuntu Noble', baseUrl: 'http://example.com/ubuntu' }),
      'mirror.intra',
    );
    const out = cfg.serialize();
    expect(out).not.toContain('clean http://archive.ubuntu.com/ubuntu');
    expect(out).toContain('clean http://example.com/ubuntu');
  });
});

describe('display helpers', () => {
  it('extracts active upstream hosts', () => {
    const cfg = MirrorConfig.parse(BASE);
    const section = cfg.getSection('Ubuntu Noble')!;
    expect(cfg.sectionHosts(section)).toEqual(['archive.ubuntu.com']);
  });

  it('returns cleaned Usage lines for display', () => {
    const cfg = MirrorConfig.parse(BASE);
    const section = cfg.getSection('Ubuntu Noble')!;
    expect(cfg.sectionUsageLines(section)).toEqual([
      'Types: deb',
      'URIs: http://mirror.intra/archive.ubuntu.com/ubuntu',
    ]);
  });
});

describe('sectionToInput', () => {
  it('reconstructs the editable input for a section', () => {
    const cfg = MirrorConfig.parse(BASE);
    const section = cfg.getSection('Ubuntu Noble')!;
    expect(cfg.sectionToInput(section)).toEqual({
      title: 'Ubuntu Noble',
      description: 'Ubuntu repos',
      baseUrl: 'http://archive.ubuntu.com/ubuntu',
      suites: ['noble'],
      components: ['main', 'restricted'],
      includeSrc: false,
      trusted: false,
      arches: [],
      filters: {},
    });
  });

  it('round-trips through addSection: input -> section -> input', () => {
    const cfg = MirrorConfig.parse(BASE);
    const original = input({ trusted: true, includeSrc: true });
    cfg.addSection(original, 'mirror.intra');
    const restored = cfg.sectionToInput(cfg.getSection(original.title)!);
    expect(restored).toEqual({
      ...original,
      baseUrl: original.baseUrl, // already normalized
      arches: [],
      filters: {},
    });
  });

  it('detects trusted from a [trusted=yes] deb option', () => {
    const cfg = MirrorConfig.parse(
      [
        '# ---start---Docker---',
        'deb [trusted=yes] https://download.docker.com/linux/debian trixie stable',
        '# ---end---Docker---',
      ].join('\n'),
    );
    const restored = cfg.sectionToInput(cfg.getSection('Docker')!)!;
    expect(restored.trusted).toBe(true);
    expect(restored.baseUrl).toBe('https://download.docker.com/linux/debian');
  });

  it('returns null for a section with no deb directives', () => {
    const cfg = MirrorConfig.parse(
      ['# ---start---Empty---', '# just a note', '# ---end---Empty---'].join(
        '\n',
      ),
    );
    expect(cfg.sectionToInput(cfg.getSection('Empty')!)).toBeNull();
  });
});

describe('package filters & architectures', () => {
  const FILTERED = `# ---start---Steam---
deb [arch=i386] http://deb.debian.org/debian trixie main
include_source_name http://deb.debian.org/debian steam
include_binary_packages http://deb.debian.org/debian steam libc6
# ---end---Steam---
`;

  it('round-trips filter + arch lines byte-for-byte', () => {
    expect(MirrorConfig.parse(FILTERED).serialize()).toBe(FILTERED);
  });

  it('addSection emits arch option and URL-bound filter directives', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.addSection(
      input({
        title: 'Steam i386',
        baseUrl: 'http://deb.debian.org/debian',
        suites: ['trixie'],
        components: ['main', 'contrib', 'non-free'],
        trusted: false,
        arches: ['i386'],
        filters: {
          include_source_name: ['steam'],
          include_binary_packages: ['steam', 'steam-installer', 'libc6'],
        },
      }),
      'mirror.intra',
    );
    const out = cfg.serialize();
    expect(out).toContain(
      'deb [arch=i386] http://deb.debian.org/debian trixie main contrib non-free',
    );
    expect(out).toContain(
      'include_source_name http://deb.debian.org/debian steam',
    );
    expect(out).toContain(
      'include_binary_packages http://deb.debian.org/debian steam steam-installer libc6',
    );
  });

  it('sectionToInput reconstructs arches and filters', () => {
    const cfg = MirrorConfig.parse(FILTERED);
    const got = cfg.sectionToInput(cfg.getSection('Steam')!)!;
    expect(got.arches).toEqual(['i386']);
    expect(got.filters?.include_source_name).toEqual(['steam']);
    expect(got.filters?.include_binary_packages).toEqual(['steam', 'libc6']);
  });

  it('editSection overrides provided filters but preserves unmentioned ones', () => {
    const cfg = MirrorConfig.parse(FILTERED);
    cfg.editSection(
      'Steam',
      input({
        title: 'Steam',
        baseUrl: 'http://deb.debian.org/debian',
        suites: ['trixie'],
        components: ['main'],
        trusted: false,
        arches: ['i386'],
        filters: { include_binary_packages: ['steam', 'libc6', 'libgl1'] },
      }),
      'mirror.intra',
    );
    const out = cfg.serialize();
    // overridden
    expect(out).toContain(
      'include_binary_packages http://deb.debian.org/debian steam libc6 libgl1',
    );
    // include_source_name not in input.filters -> preserved
    expect(out).toContain(
      'include_source_name http://deb.debian.org/debian steam',
    );
  });

  it('editSection clears a filter when given an empty array', () => {
    const cfg = MirrorConfig.parse(FILTERED);
    cfg.editSection(
      'Steam',
      input({
        title: 'Steam',
        baseUrl: 'http://deb.debian.org/debian',
        suites: ['trixie'],
        components: ['main'],
        trusted: false,
        arches: ['i386'],
        filters: { include_source_name: [] },
      }),
      'mirror.intra',
    );
    expect(cfg.serialize()).not.toContain('include_source_name');
  });
});

describe('editing repositories the form cannot represent', () => {
  const MULTI = `# ---start---Debian Trixie---
# Debian 13
deb http://deb.debian.org/debian trixie main contrib
deb http://security.debian.org/debian-security trixie-security main contrib
# Usage start
#Types: deb
# Usage end
# ---end---Debian Trixie---
`;

  it('treats a section with several upstreams as not editable', () => {
    const cfg = MirrorConfig.parse(MULTI);
    expect(cfg.sectionToInput(cfg.getSection('Debian Trixie')!)).toBeNull();
  });

  it('treats a section with different component sets as not editable', () => {
    const cfg = MirrorConfig.parse(`# ---start---Mixed---
deb http://deb.debian.org/debian trixie main
deb http://deb.debian.org/debian trixie-updates main contrib
# ---end---Mixed---
`);
    expect(cfg.sectionToInput(cfg.getSection('Mixed')!)).toBeNull();
  });

  it('keeps the Signed-By line of the Usage snippet when editing', () => {
    const cfg = MirrorConfig.parse(`# ---start---Ubuntu Noble---
deb http://archive.ubuntu.com/ubuntu noble main
# Usage start
#Types: deb
#URIs: http://mirror.intra/archive.ubuntu.com/ubuntu
#Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
# Usage end
# ---end---Ubuntu Noble---
`);
    const current = cfg.sectionToInput(cfg.getSection('Ubuntu Noble')!)!;
    expect(current).not.toBeNull();
    cfg.editSection('Ubuntu Noble', { ...current, suites: ['noble', 'noble-updates'] }, 'mirror.intra');
    expect(cfg.serialize()).toContain('#Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg');
    expect(cfg.serialize()).toContain('deb http://archive.ubuntu.com/ubuntu noble-updates main');
  });
});

describe('disabling a filtered repository', () => {
  const FILTERED = `# ---start---Hello---
deb http://deb.debian.org/debian trixie main
include_binary_packages http://deb.debian.org/debian hello libc6
# ---end---Hello---
`;

  it('comments out its filters with its sources, and restores both on enable', () => {
    const cfg = MirrorConfig.parse(FILTERED);
    cfg.setSectionEnabled('Hello', false);
    const disabled = cfg.serialize();
    expect(disabled).toContain('# include_binary_packages http://deb.debian.org/debian hello libc6');
    expect(disabled).not.toMatch(/^include_binary_packages/m);

    const reparsed = MirrorConfig.parse(disabled);
    reparsed.setSectionEnabled('Hello', true);
    expect(reparsed.serialize()).toBe(FILTERED);
  });

  it('only counts enabled filters as filtering', () => {
    const cfg = MirrorConfig.parse(FILTERED);
    expect(cfg.isSectionFiltered(cfg.getSection('Hello')!)).toBe(true);
    cfg.setSectionEnabled('Hello', false);
    expect(cfg.isSectionFiltered(cfg.getSection('Hello')!)).toBe(false);
  });
});

describe('descriptions', () => {
  it.each([
    'deb http://evil.example.com/debian trixie main',
    'clean http://deb.debian.org/debian',
    'include_binary_packages http://deb.debian.org/debian hello',
    'Usage start',
    '---end---Ubuntu Noble---',
  ])('never become directives or markers after disable + enable: %s', (description) => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.addSection(input({ title: 'Tricky', description }), 'mirror.intra');
    const before = cfg.serialize();

    const toggled = MirrorConfig.parse(before);
    toggled.setSectionEnabled('Tricky', false);
    const again = MirrorConfig.parse(toggled.serialize());
    again.setSectionEnabled('Tricky', true);

    expect(again.serialize()).toBe(before);
    expect(again.sectionTitles()).toEqual(['Ubuntu Noble', 'Tricky']);
    expect(again.sectionToInput(again.getSection('Tricky')!)!.description).toBe(description);
  });

  it('still reads a legacy single-# description', () => {
    const cfg = MirrorConfig.parse(BASE);
    expect(cfg.sectionToInput(cfg.getSection('Ubuntu Noble')!)!.description).toBe('Ubuntu repos');
  });
});

describe('sectionRevision', () => {
  it('is stable for unchanged text and changes with any edit', () => {
    const a = MirrorConfig.parse(BASE);
    const b = MirrorConfig.parse(BASE);
    const rev = a.sectionRevision(a.getSection('Ubuntu Noble')!);
    expect(b.sectionRevision(b.getSection('Ubuntu Noble')!)).toBe(rev);

    b.setSectionEnabled('Ubuntu Noble', false);
    expect(b.sectionRevision(b.getSection('Ubuntu Noble')!)).not.toBe(rev);

    const c = MirrorConfig.parse(BASE.replace('# Ubuntu repos', '# Ubuntu repositories'));
    expect(c.sectionRevision(c.getSection('Ubuntu Noble')!)).not.toBe(rev);
  });

  it('ignores changes to other sections', () => {
    const a = MirrorConfig.parse(BASE);
    const rev = a.sectionRevision(a.getSection('Ubuntu Noble')!);
    a.addSection(input(), 'mirror.intra');
    expect(a.sectionRevision(a.getSection('Ubuntu Noble')!)).toBe(rev);
  });
});

describe('duplicate titles (hand-edited file)', () => {
  const DUP = BASE.replace(
    '# Clean up old packages',
    `# ---start---Ubuntu Noble---
deb http://archive.ubuntu.com/ubuntu noble-updates main
# ---end---Ubuntu Noble---

# Clean up old packages`,
  );

  it('acts on the section whose revision matches, not the first one', () => {
    const cfg = MirrorConfig.parse(DUP);
    const [first, second] = cfg.sections();
    const secondRev = cfg.sectionRevision(second);
    expect(cfg.getSection('Ubuntu Noble', secondRev)).toBe(second);

    cfg.setSectionEnabled('Ubuntu Noble', false, secondRev);
    expect(cfg.isSectionEnabled(first)).toBe(true);
    expect(cfg.isSectionEnabled(second)).toBe(false);
    expect(cfg.serialize()).toContain('# deb http://archive.ubuntu.com/ubuntu noble-updates main');
  });

  it('removes the matching section', () => {
    const cfg = MirrorConfig.parse(DUP);
    const second = cfg.sections()[1];
    cfg.removeSection('Ubuntu Noble', cfg.sectionRevision(second));
    expect(cfg.serialize()).not.toContain('noble-updates');
    expect(cfg.serialize()).toContain('noble main restricted');
  });

  it('can disable both copies of identical sections in turn', () => {
    const section = BASE.slice(BASE.indexOf('# ---start---'), BASE.indexOf('# Clean up'));
    const cfg = MirrorConfig.parse(BASE.replace('# Clean up', `${section}# Clean up`));
    const rev = cfg.sectionRevision(cfg.sections()[0]);
    cfg.setSectionEnabled('Ubuntu Noble', false, rev);
    cfg.setSectionEnabled('Ubuntu Noble', false, rev);
    expect(cfg.sections().every((s) => !cfg.isSectionEnabled(s))).toBe(true);
  });

  it('falls back to the first match without a revision', () => {
    const cfg = MirrorConfig.parse(DUP);
    expect(cfg.getSection('Ubuntu Noble')).toBe(cfg.sections()[0]);
    expect(cfg.getSection('Ubuntu Noble', 'unknown')).toBe(cfg.sections()[0]);
  });
});

describe('enabledHosts', () => {
  it('lists the upstream hosts of enabled sections only', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.addSection(input(), 'mirror.intra');
    expect(cfg.enabledHosts()).toEqual(['archive.ubuntu.com', 'download.docker.com']);
    cfg.setSectionEnabled('Docker Ubuntu', false);
    expect(cfg.enabledHosts()).toEqual(['archive.ubuntu.com']);
  });
});

describe('base URLs with a port (r3-repos-2)', () => {
  it('points the Usage snippet at the host:port folder apt-mirror2 uses', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.addSection(input({ title: 'LAN', baseUrl: 'http://aptly.lan:8080/debian', trusted: false }), 'mirror.intra');
    const section = cfg.getSection('LAN')!;
    expect(cfg.sectionUsageLines(section)).toContain('URIs: http://mirror.intra/aptly.lan:8080/debian');
  });

  it('keeps the key host without the port', () => {
    const cfg = MirrorConfig.parse(BASE);
    cfg.addSection(input({ title: 'LAN', baseUrl: 'http://192.168.0.10:18099/', trusted: false }), 'mirror.intra');
    expect(cfg.sectionHosts(cfg.getSection('LAN')!)).toEqual(['192.168.0.10']);
  });

  it('leaves snippets of upstreams without a port alone', () => {
    const cfg = MirrorConfig.parse(BASE);
    expect(cfg.sectionUsageLines(cfg.getSection('Ubuntu Noble')!)).toContain(
      'URIs: http://mirror.intra/archive.ubuntu.com/ubuntu',
    );
  });
});

