// cheatsheetsDir/sources.json lists the sources; each one's content lives in
// sources/<id>/files and its search index in sources/<id>/index.json.

import { execFile } from 'child_process';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import appConfig from '~/config/config.json';
import {
  categoriesFor,
  defaultSourceName,
  extractTitle,
  githubWebUrl,
  isSafeRelativeMdPath,
  markdownToText,
  parseCategoriesJson,
  parseGithubUrl,
  slugify,
  type IndexEntry,
} from './cheatsheets';

const execFileAsync = promisify(execFile);

export interface CheatsheetSource {
  id: string;
  name: string;
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
let registryLock: Promise<unknown> = Promise.resolve();

async function readRegistry(): Promise<CheatsheetSource[]> {
  try {
    const data = JSON.parse(await fs.readFile(registryPath(), 'utf-8'));
    return Array.isArray(data?.sources) ? data.sources : [];
  } catch {
    return [];
  }
}

async function writeRegistry(sources: CheatsheetSource[]) {
  await fs.mkdir(root(), { recursive: true });
  const tmp = `${registryPath()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ sources }, null, 2));
  await fs.rename(tmp, registryPath());
}

function updateRegistry<T>(fn: (sources: CheatsheetSource[]) => T | Promise<T>): Promise<T> {
  const run = registryLock.then(async () => {
    const sources = await readRegistry();
    const result = await fn(sources);
    await writeRegistry(sources);
    return result;
  });
  registryLock = run.catch(() => undefined);
  return run;
}

export async function listSources(): Promise<CheatsheetSource[]> {
  const sources = await readRegistry();
  return sources.map((s) =>
    s.status === 'downloading' && !active.has(s.id)
      ? { ...s, status: 'error', error: 'Download was interrupted; run Update again' }
      : s,
  );
}

export async function addSource(url: string, name?: string): Promise<CheatsheetSource> {
  const gh = parseGithubUrl(url);
  const source = await updateRegistry((sources) => {
    const webUrl = githubWebUrl(gh);
    if (sources.some((s) => s.url.toLowerCase() === webUrl.toLowerCase())) {
      throw new Error('This source has already been added');
    }
    const base = slugify(`${gh.owner}-${gh.repo}${gh.path ? `-${gh.path}` : ''}`);
    let id = base;
    for (let n = 2; sources.some((s) => s.id === id); n++) id = `${base}-${n}`;
    const s: CheatsheetSource = {
      id,
      name: name?.trim() || defaultSourceName(gh),
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
    return s;
  });
  startDownload(source.id);
  return source;
}

export async function refreshSource(id: string) {
  if (active.has(id)) throw new Error('This source is already downloading');
  await updateRegistry((sources) => {
    const s = sources.find((x) => x.id === id);
    if (!s) throw new Error('Source not found');
    s.status = 'downloading';
    s.error = null;
  });
  startDownload(id);
}

export async function removeSource(id: string) {
  if (active.has(id)) throw new Error('Wait for the download to finish first');
  await updateRegistry((sources) => {
    const i = sources.findIndex((x) => x.id === id);
    if (i === -1) throw new Error('Source not found');
    sources.splice(i, 1);
  });
  indexCache.delete(id);
  await fs.rm(sourceDir(id), { recursive: true, force: true });
}

function startDownload(id: string) {
  active.add(id);
  downloadSource(id)
    .then((result) =>
      updateRegistry((sources) => {
        const s = sources.find((x) => x.id === id);
        if (!s) return;
        Object.assign(s, result, {
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
    .finally(() => active.delete(id));
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
    await execFileAsync('tar', ['-xzf', archive, '-C', extract, '--no-same-owner', '--no-same-permissions']);
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
      });
    }
    await fs.writeFile(path.join(staged, 'index.json'), JSON.stringify(index));

    // Swap only once complete, so a failed update keeps the old copy.
    await fs.mkdir(path.join(root(), 'sources'), { recursive: true });
    const old = path.join(work, 'old');
    await fs.rename(sourceDir(id), old).catch(() => undefined);
    await fs.rename(staged, sourceDir(id));
    indexCache.delete(id);

    return { fileCount: index.length, revision };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

const indexCache = new Map<string, { mtimeMs: number; entries: IndexEntry[] }>();

export async function loadIndex(id: string): Promise<IndexEntry[]> {
  const p = indexPath(id);
  const st = await fs.stat(p).catch(() => null);
  if (!st) return [];
  const cached = indexCache.get(id);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.entries;
  try {
    const entries = JSON.parse(await fs.readFile(p, 'utf-8')) as IndexEntry[];
    indexCache.set(id, { mtimeMs: st.mtimeMs, entries });
    return entries;
  } catch {
    return [];
  }
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

export function isPublicCheatsheetsRequest(request: Request): boolean {
  if (new URL(request.url).hostname.startsWith('cheatsheets')) return true;
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    return new URL(referer).hostname.startsWith('cheatsheets');
  } catch {
    return false;
  }
}
