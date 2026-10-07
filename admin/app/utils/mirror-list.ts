import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import { giveToDirOwner } from './file-owner';
import { MirrorConfig, isPathToken, type RepositoryInput } from '~/utils/mirror-config';

/**
 * Thin helpers for the apt-mirror2 `mirror.list` file.
 *
 * All structural parsing/serialization now lives in {@link MirrorConfig}
 * (`~/utils/mirror-config`), which round-trips the file losslessly and edits it
 * through a typed AST. This module keeps the small, file-oriented surface the
 * rest of the app imports: atomic writes, input validation, and string-in /
 * string-out wrappers around the model for add/remove.
 */

/** Re-exported for callers that predate the {@link MirrorConfig} model. */
export type NewRepositoryInput = RepositoryInput;

let mirrorListQueue: Promise<unknown> = Promise.resolve();

/** Run read-modify-write cycles on mirror.list one at a time, so none is lost. */
export function withMirrorListLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = mirrorListQueue.then(fn);
  mirrorListQueue = run.catch(() => undefined);
  return run;
}

/** Write a file atomically: write to a sibling temp file, then rename. */
export async function atomicWriteFile(
  filePath: string,
  content: string,
): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(tempPath, content);
  try {
    const previous = await fs.stat(filePath).catch(() => null);
    if (previous) await fs.chmod(tempPath, previous.mode & 0o7777);
    giveToDirOwner(tempPath);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

/** All section titles present in the file (active and disabled alike). */
export function getSectionTitles(content: string): string[] {
  return MirrorConfig.parse(content).sectionTitles();
}

/**
 * Validate user input for a new repository. Returns an error string, or null
 * when the input is valid.
 */
// C0/C1 controls (incl. U+0085 NEL) and the Unicode line/paragraph separators U+2028/U+2029:
// line terminators to some readers (Python's splitlines, JS `.`), so none may reach the file.
const CONTROL_RE = /[\p{Cc}\p{Zl}\p{Zp}]/u;
// URL characters (RFC 3986) without whitespace, `?` and `#`: any other character could be read
// differently by apt-mirror2 (Python splits on Unicode whitespace) than by this app.
const BASE_URL_RE = /^[A-Za-z0-9\-._~:\/@!$&'()*+,;=%\[\]]+$/;
// Characters a title must not contain because they do not show: format characters (zero-width
// space and joiners, bidi embeddings, overrides and isolates, U+FEFF), the other default-ignorable
// code points (combining grapheme joiner, variation selectors, Hangul fillers, Khmer inherent
// vowels, Mongolian variation selectors), private-use and unassigned code points, lone
// surrogates, the object replacement character and the Braille blank. Two titles would otherwise
// look the same, and a bidi override displays a title reversed.
const INVISIBLE_RE =
  /[\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Default_Ignorable_Code_Point}\u115F\u1160\u2800\u3164\uFFA0\uFFFC\uFFFD]/u;
// A combining mark with no letter to attach to (at the start or after a space), the same
// nonspacing mark twice in a row, or three or more stacked: such marks either do not show or
// pile up over the text.
const STRAY_MARK_RE = /^\p{M}|\s\p{M}|(\p{Mn})\1|\p{Mn}{3,}/u;

// Letters of other scripts that look like Latin ones (a subset of the Unicode confusables of
// UTS #39), so "Dеbian" with a Cyrillic "е" counts as a duplicate of "Debian".
const LOOKALIKES: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', Ѕ: 'S', І: 'I', Ј: 'J', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C',
  Т: 'T', Х: 'X', Ү: 'Y', Ԝ: 'W', Ӏ: 'I', а: 'a', е: 'e', ѕ: 's', і: 'i', ј: 'j', о: 'o', р: 'p',
  с: 'c', у: 'y', х: 'x', ү: 'y', һ: 'h', ԁ: 'd', ԛ: 'q', ԝ: 'w', ӏ: 'l',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T',
  Υ: 'Y', Χ: 'X', α: 'a', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', υ: 'u', χ: 'x', ϲ: 'c', ϳ: 'j',
  ı: 'i', ȷ: 'j', ɑ: 'a', ɡ: 'g',
};
const LOOKALIKE_RE = new RegExp(`[${Object.keys(LOOKALIKES).join('')}]`, 'gu');

