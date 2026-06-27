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
