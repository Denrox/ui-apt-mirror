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
/**
 * Most component × architecture combinations one resolve may load (each also loads binary-all):
 * the stock component sets of Debian and Ubuntu (4 components) for up to 4 architectures. This
 * bounds the downloads; memory is bounded by MAX_GRAPH_ENTRIES.
 */
const MAX_INDEX_COMBINATIONS = 16;
/**
 * Most entries (packages, the names in their dependency fields, providers of virtual packages)
 * the graph of one resolve may hold. Packages of the same name in several indices are one entry,
 * so more architectures add little: all 4 components of Debian trixie with Recommends take about
 * 570,000 for amd64 and i386 and 580,000 with arm64 and armhf too (about 125 MB of heap), Ubuntu
 * noble about 550,000. The cap keeps a resolve's graph to a few hundred MB.
 */
const MAX_GRAPH_ENTRIES = 2_000_000;

/** Thrown when the indices of one resolve hold more than MAX_GRAPH_ENTRIES. */
export class ResolveTooLargeError extends Error {}

/** How many entries a resolve's graph holds, shared by the parsers of its indices. */
interface GraphBudget {
  entries: number;
  max: number;
}

// Only these fields of a stanza matter for the closure; the rest is skipped unread.
const WANTED_FIELDS = new Set(['package', 'depends', 'pre-depends', 'recommends', 'provides']);
const NEWLINE = 0x0a;
/**
 * Longest line, and longest kept field with its continuation lines, of an index. Real ones are a
 * few KB at most (the Provides of some Rust library packages: tens of KB).
 */
export const MAX_LINE_BYTES = 1024 * 1024;

/** An index that is too large, or has a line that is too long, to be read. */
export class IndexLimitError extends UpstreamFetchError {}

/**
 * Parses a Packages index chunk by chunk, keeping only the fields the closure needs. The
 * decompressed index (hundreds of MB for Debian main) is never held in memory as a whole,
 * and every kept value is a new string, not a slice that would keep a whole chunk alive.
 * Every byte is looked at once: the unfinished line at the end of a chunk is kept as a list of
 * parts and joined only when its newline arrives.
 */
export class PackagesParser {
  private partial: Buffer[] = [];
  private partialBytes = 0;
  private fields: Record<string, string> = {};
  private current: string | null = null;

  constructor(
    private readonly graph: DepGraph,
    private readonly includeRecommends: boolean,
    private readonly budget: GraphBudget = { entries: 0, max: MAX_GRAPH_ENTRIES },
  ) {}

  /** Parse the next chunk; throws an IndexLimitError on a line longer than MAX_LINE_BYTES. */
  push(chunk: Buffer): void {
    let start = 0;
    let nl = chunk.indexOf(NEWLINE);
    if (this.partialBytes > 0 && nl !== -1) {
      this.keep(chunk.subarray(0, nl));
      const line = this.takePartial();
      this.line(line, 0, line.length);
      start = nl + 1;
      nl = chunk.indexOf(NEWLINE, start);
    }
    for (; nl !== -1; nl = chunk.indexOf(NEWLINE, start)) {
      this.line(chunk, start, nl);
      start = nl + 1;
    }
    if (start < chunk.length) this.keep(chunk.subarray(start));
  }

  end(): void {
    if (this.partialBytes > 0) {
      const line = this.takePartial();
      this.line(line, 0, line.length);
    }
    this.finish();
  }

  private keep(part: Buffer): void {
    this.partialBytes += part.length;
    if (this.partialBytes > MAX_LINE_BYTES) throw new IndexLimitError('A line of the package index is too long');
    this.partial.push(Buffer.from(part));
  }

  private takePartial(): Buffer {
    const line = Buffer.concat(this.partial, this.partialBytes);
    this.partial = [];
    this.partialBytes = 0;
    return line;
  }

  private line(buf: Buffer, start: number, end: number): void {
    if (end > start && buf[end - 1] === 0x0d) end--;
    if (end === start) {
      this.finish();
      return;
    }
    const first = buf[start];
    if (first === 0x20 || first === 0x09) {
      if (!this.current) return;
      const value = this.fields[this.current] + ' ' + buf.toString('utf8', start, end).trim();
      if (value.length > MAX_LINE_BYTES) throw new IndexLimitError('A field of the package index is too long');
      this.fields[this.current] = value;
      return;
    }
    const colon = buf.indexOf(0x3a, start);
    if (colon === -1 || colon > end) {
      this.current = null;
      return;
    }
    const name = buf.toString('latin1', start, colon).toLowerCase();
    if (!WANTED_FIELDS.has(name)) {
      this.current = null;
      return;
    }
    this.current = name;
    this.fields[name] = buf.toString('utf8', colon + 1, end).trim();
  }

