import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import { giveToDirOwner } from './file-owner';
import { MirrorConfig, type RepositoryInput } from '~/utils/mirror-config';

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
const TOKEN_RE = /^[A-Za-z0-9._+~\/-]+$/;

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
  if (pathTokens.some((t) => !TOKEN_RE.test(t))) {
    return 'Suites, components and architectures may only contain letters, digits and . _ - + ~ /';
  }
  if (pathTokens.some((t) => t.split('/').includes('..'))) {
    return 'Suites, components and architectures cannot contain ".."';
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
  if (existingTitles.some((t) => t.toLowerCase() === title.toLowerCase())) {
    return `A repository titled "${title}" already exists`;
  }

  const base = input.baseUrl?.trim() ?? '';
  if (!base) return 'Base URL is required';
  if (/\s/.test(base)) return 'Base URL cannot contain spaces';
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return 'Base URL is not a valid URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Base URL must use http or https';
  }
  if (base.includes('#') || base.includes('?')) {
    return 'Base URL cannot contain a query or fragment';
  }

  if (!input.suites.length) return 'At least one suite is required';
  if (!input.components.length) return 'At least one component is required';
  if (input.suites.some((s) => s.includes('#'))) return 'Invalid suite name';
  if (input.components.some((c) => c.includes('#'))) {
    return 'Invalid component name';
  }

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
