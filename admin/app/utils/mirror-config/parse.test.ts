import { describe, it, expect } from 'vitest';
import { parse } from './parse';
import type { DebNode, SectionNode, SetNode } from './types';

describe('parse', () => {
  it('parses a set directive, preserving aligned spacing in raw', () => {
    const [node] = parse('set base_path    /var/spool/apt-mirror');
    expect(node).toMatchObject<Partial<SetNode>>({
      kind: 'set',
      key: 'base_path',
      value: '/var/spool/apt-mirror',
    });
    expect((node as SetNode).raw).toBe(
      'set base_path    /var/spool/apt-mirror',
    );
  });

  it('keeps quoted set values intact', () => {
    const [node] = parse('set _user_agent "apt-mirror2/14"') as SetNode[];
    expect(node.value).toBe('"apt-mirror2/14"');
  });

  it('parses an active deb directive into uri/suite/components', () => {
    const [node] = parse(
      'deb http://archive.ubuntu.com/ubuntu noble main restricted universe',
    ) as DebNode[];
    expect(node).toMatchObject<Partial<DebNode>>({
      kind: 'deb',
      debType: 'deb',
      enabled: true,
      uri: 'http://archive.ubuntu.com/ubuntu',
      suite: 'noble',
      components: ['main', 'restricted', 'universe'],
      options: [],
    });
  });

  it('parses a commented deb line as a disabled directive, not a comment', () => {
    const [node] = parse(
      '#deb http://deb.debian.org/debian bookworm main',
    ) as DebNode[];
    expect(node.kind).toBe('deb');
    expect(node.enabled).toBe(false);
  });

  it('captures deb options inside brackets', () => {
    const [node] = parse(
      'deb [trusted=yes] https://download.docker.com/linux/debian trixie stable',
    ) as DebNode[];
    expect(node.options).toEqual(['trusted=yes']);
    expect(node.suite).toBe('trixie');
    expect(node.components).toEqual(['stable']);
  });

  it('parses deb-src and does not confuse it with deb', () => {
    const [node] = parse(
      'deb-src http://deb.debian.org/debian trixie main',
    ) as DebNode[];
    expect(node.debType).toBe('deb-src');
  });

  it('does not treat a description comment as a deb directive', () => {
    const [node] = parse('# Debian 12 (Bookworm) repositories');
    expect(node.kind).toBe('comment');
  });

  it('captures a Usage block verbatim without reparsing its inner lines', () => {
    const input = [
      '# ---start---Docker---',
      'deb https://download.docker.com/linux/ubuntu noble stable',
      '# Usage start',
      '#Types: deb',
      '#URIs: http://mirror.intra/download.docker.com/linux/ubuntu',
      '#Trusted: yes',
      '# Usage end',
      '# ---end---Docker---',
    ].join('\n');
    const [section] = parse(input) as SectionNode[];
    expect(section.kind).toBe('section');
    expect(section.title).toBe('Docker');

    const kinds = section.children.map((c) => c.kind);
    expect(kinds).toEqual(['deb', 'usage']);
    const usage = section.children[1];
    expect(usage.kind === 'usage' && usage.lines).toContain('#Types: deb');
  });

  it('closes an unterminated section without swallowing later content', () => {
    const input = [
      '# ---start---Broken---',
      'deb http://example.com/repo noble main',
      '# ---start---Next---',
      'deb http://example.com/other noble main',
      '# ---end---Next---',
    ].join('\n');
    const sections = parse(input).filter(
      (n): n is SectionNode => n.kind === 'section',
    );
    expect(sections.map((s) => s.title)).toEqual(['Broken', 'Next']);
    expect(sections[0].endRaw).toBeUndefined();
  });
});

describe('parse never fails on unusual characters', () => {
  // Lines are split on \n only; U+2028/U+2029/U+0085 stay inside a line and `.` does not match
  // them without the `s` flag. One such line used to make every parse throw.
  it.each([' ', ' ', '\u0085'])('parses a file with %j in a description and title', (sep) => {
    const input = [
      `# ---start---Odd${sep}title---`,
      `## x${sep}deb http://evil/ trixie main`,
      `#  x${sep}y`,
      `deb http://deb.debian.org/debian trixie main${sep}`,
      `include_binary_packages http://deb.debian.org/debian hello${sep}`,
      `# ---end---Odd${sep}title---`,
    ].join('\n');
    const nodes = parse(input);
    const sections = nodes.filter((n): n is SectionNode => n.kind === 'section');
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe(`Odd${sep}title`);
    expect(sections[0].endRaw).toBeDefined();
    expect(sections[0].children.map((c) => c.kind)).toEqual(['comment', 'comment', 'deb', 'filter']);
  });
});
