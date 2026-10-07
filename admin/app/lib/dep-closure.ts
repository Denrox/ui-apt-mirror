import zlib from 'zlib';
import { spawn } from 'child_process';
import { checkUpstreamUrl, fetchUpstream, UpstreamFetchError } from './upstream-fetch';
import { isPathToken } from '~/utils/mirror-config';

/**
 * Dependency-closure resolver for apt repositories.
 *
 * Given seed package names, it fetches the upstream `Packages` indices for the
 * requested suite/components/architecture, builds the dependency graph, and
 * returns the full set of binary package names needed to install the seeds.
 *
 * The closure is a deliberate **superset**: for an OR-dependency (`a | b`) it
 * keeps *all* alternatives, and a virtual dependency pulls in *all* providers.
 * Over-inclusion only makes the mirror slightly larger; under-inclusion would
 * break `apt install`, so we err toward including more. Feed the result into
 * the repo's `include_binary_packages` filter.
 */

export interface ClosureOptions {
  /** Upstream base URL, e.g. http://deb.debian.org/debian */
  baseUrl: string;
  suite: string;
  components: string[];
  /** Binary architectures to resolve for, e.g. ['i386']. */
  arches: string[];
  /** Seed package names (a trailing :arch is ignored). */
  seeds: string[];
  /** Also follow Recommends (bigger closure; needed for a default apt install). */
  includeRecommends?: boolean;
  /** Safety cap on closure size. */
  maxPackages?: number;
}

export interface ClosureResult {
  /** Resolved binary package names (sorted), including the seeds. */
  packages: string[];
  /** Seeds that were not found in any index. */
  missingSeeds: string[];
  /** Total distinct packages seen across the loaded indices. */
  indexSize: number;
  /** True if the closure hit `maxPackages` and may be incomplete. */
  truncated: boolean;
}

export interface PkgInfo {
  deps: string[]; // flattened Depends + Pre-Depends (+ Recommends) candidate names
}

export interface DepGraph {
  pkgs: Map<string, PkgInfo>;
  provides: Map<string, Set<string>>;
}

const stripName = (token: string): string =>
  token
    .trim()
    .split(/[\s([]/, 1)[0] // up to first space, '(' or '['
    .split(':')[0] // drop :arch / :any
    .trim();

/** Flatten a dependency field into every candidate name (all alternatives). */
function relationNames(field: string | undefined): string[] {
  if (!field) return [];
  const names: string[] = [];
  for (const group of field.split(',')) {
    for (const alt of group.split('|')) {
      const name = stripName(alt);
      if (name) names.push(name);
    }
  }
  return names;
}

const FETCH_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const MAX_INDEX_BYTES = 512 * 1024 * 1024;

async function gunzip(buf: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    zlib.gunzip(buf, { maxOutputLength: MAX_INDEX_BYTES }, (err, out) =>
      err ? reject(err) : resolve(out),
    ),
  );
}

/** Decompress an .xz buffer by piping it through the `xz` binary. */
async function unxz(buf: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('xz', ['-dc']);
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on('data', (c) => {
      size += c.length;
      if (size > MAX_INDEX_BYTES) child.kill();
      else chunks.push(c);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`xz exited with ${code}`)),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(buf);
  });
}

/** Fetch and decompress one Packages index; returns null if unavailable. */
async function fetchIndex(
  baseUrl: string,
  suite: string,
  component: string,
  arch: string,
): Promise<string | null> {
  const dir = `${baseUrl.replace(/\/+$/, '')}/dists/${suite}/${component}/binary-${arch}`;
  const candidates: Array<{ url: string; kind: 'gz' | 'xz' | 'raw' }> = [
    { url: `${dir}/Packages.gz`, kind: 'gz' },
    { url: `${dir}/Packages.xz`, kind: 'xz' },
    { url: `${dir}/Packages`, kind: 'raw' },
  ];
  for (const { url, kind } of candidates) {
    try {
      const buf = await fetchUpstream(url, {
        timeoutMs: FETCH_TIMEOUT_MS,
        maxBytes: MAX_DOWNLOAD_BYTES,
      });
      if (!buf) continue;
      if (kind === 'gz') return (await gunzip(buf)).toString('utf-8');
      if (kind === 'xz') return (await unxz(buf)).toString('utf-8');
      return buf.toString('utf-8');
    } catch (err) {
      // A refused address, timeout or oversized answer would repeat for every variant
      if (err instanceof UpstreamFetchError) throw err;
    }
  }
  return null;
}