/**
 * A title as it is compared for duplicates, close to a confusables skeleton: compatibility
 * forms folded (NFKC), combining marks and default-ignorable characters dropped, look-alike
 * letters of other scripts mapped to Latin, case-folded, single spaces. Titles with the same
 * key look the same (or nearly: "Café" and "Cafe" count as duplicates).
 */
export function titleKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\p{M}\p{Default_Ignorable_Code_Point}]/gu, '')
    .replace(LOOKALIKE_RE, (c) => LOOKALIKES[c])
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateRepositoryInput(
  input: NewRepositoryInput,
  existingTitles: string[],
): string | null {
  // Every value is written into mirror.list: a line break or other control character would
  // add lines (directives, sources) to a file apt-mirror runs as root.
  const tokens = [
    ...input.suites,
    ...input.components,
    ...(input.arches ?? []),
    ...Object.values(input.filters ?? {}).flat(),
  ];
  if ([input.title, input.description, input.baseUrl, ...tokens].some((v) => v && CONTROL_RE.test(v))) {
    return 'Values cannot contain line breaks or control characters';
  }
  const pathTokens = [...input.suites, ...input.components, ...(input.arches ?? [])];
  if (!pathTokens.every(isPathToken)) {
    return 'Suites, components and architectures may only contain letters, digits and . _ - + ~ / (no "." or ".." parts)';
  }
  if ((input.description?.trim().length ?? 0) > 500) {
    return 'Description is too long (max 500 characters)';
  }

  const title = input.title?.trim() ?? '';
  if (!title) return 'Title is required';
  if (title.length > 100) return 'Title is too long (max 100 characters)';
  if (title.includes('---') || /[\n\r]/.test(title)) {
    return 'Title cannot contain "---" or line breaks';
  }
  if (INVISIBLE_RE.test(title)) {
    return 'Title cannot contain invisible, bidirectional or private-use characters';
  }
  if (STRAY_MARK_RE.test(title.normalize('NFD'))) {
    return 'Title cannot start with a combining mark, or repeat or stack combining marks';
  }
  if (existingTitles.some((t) => titleKey(t) === titleKey(title))) {
    return `A repository titled "${title}" already exists`;
  }

  const base = input.baseUrl?.trim() ?? '';
  if (!base) return 'Base URL is required';
  if (/\s/.test(base)) return 'Base URL cannot contain spaces';
  if (base.includes('#') || base.includes('?')) {
    return 'Base URL cannot contain a query or fragment';
  }
  if (!BASE_URL_RE.test(base)) return 'Base URL may only contain plain ASCII URL characters';
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return 'Base URL is not a valid URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Base URL must use http or https';
  }
  if (parsed.username || parsed.password) return 'Base URL cannot contain credentials';
  if (base.replace(/^[a-z]+:\/\/[^/]*/i, '').split('/').some((p) => /^(\.|%2e){1,2}$/i.test(p))) {
    return 'Base URL cannot contain "." or ".." parts';
  }

  if (!input.suites.length) return 'At least one suite is required';
  if (!input.components.length) return 'At least one component is required';

  return null;
}

/**
 * Insert a new repository section before the trailing `clean` block and ensure
 * a matching `clean <baseUrl>` line exists. Returns the updated file content.
 */
export function addRepositorySection(
  content: string,
  input: NewRepositoryInput,
  mirrorDomain: string,
): string {
  const config = MirrorConfig.parse(content);
  config.addSection(input, mirrorDomain);
  return config.serialize();
}

/**
 * Excise a repository section entirely and prune its `clean` directive if no
 * other section still references that base URL.
 */
export function removeRepositorySection(
  content: string,
  title: string,
): { content: string; removed: boolean } {
  const config = MirrorConfig.parse(content);
  const removed = config.removeSection(title);
  return { content: config.serialize(), removed };
}
