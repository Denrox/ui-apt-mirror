import { describe, it, expect } from 'vitest';
import {
  categoriesFor,
  cleanSourceName,
  onlySheetChanged,
  parseSheetParam,
  sheetSearch,
  defaultSourceName,
  extractHeadings,
  extractTitle,
  githubWebUrl,
  isSafeRelativeMdPath,
  markdownToText,
  parseCategoriesJson,
  parseGithubUrl,
  parsePaging,
  plural,
  resolvePageLink,
  searchEntries,
  searchEntriesAsync,
  searchTerms,
  MAX_SEARCH_TERMS,
  SEARCH_PAGE_SIZE,
  sourceIdFor,
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
    ['https://github.com/tldr-pages/tldr/tree/main/../..', '".."'],
    ['https://github.com/o/r/tree/main/pages/%2e%2E/x', '".."'],
    ['github.com/o/r/tree/main/./pages', '".."'],
    ['https://github.com/tldr-pages/tldr/tree/main/pages/..%00', 'folder path'],
    ['https://github.com/o/r/tree/main/pages/%0Ax', 'folder path'],
    ['https://github.com/tldr-pages/tldr/tree/main/pages/...', 'folder path'],
    ['https://github.com/o/r/tree/main/%E0%A4%A', 'valid URL'],
  ])('rejects %s', (input, message) => {
    expect(() => parseGithubUrl(input)).toThrow(message);
  });
});

describe('cleanSourceName', () => {
  it('keeps one trimmed line of at most 100 characters', () => {
    expect(cleanSourceName('  First\naid\r\n manual\t')).toBe('First aid manual');
    expect(cleanSourceName('evil\u202Etxt.exe\u2066x\u0000y')).toBe('evil txt.exe x y');
    expect(cleanSourceName('x'.repeat(200_000))).toHaveLength(100);
    expect(Array.from(cleanSourceName('😀'.repeat(150)))).toHaveLength(100);
    expect(cleanSourceName(' \n\u202E ')).toBe('');
  });
});

