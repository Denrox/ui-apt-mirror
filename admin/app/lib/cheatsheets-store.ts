// cheatsheetsDir/sources.json lists the sources; each one's content lives in
// sources/<id>/files and its search index in sources/<id>/index.json.

import { execFile, spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { createInterface } from 'readline';
import fs from 'fs/promises';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import appConfig from '~/config/config.json';
import { giveToDirOwner, mkdirOwned } from '~/utils/file-owner';
import {
  categoriesFor,
  cleanSourceName,
  defaultSourceName,
  extractHeadings,
  extractTitle,
  githubWebUrl,
  isSafeRelativeMdPath,
  markdownToText,
  parseCategoriesJson,
  parseGithubUrl,
  sourceIdFor,
  type IndexEntry,
} from './cheatsheets';
import { serialQueue } from '~/utils/serial-queue';

const execFileAsync = promisify(execFile);

export interface CheatsheetSource {
  id: string;
  name: string;
  /** Set by the admin; otherwise the README's first heading replaces the default. */
  nameFromUser?: boolean;
  url: string;
  owner: string;
  repo: string;
  ref: string | null;
  path: string;
  status: 'downloading' | 'ready' | 'error';
  error: string | null;
  fileCount: number;
  revision: string | null;
  addedAt: string;
  updatedAt: string | null;
}

const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;
const MAX_FILES = 50_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Unpacked size of the files taken from an archive (only .md files and categories.json are). */
export const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
/** Entries an archive may list at all, whatever is taken from it. */
const MAX_ARCHIVE_ENTRIES = 500_000;
const MAX_INDEXED_TEXT = 20_000;
const SKIP_FILES = new Set([
  'readme.md',
  'license.md',
  'contributing.md',
  'changelog.md',
  'code_of_conduct.md',
  'security.md',
]);

// Absolute: the dev config path is relative, which breaks the containment checks.
const root = () => path.resolve(appConfig.cheatsheetsDir);
const registryPath = () => path.join(root(), 'sources.json');
const sourceDir = (id: string) => path.join(root(), 'sources', id);
const filesDir = (id: string) => path.join(sourceDir(id), 'files');
const indexPath = (id: string) => path.join(sourceDir(id), 'index.json');

// 'downloading' in sources.json but not in here means a restart interrupted it.
const active = new Set<string>();

async function readRegistry(): Promise<CheatsheetSource[]> {
  try {
    const data = JSON.parse(await fs.readFile(registryPath(), 'utf-8'));
    if (!Array.isArray(data?.sources)) return [];
    return data.sources as CheatsheetSource[];
  } catch {
    return [];
  }
}

async function writeRegistry(sources: CheatsheetSource[]) {
  await mkdirOwned(root());
  const tmp = `${registryPath()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ sources }, null, 2));
  giveToDirOwner(tmp);
  await fs.rename(tmp, registryPath());
}

/**
 * The app runs as root, but the data directory belongs to the host user, who
 * must be able to remove a source without sudo. Gives `target` and everything
 * in it to the owner of the cheatsheets directory, as mirror.list and uploads do.
 */
export async function giveTreeToOwner(target: string, owner?: { uid: number; gid: number }) {
  try {
    const { uid, gid } = owner ?? (await fs.stat(root()));
    const walk = async (p: string) => {
      const st = await fs.lstat(p);
      if (st.uid !== uid || st.gid !== gid) await fs.lchown(p, uid, gid);
      if (st.isDirectory()) {
        for (const name of await fs.readdir(p)) await walk(path.join(p, name));
      }
    };
    await walk(target);
  } catch (error) {
    console.error(`cheatsheets: could not change the owner of ${target}:`, error);
  }
}

/**
 * rm -rf in a child process: fs.rm of a 40,000-page source runs one
 * callback per file on the event loop, back to back, and holds every other
 * request for half a second.
 */
async function removeTree(target: string) {
  try {
    await execFileAsync('rm', ['-rf', '--', target]);
  } catch {
    await fs.rm(target, { recursive: true, force: true });
  }
}

const withRegistryLock = serialQueue();

function updateRegistry<T>(fn: (sources: CheatsheetSource[]) => T | Promise<T>): Promise<T> {
  return withRegistryLock(async () => {
    const sources = await readRegistry();
    const result = await fn(sources);
    await writeRegistry(sources);
    return result;
  });
}

let leftoversCleaned = false;

/** Removes work dirs no download owns and source dirs no registry entry owns (crashes, old races). */
export function cleanLeftovers(): Promise<void> {
  return withRegistryLock(async () => {
    const known = new Set((await readRegistry()).map((s) => s.id));
    const work = await fs.readdir(root(), { withFileTypes: true }).catch(() => []);
    for (const e of work) {
      const id = /^\.tmp-(.+)-\d+$/.exec(e.name)?.[1];
      if (e.isDirectory() && id && !active.has(id)) {
        await removeTree(path.join(root(), e.name));
      }
    }
    const dirs = await fs.readdir(path.join(root(), 'sources'), { withFileTypes: true }).catch(() => []);
    for (const e of dirs) {
      if (e.isDirectory() && !known.has(e.name) && !active.has(e.name)) {
        await removeTree(sourceDir(e.name));
      }
    }
  });
}

export async function listSources(): Promise<CheatsheetSource[]> {
  if (!leftoversCleaned) {
    leftoversCleaned = true;
    await cleanLeftovers().catch((error) => console.error('cheatsheets: cleanup failed:', error));
  }
  const sources = await readRegistry();
  return sources.map((s) =>
    s.status === 'downloading' && !active.has(s.id)
      ? { ...s, status: 'error', error: 'Download was interrupted; run Update again' }
      : s,
  );
}

export async function addSource(url: string, name?: string): Promise<CheatsheetSource> {
  const gh = parseGithubUrl(url);
  let claimed: string | null = null;
  const source = await updateRegistry((sources) => {
    const webUrl = githubWebUrl(gh);
    if (sources.some((s) => s.url.toLowerCase() === webUrl.toLowerCase())) {
      throw new Error('This source has already been added');
    }
    const id = sourceIdFor(gh, (id) => sources.some((s) => s.id === id));
    const userName = cleanSourceName(name ?? '');
    const s: CheatsheetSource = {
      id,
      name: userName || cleanSourceName(defaultSourceName(gh)),
      nameFromUser: !!userName,
      url: webUrl,
      ...gh,
      status: 'downloading',
      error: null,
      fileCount: 0,
      revision: null,
      addedAt: new Date().toISOString(),
      updatedAt: null,
    };
    sources.push(s);
    active.add(id);
    claimed = id;
    return s;
  }).catch((error) => {
    if (claimed) active.delete(claimed);
    throw error;
  });
  startDownload(source.id);
  return source;
}

export async function refreshSource(id: string) {
  // Claimed before the first await so parallel requests can't both pass the check.
  if (active.has(id)) throw new Error('This source is already downloading');
  active.add(id);
  try {
    await updateRegistry((sources) => {
      const s = sources.find((x) => x.id === id);
      if (!s) throw new Error('Source not found');
      s.status = 'downloading';
      s.error = null;
    });
  } catch (error) {
    active.delete(id);
    throw error;
  }
  startDownload(id);
}

export async function removeSource(id: string) {
  if (active.has(id)) throw new Error('Wait for the download to finish first');
  await updateRegistry((sources) => {
    if (active.has(id)) throw new Error('Wait for the download to finish first');
    const i = sources.findIndex((x) => x.id === id);
    if (i === -1) throw new Error('Source not found');
    sources.splice(i, 1);
  });
  indexCache.delete(id);
  await removeTree(sourceDir(id));
}

/** The caller has already added `id` to `active`. */
function startDownload(id: string) {
  downloadSource(id)
    .then((result) =>
      updateRegistry((sources) => {
        const s = sources.find((x) => x.id === id);
        if (!s) return;
        const { title, ...rest } = result;
        if (title && !s.nameFromUser) s.name = title;
        Object.assign(s, rest, {
          status: 'ready',
          error: null,
          updatedAt: new Date().toISOString(),
        });
      }),
    )
    .catch((error) => {
      console.error(`cheatsheets: download of ${id} failed:`, error);
      return updateRegistry((sources) => {
        const s = sources.find((x) => x.id === id);
        if (!s) return;
        s.status = 'error';
        s.error = error instanceof Error ? error.message : String(error);
      });
    })
    .finally(() => {
      active.delete(id);
      return cleanLeftovers().catch(() => undefined);
    });
}

async function fetchArchive(s: CheatsheetSource, dest: string) {
  const url = `https://api.github.com/repos/${s.owner}/${s.repo}/tarball${
    s.ref ? `/${encodeURIComponent(s.ref)}` : ''
  }`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ui-apt-mirror', Accept: 'application/vnd.github+json' },
    redirect: 'follow',
  });
  if (res.status === 404) {
    throw new Error(
      s.ref
        ? `Repository or branch "${s.ref}" not found (private repositories are not supported)`
        : 'Repository not found (private repositories are not supported)',
    );
  }
  if (res.status === 403 || res.status === 429) {
    throw new Error('GitHub rate limit reached; try again later');
  }
  if (!res.ok || !res.body) throw new Error(`GitHub returned HTTP ${res.status}`);

  let bytes = 0;
  const limit = new Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      if (bytes > MAX_ARCHIVE_BYTES) {
        cb(new Error(`Repository archive is larger than ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB`));
      } else cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as any), limit, createWriteStream(dest));
}

/** GNU tar's "escape" quoting (with LC_ALL=C: \\, \n, \ooo for bytes) back to the name. */
export function unescapeTarName(name: string): string {
  if (!name.includes('\\')) return name;
  const bytes: number[] = [];
  const simple: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, '"': 34, "'": 39, '?': 63 };
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (c === '\\' && i + 1 < name.length) {
      const octal = /^[0-7]{3}/.exec(name.slice(i + 1, i + 4));
      if (octal) {
        bytes.push(parseInt(octal[0], 8));
        i += 3;
        continue;
      }
      if (name[i + 1] in simple) {
        bytes.push(simple[name[i + 1]]);
        i += 1;
        continue;
      }
    }
    bytes.push(...Buffer.from(c, 'utf-8'));
  }
  return Buffer.from(bytes).toString('utf-8');
}

interface ExtractionPlan {
  /** As tar lists them (quoted), for tar -T. */
  members: string[];
  bytes: number;
  folderFound: boolean;
}

/**
 * Picks what to unpack from the lines of `tar -tv` (LC_ALL=C, --quoting-style=escape):
 * regular .md files up to MAX_FILE_BYTES and categories.json, inside `folder`
 * of the archive's top directory. Symlinks and other entries are never unpacked.
 */
export function planExtraction(lines: Iterable<string>, folder: string): ExtractionPlan {
  const planner = extractionPlanner(folder);
  for (const line of lines) planner.add(line);
  return planner.plan;
}

const TAR_LINE_RE = /^(\S)\S*\s+\S+\s+(\d+)\s+\d{4}-\d\d-\d\d\s+\d\d:\d\d(?::\d\d)?\s(.*)$/;

/** planExtraction one line at a time, so the listing can be read as tar writes it. */
function extractionPlanner(folder: string) {
  const plan: ExtractionPlan = { members: [], bytes: 0, folderFound: false };
  let prefix: string | null = null;
  let entries = 0;
  const add = (line: string) => {
    const m = TAR_LINE_RE.exec(line);
    if (!m) return;
    if (++entries > MAX_ARCHIVE_ENTRIES) {
      throw new Error(`The repository has more than ${MAX_ARCHIVE_ENTRIES} files; pick a smaller folder`);
    }
    const [, type, size, quoted] = m;
    const name = unescapeTarName(type === 'l' ? quoted.replace(/ -> .*$/, '') : quoted);
    if (prefix === null) {
      const top = name.split('/')[0];
      prefix = folder ? `${top}/${folder}/` : `${top}/`;
    }
    if (!name.startsWith(prefix) && name !== prefix.slice(0, -1)) return;
    plan.folderFound = true;
    if (type !== '-') return;
    const rel = name.slice(prefix.length);
    const wanted = /\.md$/i.test(rel) || rel === 'categories.json';
    if (!wanted || Number(size) > MAX_FILE_BYTES) return;
    plan.members.push(quoted);
    plan.bytes += Number(size);
    if (plan.members.length > MAX_FILES + 1) {
      throw new Error(`More than ${MAX_FILES} markdown files; pick a smaller folder`);
    }
    if (plan.bytes > MAX_EXTRACTED_BYTES) {
      throw new Error(
        `The markdown files are larger than ${MAX_EXTRACTED_BYTES / 1024 / 1024} MB in total; pick a smaller folder`,
      );
    }
  };
  return { add, plan };
}

const TAR_ENV = { ...process.env, LC_ALL: 'C' };

/** Lists the archive with tar and plans what to unpack, without unpacking anything. */
async function listArchive(archive: string, folder: string): Promise<ExtractionPlan> {
  const tar = spawn('tar', ['-tvzf', archive, '--numeric-owner', '--quoting-style=escape', '--full-time'], {
    env: TAR_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  tar.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
  const exited = new Promise<number | null>((resolve, reject) => {
    tar.on('error', reject);
    tar.on('close', resolve);
  });
  try {
    const lines = createInterface({ input: tar.stdout, crlfDelay: Infinity });
    const planner = extractionPlanner(folder);
    // Lines come a pipe buffer at a time, so other requests get turns in between.
    for await (const line of lines) planner.add(line);
    const { plan } = planner;
    const code = await exited;
    if (code !== 0) throw new Error(`Could not read the repository archive: ${stderr.trim() || `tar exited ${code}`}`);
    return plan;
  } finally {
    if (tar.exitCode === null) tar.kill();
  }
}

async function collectMarkdown(base: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, rel: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      // Symlinks are skipped: Dirent types come from lstat.
      if (e.isDirectory()) {
        await walk(path.join(dir, e.name), relPath);
      } else if (
        e.isFile() &&
        /\.md$/i.test(e.name) &&
        !SKIP_FILES.has(e.name.toLowerCase()) &&
        isSafeRelativeMdPath(relPath)
      ) {
        out.push(relPath);
        if (out.length > MAX_FILES) {
          throw new Error(`More than ${MAX_FILES} markdown files; pick a smaller folder`);
        }
      }
    }
  };
  await walk(base, '');
  return out;
}

async function downloadSource(id: string) {
  const s = (await readRegistry()).find((x) => x.id === id);
  if (!s) throw new Error('Source not found');

  const work = path.join(root(), `.tmp-${id}-${Date.now()}`);
  const extract = path.join(work, 'extract');
  const staged = path.join(work, 'staged');
  try {
    await fs.mkdir(extract, { recursive: true });
    const archive = path.join(work, 'archive.tar.gz');
    await fetchArchive(s, archive);
    // Only what is used is unpacked, and only after its size is known: a
    // repository that compresses well could otherwise fill the disk.
    const plan = await listArchive(archive, s.path);
    if (!plan.folderFound) throw new Error(`Folder "${s.path}" not found in the repository`);
    if (!plan.members.length) throw new Error('No markdown (.md) files found in this location');
    const memberList = path.join(work, 'members.txt');
    await fs.writeFile(memberList, plan.members.join('\n') + '\n');
    await execFileAsync(
      'tar',
      ['-xzf', archive, '-C', extract, '--no-same-owner', '--no-same-permissions', '--no-wildcards', '-T', memberList],
      { env: TAR_ENV },
    );
    await fs.rm(archive, { force: true });

    // Single top folder: <owner>-<repo>-<sha>.
    const [top] = await fs.readdir(extract);
    if (!top) throw new Error('Downloaded archive is empty');
    const revision = top.split('-').pop() || null;
    const repoRoot = path.join(extract, top);
    const base = path.resolve(repoRoot, s.path);
    if (base !== repoRoot && !base.startsWith(repoRoot + path.sep)) {
      throw new Error('Invalid folder path');
    }
    const stat = await fs.lstat(base).catch(() => null);
    if (!stat?.isDirectory()) throw new Error(`Folder "${s.path}" not found in the repository`);

    const files = await collectMarkdown(base);
    if (!files.length) throw new Error('No markdown (.md) files found in this location');

    let explicit: Map<string, string[]> | null = null;
    try {
      explicit = parseCategoriesJson(
        JSON.parse(await fs.readFile(path.join(base, 'categories.json'), 'utf-8')),
      );
    } catch {
      explicit = null;
    }

    const index: IndexEntry[] = [];
    for (const rel of files) {
      const src = path.join(base, rel);
      const st = await fs.stat(src);
      if (st.size > MAX_FILE_BYTES) continue;
      const markdown = await fs.readFile(src, 'utf-8');
      const dest = path.join(staged, 'files', rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, markdown);
      index.push({
        path: rel,
        title: extractTitle(markdown, rel),
        categories: categoriesFor(rel, explicit),
        text: markdownToText(markdown).slice(0, MAX_INDEXED_TEXT),
        headings: extractHeadings(markdown),
      });
    }
    await writeIndex(path.join(staged, 'index.json'), index);
    await giveTreeToOwner(staged);

    // Swap only once complete, so a failed update keeps the old copy.
    await mkdirOwned(path.join(root(), 'sources'));
    const old = path.join(work, 'old');
    await updateRegistry(async (sources) => {
      if (!sources.some((x) => x.id === id)) throw new Error('Source was removed');
      await fs.rename(sourceDir(id), old).catch(() => undefined);
      await fs.rename(staged, sourceDir(id));
    });
    indexCache.delete(id);

    let title: string | null = null;
    try {
      const readme = await fs.readFile(path.join(base, 'README.md'), 'utf-8');
      title = cleanSourceName(readme.match(/^#[ \t]+(.+?)[ \t#]*$/m)?.[1] ?? '') || null;
    } catch {}

    return { fileCount: index.length, revision, title };
  } finally {
    await removeTree(work);
  }
}

// Promises, so parallel first searches read and prepare an index only once.
const indexCache = new Map<string, { mtimeMs: number; entries: Promise<IndexEntry[]> }>();

export async function loadIndex(id: string): Promise<IndexEntry[]> {
  const p = indexPath(id);
  const st = await fs.stat(p).catch(() => null);
  if (!st) return [];
  const cached = indexCache.get(id);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.entries;
  const entries = (async () => {
    try {
      return await parseIndex(await fs.readFile(p, 'utf-8'));
    } catch {
      return [];
    }
  })();
  indexCache.set(id, { mtimeMs: st.mtimeMs, entries });
  return entries;
}

const INDEX_SLICE_MS = 10;
const yieldToOthers = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * index.json is a JSON array with one page per line, written and read a few
 * pages at a time: one JSON.stringify or JSON.parse of a 40,000-page index
 * blocks every request for a second or more.
 */
export async function writeIndex(file: string, entries: IndexEntry[]) {
  const handle = await fs.open(file, 'w');
  try {
    let chunk = '[\n';
    let sliceStart = performance.now();
    for (let i = 0; i < entries.length; i++) {
      chunk += JSON.stringify(entries[i]) + (i < entries.length - 1 ? ',\n' : '\n');
      if (chunk.length > 1 << 20 || performance.now() - sliceStart > INDEX_SLICE_MS) {
        await handle.write(chunk);
        chunk = '';
        await yieldToOthers();
        sliceStart = performance.now();
      }
    }
    await handle.write(chunk + ']\n');
  } finally {
    await handle.close();
  }
}

export async function parseIndex(text: string): Promise<IndexEntry[]> {
  // Any other JSON array (written by hand, or by a test) is read in one go.
  if (!text.startsWith('[\n')) return JSON.parse(text) as IndexEntry[];
  const entries: IndexEntry[] = [];
  let sliceStart = performance.now();
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end).replace(/,$/, '');
    start = end + 1;
    if (line === '[' || line === ']' || !line) continue;
    entries.push(JSON.parse(line) as IndexEntry);
    if ((entries.length & 63) === 0 && performance.now() - sliceStart > INDEX_SLICE_MS) {
      await yieldToOthers();
      sliceStart = performance.now();
    }
  }
  return entries;
}

export async function categoryCounts(id: string): Promise<{ name: string; count: number }[]> {
  const counts = new Map<string, number>();
  for (const e of await loadIndex(id)) {
    for (const c of e.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function readPage(id: string, relPath: string): Promise<string | null> {
  if (!/^[a-z0-9-]+$/.test(id) || !isSafeRelativeMdPath(relPath)) return null;
  const base = filesDir(id);
  const full = path.resolve(base, relPath);
  if (!full.startsWith(base + path.sep)) return null;
  const st = await fs.lstat(full).catch(() => null);
  if (!st?.isFile()) return null;
  return fs.readFile(full, 'utf-8');
}

// Decided by the host nginx routed the request to, never by client headers such as Referer.
export function isPublicCheatsheetsRequest(request: Request): boolean {
  return new URL(request.url).hostname.startsWith('cheatsheets');
}
