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
