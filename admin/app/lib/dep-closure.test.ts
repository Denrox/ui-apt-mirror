import { describe, it, expect } from 'vitest';
import { parsePackages, closureFromGraph, type DepGraph } from './dep-closure';

function graphFrom(text: string, includeRecommends = false): DepGraph {
  const graph: DepGraph = { pkgs: new Map(), provides: new Map() };
  parsePackages(text, graph, includeRecommends);
  return graph;
}

// A small synthetic Packages file exercising version pins, alternatives,
// virtual packages (Provides), Pre-Depends, Recommends, and a folded line.
const PACKAGES = `Package: app
Version: 1
Depends: liba (>= 1), libvirtual | libb, missing-pkg
Pre-Depends: prebase
Recommends: nicetohave

Package: liba
Depends: libc

Package: libb
Depends: libc

Package: libc
Description: base lib

Package: prebase

Package: provider1
Provides: libvirtual

Package: provider2
Provides: libvirtual

Package: nicetohave
Depends: extra

Package: extra

Package: folded
Depends: liba,
 libc
`;

describe('parsePackages', () => {
  it('parses deps, pre-depends, provides and folded continuation lines', () => {
    const { pkgs, provides } = graphFrom(PACKAGES);
    expect(pkgs.get('app')!.deps).toEqual(
      expect.arrayContaining([
        'prebase',
        'liba',
        'libvirtual',
        'libb',
        'missing-pkg',
      ]),
    );
    expect(provides.get('libvirtual')).toEqual(
      new Set(['provider1', 'provider2']),
    );
    // folded "Depends: liba,\n libc" becomes [liba, libc]
    expect(pkgs.get('folded')!.deps).toEqual(['liba', 'libc']);
  });

  it('omits Recommends unless requested', () => {
    expect(graphFrom(PACKAGES).pkgs.get('app')!.deps).not.toContain(
      'nicetohave',
    );
    expect(graphFrom(PACKAGES, true).pkgs.get('app')!.deps).toContain(
      'nicetohave',
    );
  });
});

describe('closureFromGraph', () => {
  it('includes seeds, all OR-alternatives, and all providers of a virtual', () => {
    const res = closureFromGraph(graphFrom(PACKAGES), ['app']);
    expect(res.packages).toEqual(
      expect.arrayContaining([
        'app',
        'liba',
        'libb', // both sides of "libvirtual | libb"
        'libc',
        'prebase',
        'provider1', // both providers of libvirtual
        'provider2',
      ]),
    );
    // Recommends not followed by default.
    expect(res.packages).not.toContain('nicetohave');
    expect(res.packages).not.toContain('extra');
  });

  it('reports seeds missing from the index', () => {
    const res = closureFromGraph(graphFrom(PACKAGES), ['app', 'nope']);
    expect(res.missingSeeds).toEqual(['nope']);
    // "missing-pkg" is a dep that does not exist; it is simply dropped.
    expect(res.packages).not.toContain('missing-pkg');
  });

  it('follows Recommends transitively when enabled', () => {
    const res = closureFromGraph(graphFrom(PACKAGES, true), ['app']);
    expect(res.packages).toEqual(
      expect.arrayContaining(['nicetohave', 'extra']),
    );
  });

  it('honors the package cap', () => {
    const res = closureFromGraph(graphFrom(PACKAGES), ['app'], 2);
    expect(res.truncated).toBe(true);
    expect(res.packages.length).toBeLessThanOrEqual(2);
  });
});