describe('sourceIdFor', () => {
  it('builds the id from owner, repo, branch and folder', () => {
    const gh = parseGithubUrl('https://github.com/Denrox/offline-library/tree/medicine-first-aid');
    expect(sourceIdFor(gh, () => false)).toBe('denrox-offline-library-medicine-first-aid');
    expect(sourceIdFor(parseGithubUrl('github.com/o/r'), () => false)).toBe('o-r');
  });

  it('adds a hash of the URL when the id is taken, the same one every time', () => {
    const gh = parseGithubUrl('https://github.com/o/r_x');
    const taken = new Set(['o-r-x']);
    const id = sourceIdFor(gh, (id) => taken.has(id));
    expect(id).toMatch(/^o-r-x-[0-9a-f]{8}$/);
    expect(sourceIdFor(gh, (id) => taken.has(id))).toBe(id);
    expect(sourceIdFor(parseGithubUrl('https://github.com/o/r.x'), (id) => taken.has(id))).not.toBe(id);
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

  it('keeps autolinked URLs', () => {
    expect(markdownToText('> More information: <https://www.gnu.org/software/tar>.')).toBe(
      'More information: https://www.gnu.org/software/tar .',
    );
  });
});

describe('extractHeadings', () => {
  it('lists section headings as plain text, not the title or code comments', () => {
    const md = '# Chapter 4\n\n## Equipment\n### [Tourniquets](t.md) ##\n```sh\n## not a heading\n```\n#### *Wound* packing\nText';
    expect(extractHeadings(md)).toBe('Equipment\nTourniquets\nWound packing');
    expect(extractHeadings('# Only a title\ntext')).toBe('');
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
    headings: '',
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

  it('matches at word starts only', () => {
    const list = [
      entry('Cataract', 'Clouding of the lens.'),
      entry('resticprofile', 'Configuration profiles for restic.'),
      entry('CPR', 'Cardiopulmonary resuscitation. Start CPR right away.'),
      entry('tar', 'Archiving utility. Create a tarball.'),
    ];
    expect(searchEntries(list, 'tar').map((h) => h.entry.title)).toEqual(['tar']);
    expect(searchEntries(list, 'cpr').map((h) => h.entry.title)).toEqual(['CPR']);
    expect(searchEntries(list, 'tarb').map((h) => h.entry.title)).toEqual(['tar']);
  });

  it('ignores accents in the query and the pages', () => {
    const list = [
      entry("Sjogren's Syndrome", 'Dry eyes and mouth.'),
      entry('Dry Mouth', 'A sign of Sjögren syndrome.'),
    ];
    expect(searchEntries(list, 'sjögren').map((h) => h.entry.title)).toEqual([
      "Sjogren's Syndrome",
      'Dry Mouth',
    ]);
    expect(searchEntries(list, 'SJOGREN')).toHaveLength(2);
    expect(searchEntries(list, 'sjogren')[1].snippet).toContain('Sjögren');
  });

  it('gives title points to non-ASCII title words', () => {
    const list = [entry('Ожог', 'Охладите ожог водой.'), entry('Вода', 'Ожог: охладите.')];
    expect(searchEntries(list, 'ожог')[0].entry.title).toBe('Ожог');
  });

  it('ranks pages that use the term more often, without a cap', () => {
    const filler = 'Apply pressure and wait for help to arrive. '.repeat(10);
    const list = [
      entry('Appendix A', 'Kit list: tourniquet tourniquet tourniquet tourniquet tourniquet tourniquet.'),
      entry('Chapter 4', `${filler}Use a tourniquet. ${'Tighten the tourniquet until bleeding stops. '.repeat(12)}`),
      entry('Allergen', `${filler}Not a tourniquet.`),
    ];
    const titles = searchEntries(list, 'tourniquet').map((h) => h.entry.title);
    expect(titles.indexOf('Allergen')).toBe(2);
    const scores = searchEntries(list, 'tourniquet').map((h) => h.score);
    expect(new Set(scores).size).toBe(3);
  });

  it('ranks a page with the word in a section heading above one that only lists it', () => {
    // The Army manual: Appendix A lists tourniquets in kit tables, Chapter 4 explains them.
    const filler = 'Apply pressure to the wound and check the casualty for other injuries. '.repeat(60);
    const list: IndexEntry[] = [
      entry('Appendix A: First Aid Kits', 'Tourniquet 2 Tourniquet Pouch 2 Combat Application Tourniquet 1 Tourniquet 2'),
      {
        ...entry('Chapter 4: Massive Bleeding Control', `${filler} Apply the tourniquet. ${filler} tourniquet tourniquet`),
        headings: 'Equipment\nTourniquets\nApplication of Tourniquets',
      },
    ];
    expect(searchEntries(list, 'tourniquet').map((h) => h.entry.title)).toEqual([
      'Chapter 4: Massive Bleeding Control',
      'Appendix A: First Aid Kits',
    ]);
    // Without the headings the short list page wins, as before.
    expect(searchEntries(list.map((e) => ({ ...e, headings: '' })), 'tourniquet')[0].entry.title).toBe(
      'Appendix A: First Aid Kits',
    );
  });

  it('returns nothing for blank or unmatched queries', () => {
    expect(searchEntries(entries, '   ')).toEqual([]);
    expect(searchEntries(entries, 'chest fracture')).toEqual([]);
  });

  it('bounds the words a query can cost', () => {
    expect(searchTerms('a e i o s t a e i o s t')).toEqual(['a', 'e', 'i', 'o', 's', 't']);
    expect(searchTerms('e e e e zzzzzzqq')).toEqual(['zzzzzzqq']);
    expect(searchTerms('chest a pain chest')).toEqual(['chest', 'pain']);
    expect(searchTerms('火 傷')).toEqual(['火', '傷']);
    const many = Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ');
    expect(searchTerms(many)).toHaveLength(MAX_SEARCH_TERMS);
    // Repeating a word changes nothing.
    const titles = (q: string) => searchEntries(entries, q).map((h) => h.entry.title);
    expect(titles('chest chest chest pain pain')).toEqual(titles('chest pain'));
    expect(searchEntries(entries, 'chest a pain').map((h) => h.entry.title)).toEqual(['Chest Pain', 'Heart Attack']);
  });

  it('keeps a 100-word query on a large index fast', () => {
    const words = 'the quick brown fox jumps over a lazy dog and then sits in the sun for an hour '.repeat(120);
    const big = Array.from({ length: 3000 }, (_, i) => entry(`Page ${i}`, words));
    const q = Array.from({ length: 100 }, (_, i) => 'aeiost'[i % 6]).join(' ');
    searchEntries(big.slice(0, 10), q);
    const t = performance.now();
    searchEntries(big, q);
    searchEntries(big, `${'e '.repeat(99)}zzzzzzqq`);
    // Before the bound this took several seconds.
    expect(performance.now() - t).toBeLessThan(1500);
  });

  it('searches asynchronously with the same results and lets other work run', async () => {
    const big = Array.from({ length: 4000 }, (_, i) =>
      entry(`Page ${i}`, `${'Apply pressure and wait for help to arrive. '.repeat(40)} chest pain ${i}`),
    );
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    const hits = await searchEntriesAsync([...big, ...entries], 'chest pain');
    clearInterval(timer);
    expect(hits).toEqual(searchEntries([...big, ...entries], 'chest pain'));
    expect(ticks).toBeGreaterThan(0);
  });

  it('stops an async search once the request is aborted', async () => {
    const big = Array.from({ length: 20000 }, (_, i) => entry(`Page ${i}`, 'the help '.repeat(400)));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    await expect(searchEntriesAsync(big, 'the help', controller.signal)).rejects.toThrow();
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

describe('parsePaging', () => {
  it('defaults to the first page', () => {
    expect(parsePaging(null, null)).toEqual({ offset: 0, limit: SEARCH_PAGE_SIZE });
  });

  it('clamps bad and out-of-range values', () => {
    expect(parsePaging('400', '50')).toEqual({ offset: 400, limit: 50 });
    expect(parsePaging('-5', '100000')).toEqual({ offset: 0, limit: SEARCH_PAGE_SIZE });
    expect(parsePaging('abc', '0')).toEqual({ offset: 0, limit: 1 });
  });
});

describe('plural', () => {
  it('uses the singular for one', () => {
    expect(plural(1, 'cheatsheet')).toBe('1 cheatsheet');
    expect(plural(0, 'cheatsheet')).toBe('0 cheatsheets');
    expect(plural(12, 'page')).toBe('12 pages');
  });
});

describe('sheet URL', () => {
  it('parses source and path', () => {
    expect(parseSheetParam('tldr-pages/common/tar.md')).toEqual({ source: 'tldr-pages', path: 'common/tar.md' });
    expect(parseSheetParam(null)).toBeNull();
    expect(parseSheetParam('tldr/../x.md')).toBeNull();
    expect(parseSheetParam('Bad_Id/x.md')).toBeNull();
    expect(parseSheetParam('/x.md')).toBeNull();
  });

  it('writes readable, round-tripping query strings', () => {
    const page = { source: 'med', path: 'Burns & Scalds/First aid.md' };
    const search = sheetSearch(new URLSearchParams('path=x&sheet=old/a.md'), page);
    expect(search).toBe('?path=x&sheet=med/Burns%20%26%20Scalds/First%20aid.md');
    expect(parseSheetParam(new URLSearchParams(search).get('sheet'))).toEqual(page);
    expect(sheetSearch(new URLSearchParams(search), null)).toBe('?path=x');
    expect(sheetSearch(new URLSearchParams('sheet=a/b.md'), null)).toBe('');
  });

  it('skips reloading only when just the sheet changed', () => {
    const u = (s: string) => new URL(s, 'http://cheatsheets.x');
    expect(onlySheetChanged(u('/cheatsheets'), u('/cheatsheets?sheet=a/b.md'))).toBe(true);
    expect(onlySheetChanged(u('/?path=x&sheet=a/b.md'), u('/?path=x'))).toBe(true);
    expect(onlySheetChanged(u('/cheatsheets'), u('/cheatsheets'))).toBe(false);
    expect(onlySheetChanged(u('/?path=x'), u('/?path=y'))).toBe(false);
    expect(onlySheetChanged(u('/cheatsheets'), u('/home?sheet=a/b.md'))).toBe(false);
  });
});