  private finish(): void {
    const fields = this.fields;
    this.fields = {};
    this.current = null;
    const name = fields['package'];
    if (!name) return;

    const { pkgs, provides } = this.graph;
    const deps = [
      ...relationNames(fields['pre-depends']),
      ...relationNames(fields['depends']),
      ...(this.includeRecommends ? relationNames(fields['recommends']) : []),
    ];
    // Last stanza wins for duplicate names across components (fine for closure).
    const replaced = pkgs.get(name);
    this.count(1 + deps.length - (replaced ? 1 + replaced.deps.length : 0));
    pkgs.set(name, { deps });

    for (const prov of relationNames(fields['provides'])) {
      let providers = provides.get(prov);
      if (!providers) {
        providers = new Set();
        provides.set(prov, providers);
        this.count(1);
      }
      if (!providers.has(name)) {
        providers.add(name);
        this.count(1);
      }
    }
  }

  private count(entries: number): void {
    this.budget.entries += entries;
    if (this.budget.entries > this.budget.max) {
      throw new ResolveTooLargeError(
        'These package indices are too large to resolve at once; select fewer components or architectures',
      );
    }
  }
}

/** Decompress a .gz buffer into the parser, in chunks. */
function gunzipInto(buf: Buffer, parser: PackagesParser): Promise<void> {
  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    let size = 0;
    gunzip.on('data', (chunk: Buffer) => {
      size += chunk.length;
      try {
        if (size > MAX_INDEX_BYTES) throw new IndexLimitError('A package index is too large');
        parser.push(chunk);
      } catch (err) {
        gunzip.destroy(err as Error);
      }
    });
    gunzip.on('error', reject);
    gunzip.on('end', resolve);
    gunzip.end(buf);
  });
}

/** Decompress an .xz buffer into the parser by piping it through the `xz` binary. */
function unxzInto(buf: Buffer, parser: PackagesParser): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('xz', ['-dc']);
    let size = 0;
    let failed: Error | null = null;
    child.stdout.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      try {
        if (size > MAX_INDEX_BYTES) throw new IndexLimitError('A package index is too large');
        parser.push(chunk);
      } catch (err) {
        failed = err as Error;
        child.kill();
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (failed) reject(failed);
      else if (code === 0) resolve();
      else reject(new Error(`xz exited with ${code}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(buf);
  });
}

/** Fetch one Packages index and parse it into the graph; false if unavailable. */
async function loadIndex(
  baseUrl: string,
  suite: string,
  component: string,
  arch: string,
  graph: DepGraph,
  includeRecommends: boolean,
  budget: GraphBudget,
): Promise<boolean> {
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
      const parser = new PackagesParser(graph, includeRecommends, budget);
      if (kind === 'gz') await gunzipInto(buf, parser);
      else if (kind === 'xz') await unxzInto(buf, parser);
      else parser.push(buf);
      parser.end();
      return true;
    } catch (err) {
      // A refused address, timeout or oversized answer or index would repeat for every variant
      if (err instanceof UpstreamFetchError || err instanceof ResolveTooLargeError) throw err;
    }
  }
  return false;
}

/** Parse a Packages file, merging into the graph's name→info and provides maps. */
export function parsePackages(
  text: string,
  graph: DepGraph,
  includeRecommends: boolean,
): void {
  const parser = new PackagesParser(graph, includeRecommends);
  parser.push(Buffer.from(text, 'utf8'));
  parser.end();
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
  if (opts.components.length * opts.arches.length > MAX_INDEX_COMBINATIONS) {
    return `Resolve at most ${MAX_INDEX_COMBINATIONS} component × architecture combinations at once (for example 4 components × 4 architectures)`;
  }
  const tokens = [opts.suite, ...opts.components, ...opts.arches];
  if (!tokens.every(isPathToken)) {
    return 'Suites, components and architectures may only contain letters, digits and . _ - + ~ / (no "..")';
  }
  return null;
}

/** Thrown when too many resolves are already running or waiting. */
export class ResolveBusyError extends Error {}

const MAX_WAITING_RESOLVES = 2;
let resolveQueue: Promise<unknown> = Promise.resolve();
let pendingResolves = 0;

/**
 * Run resolves one at a time: each loads whole package indices, and several at once (two tabs)
 * could push the shared admin process towards running out of memory. A few may wait.
 */
export function runResolveExclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (pendingResolves > MAX_WAITING_RESOLVES) {
    return Promise.reject(new ResolveBusyError('Other dependency resolves are running; try again in a minute'));
  }
  pendingResolves++;
  const run = resolveQueue.then(fn).finally(() => {
    pendingResolves--;
  });
  resolveQueue = run.catch(() => undefined);
  return run;
}

/** Resolve the dependency closure of `seeds` against the upstream indices. */
export async function resolveClosure(
  opts: ClosureOptions,
): Promise<ClosureResult> {
  const graph: DepGraph = { pkgs: new Map(), provides: new Map() };
  const budget: GraphBudget = { entries: 0, max: MAX_GRAPH_ENTRIES };

  for (const component of opts.components) {
    // binary-all holds Architecture: all packages shared by every arch.
    for (const arch of [...opts.arches, 'all']) {
      await loadIndex(opts.baseUrl, opts.suite, component, arch, graph, !!opts.includeRecommends, budget);
    }
  }

  const { packages, missingSeeds, truncated } = closureFromGraph(
    graph,
    opts.seeds,
    opts.maxPackages ?? 5000,
  );

  return { packages, missingSeeds, indexSize: graph.pkgs.size, truncated };
}