describe('resource limits', () => {
  it('parses an index split into arbitrary chunks the same way', async () => {
    const { PackagesParser } = await import('./dep-closure');
    const whole = graphFrom(PACKAGES, true);
    const graph: DepGraph = { pkgs: new Map(), provides: new Map() };
    const parser = new PackagesParser(graph, true);
    const bytes = Buffer.from(PACKAGES.replace(/\n/g, '\r\n'));
    for (let i = 0; i < bytes.length; i += 7) parser.push(bytes.subarray(i, i + 7));
    parser.end();
    expect(graph.pkgs).toEqual(whole.pkgs);
    expect(graph.provides).toEqual(whole.provides);
  });

  it('reads a long line in small chunks in linear time', async () => {
    const { PackagesParser } = await import('./dep-closure');
    const names = Array.from({ length: 20_000 }, (_, i) => `lib${i}`);
    const bytes = Buffer.from(`Package: big\nDepends: ${names.join(', ')}\n\nPackage: lib0\n`);
    expect(bytes.length).toBeGreaterThan(128 * 1024);
    const graph: DepGraph = { pkgs: new Map(), provides: new Map() };
    const parser = new PackagesParser(graph, false);
    const started = Date.now();
    // Joined again for every chunk, as before, this took minutes.
    for (let i = 0; i < bytes.length; i += 8) parser.push(bytes.subarray(i, i + 8));
    parser.end();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(graph.pkgs.get('big')!.deps).toEqual(names);
    expect(graph.pkgs.has('lib0')).toBe(true);
  });

  it('refuses a line, field or name longer than the limit', async () => {
    const { IndexLimitError, MAX_FIELD_LENGTH, MAX_LINE_BYTES, MAX_NAME_LENGTH, PackagesParser } = await import(
      './dep-closure'
    );
    const graph: DepGraph = { pkgs: new Map(), provides: new Map() };
    const pushed = (head: string, long: string) => () => {
      const parser = new PackagesParser(graph, false);
      parser.push(Buffer.from(head));
      for (let i = 0; i < long.length; i += 64 * 1024) parser.push(Buffer.from(long.slice(i, i + 64 * 1024)));
      parser.end();
    };
    // A line of a field that is skipped is not kept, but still not read past its limit.
    expect(pushed('Package: x\nDescription: ', 'a'.repeat(MAX_LINE_BYTES))).toThrow(IndexLimitError);
    const names = (count: number) => 'n, '.repeat(count);
    expect(pushed('Package: x\nDepends: ', names(MAX_FIELD_LENGTH / 3 + 1))).toThrow(IndexLimitError);
    // The same length folded over continuation lines.
    const folded = `Package: y\nDepends: a\n${` ${'b, '.repeat(341)}\n`.repeat(MAX_FIELD_LENGTH / 1024 + 1)}`;
    expect(() => parsePackages(folded, graph, false)).toThrow(IndexLimitError);
    // Up to the limits is fine.
    const count = Math.floor((MAX_FIELD_LENGTH - 1) / 3);
    parsePackages(`Package: z\nDepends: ${names(count)}x\nDescription: ${'d'.repeat(MAX_LINE_BYTES - 20)}\n`, graph, false);
    expect(graph.pkgs.get('z')!.deps).toHaveLength(count + 1);

    const name = 'a'.repeat(MAX_NAME_LENGTH);
    parsePackages(`Package: ${name}\nDepends: ${name}\nProvides: ${name}\n`, graph, false);
    expect(graph.pkgs.get(name)).toEqual({ deps: [name] });
    for (const index of [`Package: ${name}b\n`, `Package: z\nDepends: x, ${name}b\n`, `Package: z\nProvides: ${name}b\n`]) {
      expect(() => parsePackages(index, graph, false)).toThrow(`longer than ${MAX_NAME_LENGTH} characters`);
    }
  });

  it('keeps only the dependency fields', () => {
    const { pkgs } = graphFrom('Package: a\nDescription: long\n text\nDepends: b\n');
    expect(pkgs.get('a')).toEqual({ deps: ['b'] });
  });

  it('caps the component × architecture combinations of one request', async () => {
    const { closureOptionsError } = await import('./dep-closure');
    const opts = (components: string[], arches: string[]) => ({
      baseUrl: 'http://deb.debian.org/debian',
      suite: 'trixie',
      components,
      arches,
      seeds: ['sl'],
    });
    const stock = ['main', 'contrib', 'non-free', 'non-free-firmware'];
    expect(closureOptionsError(opts(stock, ['amd64', 'i386']))).toBeNull();
    expect(closureOptionsError(opts(stock, ['amd64', 'i386', 'arm64', 'armhf']))).toBeNull();
    expect(closureOptionsError(opts(stock, ['amd64', 'i386', 'arm64', 'armhf', 'riscv64']))).toMatch(/at most 16/);
  });

  it('bounds the bytes the graph holds, counting a package of several indices and a name once', async () => {
    const { PackagesParser, ResolveTooLargeError } = await import('./dep-closure');
    const graph: DepGraph = { pkgs: new Map(), provides: new Map() };
    const budget = { bytes: 0, max: 2000, names: new Map<string, string>() };
    const index = 'Package: a\nDepends: b, c | d\nProvides: v\n\nPackage: b\nDepends: c, d\nProvides: v\n';
    let held = 0;
    for (let i = 0; i < 3; i++) {
      const parser = new PackagesParser(graph, false, budget);
      parser.push(Buffer.from(index));
      parser.end();
      if (i === 0) held = budget.bytes;
      expect(budget.bytes).toBe(held);
    }
    expect(held).toBeGreaterThan(0);
    expect([...budget.names.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'v']);

    // Few entries, but long names.
    const long = (i: number) => `${'x'.repeat(150)}${i}`;
    const parser = new PackagesParser(graph, false, budget);
    expect(() => {
      parser.push(Buffer.from(`Package: ${long(0)}\nDepends: ${long(1)}, ${long(2)}\n`));
      parser.end();
    }).toThrow(ResolveTooLargeError);
  });

  it('runs resolves one at a time and turns away a crowd', async () => {
    const { runResolveExclusive, ResolveBusyError } = await import('./dep-closure');
    let running = 0;
    let most = 0;
    const releases: Array<() => void> = [];
    const job = () =>
      new Promise<void>((resolve) => {
        running++;
        most = Math.max(most, running);
        releases.push(() => {
          running--;
          resolve();
        });
      });
    const runs = [1, 2, 3].map(() => runResolveExclusive(job));
    await expect(runResolveExclusive(job)).rejects.toBeInstanceOf(ResolveBusyError);
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0));
      releases.shift()!();
    }
    await Promise.all(runs);
    expect(most).toBe(1);
  });
});
