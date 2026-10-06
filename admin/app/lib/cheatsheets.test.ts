import { describe, it, expect } from 'vitest';
import {
  categoriesFor,
  defaultSourceName,
  extractTitle,
  githubWebUrl,
  isSafeRelativeMdPath,
  markdownToText,
  parseCategoriesJson,
  parseGithubUrl,
  resolvePageLink,
  searchEntries,
  type IndexEntry,
} from './cheatsheets';

describe('parseGithubUrl', () => {
  it('parses a repository URL with default branch', () => {
    expect(parseGithubUrl('https://github.com/tldr-pages/tldr')).toEqual({
      owner: 'tldr-pages',
      repo: 'tldr',
      ref: null,
      path: '',
    });
  });

  it('accepts .git suffix, trailing slash and a missing scheme', () => {
    expect(parseGithubUrl('github.com/owner/repo.git/')).toMatchObject({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses a folder URL into ref and path', () => {
    expect(
      parseGithubUrl('https://github.com/tldr-pages/tldr/tree/main/pages/common'),
    ).toEqual({ owner: 'tldr-pages', repo: 'tldr', ref: 'main', path: 'pages/common' });
  });

  it('names a branch URL after the branch', () => {
    expect(defaultSourceName(parseGithubUrl('https://github.com/o/lib/tree/medicine-first-aid'))).toBe(
      'lib/medicine-first-aid',
    );
    expect(defaultSourceName(parseGithubUrl('https://github.com/o/lib'))).toBe('o/lib');
  });

  it('round-trips through githubWebUrl', () => {
    const url = 'https://github.com/o/r/tree/v1.2/docs/first aid';
    expect(githubWebUrl(parseGithubUrl(url))).toBe(url);
  });

  it.each([
    ['', 'required'],
    ['https://gitlab.com/o/r', 'github.com'],
    ['https://github.com/onlyowner', 'repository'],
    ['https://github.com/o/r/blob/main/README.md', 'folder URL'],
    ['https://github.com/o/r/tree/main/..%2F..%2Fetc', 'folder path'],
    ['https://github.com/o/r$/tree/main', 'Invalid owner'],
  ])('rejects %s', (input, message) => {
    expect(() => parseGithubUrl(input)).toThrow(message);
  });
});

describe('markdown helpers', () => {
  it('takes the first H1 as title, else the file name', () => {
    expect(extractTitle('intro\n# tar\n\n> Archiving utility', 'common/tar.md')).toBe('tar');
    expect(extractTitle('no heading here', 'linux/apt-get.md')).toBe('apt-get');
  });

  it('flattens tables', () => {
    expect(markdownToText('|**AAS**|advanced system|\n|---|---|\n|AR|army regulation|')).toBe(
      'AAS advanced system AR army regulation',
    );
  });

  it('strips markdown syntax and tldr placeholders', () => {
    const md = '# tar\n\n> Archiving [utility](https://x).\n\n- Create:\n\n`tar cf {{target.tar}} {{file}}`';
    expect(markdownToText(md)).toBe('tar Archiving utility. Create: tar cf target.tar file');
  });
});

describe('categories', () => {
  const explicit = parseCategoriesJson({
    Bleeding: ['External Bleeding.md', 'Nosebleed.md'],
    Emergencies: ['External Bleeding.md'],
    junk: 'not a list',
  });

  it('uses categories.json when it lists the file', () => {
    expect(categoriesFor('External Bleeding.md', explicit)).toEqual(['Bleeding', 'Emergencies']);
  });

  it('falls back to the first sub-folder, then General', () => {
    expect(categoriesFor('linux/apt.md', null)).toEqual(['linux']);
    expect(categoriesFor('Other.md', explicit)).toEqual(['General']);
  });
});

describe('searchEntries', () => {
  const entry = (title: string, text: string): IndexEntry => ({
    path: `${title}.md`,
    title,
    categories: ['General'],
    text,
  });
  const entries = [
    entry('Chest Pain', 'Chest pain can be a sign of a heart attack. Call for help.'),
    entry('Heart Attack', 'Symptoms include chest pain and shortness of breath.'),
    entry('Burns', 'Cool the burn under running water.'),
  ];

  it('requires every word and ranks title matches first', () => {
    const hits = searchEntries(entries, 'chest pain');
    expect(hits.map((h) => h.entry.title)).toEqual(['Chest Pain', 'Heart Attack']);
  });

  it('matches body text and returns a snippet around it', () => {
    const [hit] = searchEntries(entries, 'running water');
    expect(hit.entry.title).toBe('Burns');
    expect(hit.snippet).toContain('running water');
  });

  it('prefers whole title words over substrings', () => {
    const tldr = [
      entry('ptargrep', 'Find regex patterns in tar archive files. Extract matches.'),
      entry('tar', markdownToText('# tar\n\n- E[x]tract a (compressed) archive [f]ile:')),
    ];
    expect(searchEntries(tldr, 'extract tar')[0].entry.title).toBe('tar');
  });

  it('returns nothing for blank or unmatched queries', () => {
    expect(searchEntries(entries, '   ')).toEqual([]);
    expect(searchEntries(entries, 'chest fracture')).toEqual([]);
  });
});

describe('isSafeRelativeMdPath', () => {
  it.each([
    ['common/tar.md', true],
    ['First Aid - Burns.md', true],
    ['../secret.md', false],
    ['/etc/passwd.md', false],
    ['a//b.md', false],
    ['notes.txt', false],
  ])('%s -> %s', (p, ok) => {
    expect(isSafeRelativeMdPath(p)).toBe(ok);
  });
});

describe('resolvePageLink', () => {
  it.each([
    ['Acne.md', 'Scars.md', 'Scars.md'],
    ['Acne.md', 'Hidradenitis%20Suppurativa.md', 'Hidradenitis Suppurativa.md'],
    ['common/tar.md', 'gzip.md#usage', 'common/gzip.md'],
    ['linux/apt.md', '../common/tar.md', 'common/tar.md'],
  ])('%s + %s -> %s', (from, href, expected) => {
    expect(resolvePageLink(from, href)).toBe(expected);
  });

  it.each([
    'https://medlineplus.gov/scars.html',
    'mailto:x@y.z',
    '/etc/passwd.md',
    '#section',
    '../../outside.md',
    'notes.txt',
    '%E0%A4%A.md',
  ])('rejects %s', (href) => {
    expect(resolvePageLink('Acne.md', href)).toBeNull();
  });
});
