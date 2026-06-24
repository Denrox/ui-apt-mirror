import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import appConfig from '~/config/config.json';
import { atomicWriteFile } from '~/utils/mirror-list';
import {
  assertValidHost,
  getKey,
  signReleasesForHost,
  type GpgKeyRecord,
} from '~/lib/gpg';

const execFileAsync = promisify(execFile);

/**
 * A locally hosted APT repository: uploaded .deb packages served as a real,
 * apt-installable repo. Lives under the mirror root at <mirrorRoot>/<host>, so
 * nginx serves it and the existing per-host GPG signer can sign its Release.
 */
export interface LocalRepo {
  host: string; // e.g. "team.local" — dir name under mirrorRoot AND gpg host id
  suite: string; // e.g. "stable"
  components: string[]; // e.g. ["main"]
  arches: string[]; // binary arches, e.g. ["amd64"]
  origin: string;
  label: string;
  createdAt: string;
}

export interface LocalRepoPackage {
  component: string;
  filename: string;
  size: number;
}

export interface CreateLocalRepoInput {
  name: string; // bare name; host becomes "<name>.local"
  suite: string;
  components: string[];
  arches: string[];
  origin?: string;
  label?: string;
}

const HOST_SUFFIX = '.local';
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const TOKEN_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function getMirrorRootAbs(): string {
  return path.resolve(appConfig.mirrorRoot);
}

export function getMirrorDomain(): string {
  const mirrorHost = appConfig.hosts.find((host) => host.id === 'mirror');
  return mirrorHost?.address ?? 'mirror.intra';
}

/** Absolute on-disk path for a repo, guarded against path traversal. */
function repoDirFor(host: string): string {
  assertValidHost(host);
  const root = getMirrorRootAbs();
  const dir = path.resolve(root, host);
  if (dir !== path.join(root, host) || !dir.startsWith(root + path.sep)) {
    throw new Error(`Unsafe repository host: ${host}`);
  }
  return dir;
}

function assertToken(value: string, kind: string): void {
  if (!value || value.length > 64 || !TOKEN_RE.test(value)) {
    throw new Error(`Invalid ${kind}: ${value}`);
  }
}

