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
    expect(closureOptionsError(opts(['main', 'contrib', 'non-free'], ['amd64', 'i386']))).toBeNull();
    expect(closureOptionsError(opts(['main', 'contrib', 'non-free'], ['amd64', 'i386', 'arm64']))).toMatch(
      /at most 6/,
    );
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