/** Parse a Packages file, merging into the graph's name→info and provides maps. */
export function parsePackages(
  text: string,
  graph: DepGraph,
  includeRecommends: boolean,
): void {
  const { pkgs, provides } = graph;
  for (const stanza of text.split(/\n\n+/)) {
    if (!stanza.trim()) continue;
    const fields: Record<string, string> = {};
    let current = '';
    for (const line of stanza.split('\n')) {
      if (/^\s/.test(line)) {
        if (current) fields[current] += ' ' + line.trim();
      } else {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        current = line.slice(0, idx).toLowerCase();
        fields[current] = line.slice(idx + 1).trim();
      }
    }
    const name = fields['package'];
    if (!name) continue;

    const deps = [
      ...relationNames(fields['pre-depends']),
      ...relationNames(fields['depends']),
      ...(includeRecommends ? relationNames(fields['recommends']) : []),
    ];
    // Last stanza wins for duplicate names across components (fine for closure).
    pkgs.set(name, { deps });

    for (const prov of relationNames(fields['provides'])) {
      if (!provides.has(prov)) provides.set(prov, new Set());
      provides.get(prov)!.add(name);
    }
  }
}

/**
 * Walk the dependency graph from `seeds`, including all OR-alternatives and
 * every provider of a virtual package. Pure (no I/O) for testability.
 */
export function closureFromGraph(
  graph: DepGraph,
  seeds: string[],
  maxPackages = 5000,
): { packages: string[]; missingSeeds: string[]; truncated: boolean } {
  const { pkgs, provides } = graph;
  const seedNames = seeds.map(stripName).filter(Boolean);
  const missingSeeds = seedNames.filter(
    (s) => !pkgs.has(s) && !provides.has(s),
  );

  const resolved = new Set<string>();
  const queue: string[] = [...seedNames];
  let truncated = false;

  while (queue.length) {
    const name = queue.shift()!;
    if (resolved.has(name)) continue;

    // A virtual package: enqueue every provider, don't add the virtual name.
    if (!pkgs.has(name)) {
      const providers = provides.get(name);
      if (providers) for (const p of providers) queue.push(p);
      continue;
    }

    resolved.add(name);
    if (resolved.size >= maxPackages) {
      truncated = true;
      break;
    }
    for (const dep of pkgs.get(name)!.deps) {
      if (!resolved.has(dep)) queue.push(dep);
    }
  }

  return {
    packages: Array.from(resolved).sort((a, b) => a.localeCompare(b)),
    missingSeeds,
    truncated,
  };
}

/** Why the options cannot be resolved (bad URL, path traversal), or null. */
export function closureOptionsError(opts: ClosureOptions): string | null {
  try {
    checkUpstreamUrl(opts.baseUrl);
  } catch (err) {
    return (err as Error).message;
  }
  if (/[?#]/.test(opts.baseUrl)) return 'Base URL cannot contain a query or fragment';
  const tokens = [opts.suite, ...opts.components, ...opts.arches];
  if (!tokens.every(isPathToken)) {
    return 'Suites, components and architectures may only contain letters, digits and . _ - + ~ / (no "..")';
  }
  return null;
}

/** Resolve the dependency closure of `seeds` against the upstream indices. */
export async function resolveClosure(
  opts: ClosureOptions,
): Promise<ClosureResult> {
  const graph: DepGraph = { pkgs: new Map(), provides: new Map() };

  for (const component of opts.components) {
    // binary-all holds Architecture: all packages shared by every arch.
    for (const arch of [...opts.arches, 'all']) {
      const text = await fetchIndex(opts.baseUrl, opts.suite, component, arch);
      if (text) parsePackages(text, graph, !!opts.includeRecommends);
    }
  }

  const { packages, missingSeeds, truncated } = closureFromGraph(
    graph,
    opts.seeds,
    opts.maxPackages ?? 5000,
  );

  return { packages, missingSeeds, indexSize: graph.pkgs.size, truncated };
}