function assertDebFilename(filename: string): void {
  if (
    !filename ||
    filename.length > 255 ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.startsWith('.') ||
    !filename.toLowerCase().endsWith('.deb') ||
    /[<>:"|?*\x00-\x1f]/.test(filename)
  ) {
    throw new Error(`Invalid .deb filename: ${filename}`);
  }
}

async function readIndex(): Promise<LocalRepo[]> {
  try {
    const raw = await fs.readFile(appConfig.localReposIndex, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalRepo[]) : [];
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeIndex(repos: LocalRepo[]): Promise<void> {
  await fs.mkdir(path.dirname(appConfig.localReposIndex), { recursive: true });
  await atomicWriteFile(
    appConfig.localReposIndex,
    JSON.stringify(repos, null, 2),
  );
}

export async function listRepos(): Promise<LocalRepo[]> {
  return readIndex();
}

export async function getRepo(host: string): Promise<LocalRepo | null> {
  const repos = await readIndex();
  return repos.find((r) => r.host === host) ?? null;
}

/** Rebuild Packages/Release for a repo, then re-sign if it has a GPG key. */
export async function publishRepo(host: string): Promise<void> {
  const repo = await getRepo(host);
  if (!repo) throw new Error(`Local repository ${host} not found`);
  const repoDir = repoDirFor(host);

  await execFileAsync(appConfig.localRepoScriptPath, [
    'publish',
    repoDir,
    repo.suite,
    repo.components.join(' '),
    repo.arches.join(' '),
    repo.origin,
    repo.label,
  ]);

  const key = await getKey(host).catch(() => null);
  if (key) {
    await signReleasesForHost(host);
  }
}

export async function createRepo(
  input: CreateLocalRepoInput,
): Promise<LocalRepo> {
  const name = (input.name ?? '').trim().toLowerCase();
  if (!name || name.length > 50 || !NAME_RE.test(name)) {
    throw new Error(
      'Name must be lowercase letters, digits and hyphens (e.g. "team-tools")',
    );
  }
  const host = `${name}${HOST_SUFFIX}`;

  const suite = (input.suite ?? '').trim();
  assertToken(suite, 'suite');

  const components = (input.components ?? []).map((c) => c.trim()).filter(Boolean);
  const arches = (input.arches ?? []).map((a) => a.trim()).filter(Boolean);
  if (!components.length) throw new Error('At least one component is required');
  if (!arches.length) throw new Error('At least one architecture is required');
  components.forEach((c) => assertToken(c, 'component'));
  arches.forEach((a) => assertToken(a, 'architecture'));

  const repos = await readIndex();
  if (repos.some((r) => r.host === host)) {
    throw new Error(`A local repository named "${name}" already exists`);
  }

  const repo: LocalRepo = {
    host,
    suite,
    components,
    arches,
    origin: (input.origin ?? '').trim() || `Local Repository ${name}`,
    label: (input.label ?? '').trim() || name,
    createdAt: new Date().toISOString(),
  };

  // Create the directory skeleton before registering + publishing.
  const repoDir = repoDirFor(host);
  for (const comp of components) {
    await fs.mkdir(path.join(repoDir, 'pool', comp), { recursive: true });
    for (const arch of arches) {
      await fs.mkdir(
        path.join(repoDir, 'dists', suite, comp, `binary-${arch}`),
        { recursive: true },
      );
    }
  }

  repos.push(repo);
  await writeIndex(repos);

  await publishRepo(host);
  return repo;
}

export async function deleteRepo(host: string): Promise<void> {
  const repos = await readIndex();
  const next = repos.filter((r) => r.host !== host);
  if (next.length === repos.length) {
    throw new Error(`Local repository ${host} not found`);
  }
  await writeIndex(next);

  const repoDir = repoDirFor(host);
  await fs.rm(repoDir, { recursive: true, force: true });

  // Best-effort GPG key cleanup so a re-created repo of the same name is clean.
  try {
    const { deleteKey } = await import('~/lib/gpg');
    await deleteKey(host);
  } catch {
    // ignore — key may not exist
  }
}

export async function listPackages(host: string): Promise<LocalRepoPackage[]> {
  const repo = await getRepo(host);
  if (!repo) return [];
  const repoDir = repoDirFor(host);
  const packages: LocalRepoPackage[] = [];

  for (const component of repo.components) {
    const poolDir = path.join(repoDir, 'pool', component);
    let entries: string[] = [];
    try {
      entries = await fs.readdir(poolDir);
    } catch {
      continue;
    }
    for (const filename of entries) {
      if (!filename.toLowerCase().endsWith('.deb')) continue;
      try {
        const stat = await fs.stat(path.join(poolDir, filename));
        if (stat.isFile()) {
          packages.push({ component, filename, size: stat.size });
        }
      } catch {
        // skip unreadable entries
      }
    }
  }
  return packages;
}

/** Absolute pool directory for uploads, creating it if needed. */
export async function ensurePoolDir(
  host: string,
  component: string,
): Promise<string> {
  const repo = await getRepo(host);
  if (!repo) throw new Error(`Local repository ${host} not found`);
  assertToken(component, 'component');
  if (!repo.components.includes(component)) {
    throw new Error(`Unknown component "${component}" for ${host}`);
  }
  const dir = path.join(repoDirFor(host), 'pool', component);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function deletePackage(
  host: string,
  component: string,
  filename: string,
): Promise<void> {
  const repo = await getRepo(host);
  if (!repo) throw new Error(`Local repository ${host} not found`);
  assertToken(component, 'component');
  assertDebFilename(filename);
  if (!repo.components.includes(component)) {
    throw new Error(`Unknown component "${component}" for ${host}`);
  }
  await fs.rm(path.join(repoDirFor(host), 'pool', component, filename), {
    force: true,
  });
  await publishRepo(host);
}

/** deb822 sources snippet shown to clients. */
export function sourcesSnippet(
  repo: LocalRepo,
  gpgKey: GpgKeyRecord | null,
): string {
  const domain = getMirrorDomain();
  const lines = [
    `Types: deb`,
    `URIs: http://${domain}/${repo.host}`,
    `Suites: ${repo.suite}`,
    `Components: ${repo.components.join(' ')}`,
  ];
  if (gpgKey) {
    lines.unshift(
      `# Install key: curl -fsSL http://admin.${domain}/api/pubkey/${repo.host} | sudo tee /etc/apt/keyrings/${repo.host}.asc > /dev/null`,
    );
    lines.push(`Signed-By: /etc/apt/keyrings/${repo.host}.asc`);
  } else {
    lines.push(`Trusted: yes`);
  }
  return lines.join('\n');
}

export { assertDebFilename };
