import { createHash } from 'crypto';
import { parse } from './parse';
import { serialize } from './serialize';
import {
  FILTER_KEYS,
  type CommentNode,
  type DebNode,
  type FilterKey,
  type FilterNode,
  type MirrorNode,
  type RepositoryInput,
  type SectionChild,
  type SectionNode,
  type UsageNode,
} from './types';

/** Strip trailing slashes so URLs compare and render consistently. */
export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Hostname of a deb source URI, or null when it is not a parseable URL. */
function hostOf(uri: string): string | null {
  try {
    return new URL(uri).hostname || null;
  } catch {
    return null;
  }
}

/**
 * High-level, mutation-friendly wrapper around the `mirror.list` AST.
 *
 * Construct with {@link MirrorConfig.parse}, mutate via the methods below, then
 * read back with {@link serialize}. Untouched lines are preserved verbatim; only
 * the nodes a mutation touches are re-rendered canonically.
 */
export class MirrorConfig {
  constructor(public nodes: MirrorNode[]) {}

  static parse(content: string): MirrorConfig {
    return new MirrorConfig(parse(content));
  }

  serialize(): string {
    return serialize(this.nodes);
  }

  // --- Globals -------------------------------------------------------------

  /** Value of a `set <key>` directive, or undefined when absent. */
  getGlobal(key: string): string | undefined {
    for (const node of this.nodes) {
      if (node.kind === 'set' && node.key === key) return node.value;
    }
    return undefined;
  }

  /** Update an existing `set <key>` value, or append a new directive. */
  setGlobal(key: string, value: string): void {
    let lastSet = -1;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (node.kind !== 'set') continue;
      lastSet = i;
      if (node.key === key) {
        node.value = value;
        node.raw = undefined;
        return;
      }
    }
    const newNode: MirrorNode = { kind: 'set', key, value };
    if (lastSet === -1) this.nodes.unshift(newNode);
    else this.nodes.splice(lastSet + 1, 0, newNode);
  }

  // --- Section queries -----------------------------------------------------

  sections(): SectionNode[] {
    return this.nodes.filter((n): n is SectionNode => n.kind === 'section');
  }

  /** All section titles, active and disabled alike, in file order. */
  sectionTitles(): string[] {
    return this.sections().map((s) => s.title);
  }

  /** With a revision, the section of that title whose text matches it (a hand-edited file can repeat a title). */
  getSection(title: string, revision?: string): SectionNode | undefined {
    const matches = this.sections().filter((s) => s.title === title);
    return (revision && matches.find((s) => this.sectionRevision(s) === revision)) || matches[0];
  }

  /** Fingerprint of a section's text, so a save can detect that it changed in between. */
  sectionRevision(section: SectionNode): string {
    return createHash('sha256').update(serialize([section])).digest('hex').slice(0, 16);
  }

  /** Whether a section restricts which packages are mirrored. */
  isSectionFiltered(section: SectionNode): boolean {
    return section.children.some(
      (c) => c.kind === 'filter' && c.enabled && c.values.length > 0,
    );
  }

  /** A section is enabled when at least one of its deb directives is active. */
  isSectionEnabled(section: SectionNode): boolean {
    return debChildren(section).some((d) => d.enabled);
  }

  /** Upstream hostnames referenced by a section's active deb directives. */
  sectionHosts(section: SectionNode): string[] {
    const hosts = new Set<string>();
    for (const deb of debChildren(section)) {
      if (!deb.enabled) continue;
      const host = hostOf(deb.uri);
      if (host) hosts.add(host);
    }
    return Array.from(hosts);
  }

  /** Upstream hostnames of every enabled section. */
  enabledHosts(): string[] {
    return Array.from(new Set(this.sections().flatMap((s) => this.sectionHosts(s))));
  }

  /**
   * The deb822 "Usage" snippet of a section as display lines: each inner line
   * has its leading `#` stripped, blanks removed. This is what the dashboard
   * renders as the client-facing config.
   */
  sectionUsageLines(section: SectionNode): string[] {
    const out: string[] = [];
    for (const child of section.children) {
      if (child.kind !== 'usage') continue;
      for (const line of child.lines) {
        const cleaned = line.trim().replace(/^#\s*/, '');
        if (cleaned) out.push(cleaned);
      }
    }
    return out;
  }

  /**
   * Reconstruct the editable {@link RepositoryInput} for a section, for
   * pre-filling an edit form. Derives the base URL, suites and components from
   * the deb directives, `includeSrc` from any deb-src line, and `trusted` from
   * a `[trusted=yes]` option or a `#Trusted: yes` Usage field. Returns null for
   * a section with no deb directives.
   */
  sectionToInput(section: SectionNode): RepositoryInput | null {
    const debs = debChildren(section);
    const binary = debs.filter((d) => d.debType === 'deb');
    const primary = binary[0] ?? debs[0];
    if (!primary) return null;

    // The form describes one upstream with one component set; saving anything else
    // would drop the other sources (e.g. Debian's security.debian.org lines).
    const urls = new Set(debs.map((d) => normalizeUrl(d.uri)));
    const componentSets = new Set(debs.map((d) => [...d.components].sort().join(' ')));
    if (urls.size > 1 || componentSets.size > 1) return null;

    const base = normalizeUrl(primary.uri);
    const suites: string[] = [];
    for (const deb of binary.length ? binary : debs) {
      if (normalizeUrl(deb.uri) !== base) continue;
      if (!suites.includes(deb.suite)) suites.push(deb.suite);
    }

    const trustedOption = debs.some((d) =>
      d.options.some((o) => /^trusted=yes$/i.test(o)),
    );
    const trustedUsage = section.children.some(
      (c) =>
        c.kind === 'usage' &&
        c.lines.some((l) => /^#?\s*Trusted:\s*yes\b/i.test(l)),
    );

    const firstComment = section.children.find(
      (c): c is CommentNode => c.kind === 'comment',
    );

    return {
      title: section.title,
      description: firstComment
        ? firstComment.text.replace(/^#+\s?/, '').trim()
        : '',
      baseUrl: base,
      suites,
      components: [...primary.components],
      includeSrc: debs.some((d) => d.debType === 'deb-src'),
      trusted: trustedOption || trustedUsage,
      arches: archesOf(primary),
      filters: sectionFilters(section),
    };
  }

  // --- Section mutations ---------------------------------------------------

  /**
   * Comment or uncomment every deb and filter directive in a section. Filters
   * apply per base URL, so a disabled section's filters would still restrict
   * other sections with the same upstream.
   */
  setSectionEnabled(title: string, enabled: boolean, revision?: string): boolean {
    const section = this.getSection(title, revision);
    return section ? this.setEnabled(section, enabled) : false;
  }

  /** {@link setSectionEnabled} for a section node already in hand. */
  setEnabled(section: SectionNode, enabled: boolean): boolean {
    let changed = false;
    for (const child of section.children) {
      if ((child.kind === 'deb' || child.kind === 'filter') && child.enabled !== enabled) {
        child.enabled = enabled;
        child.raw = undefined;
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Append a new sentinel-delimited section before the trailing clean block and
   * ensure a matching `clean <baseUrl>` directive exists.
   */
  addSection(input: RepositoryInput, mirrorDomain: string): void {
    const section = buildSection(input, mirrorDomain);
    const anchor = this.cleanBlockAnchor();
    this.nodes.splice(anchor, 0, section, { kind: 'blank' });
    this.ensureClean(normalizeUrl(input.baseUrl.trim()));
  }

  /**
   * Replace a section's body from fresh input (title may change), keeping its
   * position, and re-sync clean directives for the old and new base URLs.
   */
  editSection(
    title: string,
    input: RepositoryInput,
    mirrorDomain: string,
    revision?: string,
  ): boolean {
    const section = this.getSection(title, revision);
    if (!section) return false;

    const oldUrls = baseUrlsOf(section);
    const oldSignedBy = section.children
      .filter((c): c is UsageNode => c.kind === 'usage')
      .flatMap((c) => c.lines.filter((l) => /^#?\s*Signed-By:/i.test(l)));
    // Filters the input does not mention are preserved; mentioned keys override
    // (an empty array clears that directive).
    const mergedFilters = sectionFilters(section);
    for (const key of FILTER_KEYS) {
      const provided = input.filters?.[key];
      if (provided === undefined) continue;
      if (provided.filter((v) => v.trim()).length)
        mergedFilters[key] = provided;
      else delete mergedFilters[key];
    }
    const rebuilt = buildSection(
      { ...input, filters: mergedFilters },
      mirrorDomain,
    );
    // The generated Usage snippet has no Signed-By; keep the one the section had.
    if (!input.trusted && oldSignedBy.length) {
      const usage = rebuilt.children.find((c): c is UsageNode => c.kind === 'usage');
      if (usage && !usage.lines.some((l) => /Signed-By:/i.test(l))) usage.lines.push(...oldSignedBy);
    }
    section.title = rebuilt.title;
    section.children = rebuilt.children;
    section.startRaw = rebuilt.startRaw;
    section.endRaw = rebuilt.endRaw;

    const newUrl = normalizeUrl(input.baseUrl.trim());
    this.ensureClean(newUrl);
    for (const url of oldUrls) {
      if (url !== newUrl) this.pruneCleanIfUnreferenced(url);
    }
    return true;
  }

  /** Remove a section entirely and prune clean directives it alone referenced. */
  removeSection(title: string, revision?: string): boolean {
    const section = this.getSection(title, revision);
    if (!section) return false;
    const index = this.nodes.indexOf(section);
    const urls = baseUrlsOf(section);

    let removeCount = 1;
    const next = this.nodes[index + 1];
    if (next && next.kind === 'blank') removeCount++; // tidy trailing blank
    this.nodes.splice(index, removeCount);

    for (const url of urls) this.pruneCleanIfUnreferenced(url);
    return true;
  }

  // --- Clean directives ----------------------------------------------------

  /** Insertion index for new sections: the trailing clean block, else EOF. */
  private cleanBlockAnchor(): number {
    const comment = this.nodes.findIndex(
      (n) => n.kind === 'comment' && /^#\s*Clean up old packages/i.test(n.text),
    );
    if (comment !== -1) return comment;
    const firstClean = this.nodes.findIndex((n) => n.kind === 'clean');
    if (firstClean !== -1) return firstClean;
    return this.nodes.length;
  }

  /** Add a `clean <uri>` directive unless one already exists for that URL. */
  ensureClean(uri: string): void {
    const target = normalizeUrl(uri);
    const exists = this.nodes.some(
      (n) => n.kind === 'clean' && normalizeUrl(n.uri) === target,
    );
    if (exists) return;

    let lastClean = -1;
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].kind === 'clean') lastClean = i;
    }
    const cleanNode: MirrorNode = { kind: 'clean', enabled: true, uri: target };
    if (lastClean !== -1) {
      this.nodes.splice(lastClean + 1, 0, cleanNode);
      return;
    }
    const last = this.nodes[this.nodes.length - 1];
    if (last && !(last.kind === 'blank')) this.nodes.push({ kind: 'blank' });
    this.nodes.push({ kind: 'comment', text: '# Clean up old packages' });
    this.nodes.push(cleanNode);
  }

  /** Drop a `clean <uri>` directive if no remaining deb directive uses it. */
  pruneCleanIfUnreferenced(uri: string): void {
    const target = normalizeUrl(uri);
    if (this.isBaseUrlReferenced(target)) return;
    const index = this.nodes.findIndex(
      (n) => n.kind === 'clean' && normalizeUrl(n.uri) === target,
    );
    if (index !== -1) this.nodes.splice(index, 1);
  }

  /** Whether any deb directive (in any section or top level) uses a base URL. */
  private isBaseUrlReferenced(target: string): boolean {
    const refs = (node: MirrorNode): boolean => {
      if (node.kind === 'deb') return normalizeUrl(node.uri) === target;
      if (node.kind === 'section') return node.children.some(refs);
      return false;
    };
    return this.nodes.some(refs);
  }
}

/** Deb directives directly inside a section (active or disabled). */
function debChildren(section: SectionNode): DebNode[] {
  return section.children.filter((c): c is DebNode => c.kind === 'deb');
}

/** Distinct normalized base URLs referenced by a section's deb directives. */
function baseUrlsOf(section: SectionNode): string[] {
  const urls = new Set<string>();
  for (const deb of debChildren(section)) urls.add(normalizeUrl(deb.uri));
  return Array.from(urls);
}

/** Build a complete section node from user input. */
function buildSection(
  input: RepositoryInput,
  mirrorDomain: string,
): SectionNode {
  const title = input.title.trim();
  const base = normalizeUrl(input.baseUrl.trim());
  const children: SectionChild[] = [];

  if (input.description && input.description.trim()) {
    // `##` never parses as a directive, section marker or Usage marker.
    children.push({ kind: 'comment', text: `## ${input.description.trim()}` });
  }

  const arches = (input.arches ?? []).map((a) => a.trim()).filter(Boolean);
  const options = arches.length ? [`arch=${arches.join(',')}`] : [];
  const debLine = (debType: DebNode['debType'], suite: string): DebNode => ({
    kind: 'deb',
    debType,
    enabled: true,
    options: [...options],
    uri: base,
    suite,
    components: [...input.components],
  });
  for (const suite of input.suites) children.push(debLine('deb', suite));
  if (input.includeSrc) {
    for (const suite of input.suites) children.push(debLine('deb-src', suite));
  }

  // Package filters (apt-mirror2), bound to the repo's base URL.
  children.push(...filterNodesFor(base, input.filters ?? {}));

  children.push(buildUsage(input, base, mirrorDomain));

  return {
    kind: 'section',
    title,
    children,
    startRaw: `# ---start---${title}---`,
    endRaw: `# ---end---${title}---`,
  };
}

/** Build the client-facing deb822 "Usage" snippet for a repository. */
function buildUsage(
  input: RepositoryInput,
  base: string,
  mirrorDomain: string,
): UsageNode {
  const comps = input.components.join(' ');
  const url = new URL(base);
  const mirrorPath = normalizeUrl(`${url.hostname}${url.pathname}`);
  const lines = [
    `#Types: deb${input.includeSrc ? ' deb-src' : ''}`,
    `#URIs: http://${mirrorDomain}/${mirrorPath}`,
    `#Suites: ${input.suites.join(' ')}`,
    `#Components: ${comps}`,
  ];
  const arches = (input.arches ?? []).map((a) => a.trim()).filter(Boolean);
  if (arches.length) lines.push(`#Architectures: ${arches.join(' ')}`);
  if (input.trusted) lines.push('#Trusted: yes');
  return { kind: 'usage', lines };
}

/** Build filter directive nodes for the non-empty filters of a repo. */
function filterNodesFor(
  base: string,
  filters: Partial<Record<FilterKey, string[]>>,
): FilterNode[] {
  const nodes: FilterNode[] = [];
  for (const key of FILTER_KEYS) {
    const values = (filters[key] ?? []).map((v) => v.trim()).filter(Boolean);
    if (values.length) nodes.push({ kind: 'filter', key, enabled: true, uri: base, values });
  }
  return nodes;
}

/** Read a section's existing filter directives into a key→values map. */
function sectionFilters(
  section: SectionNode,
): Partial<Record<FilterKey, string[]>> {
  const filters: Partial<Record<FilterKey, string[]>> = {};
  for (const child of section.children) {
    if (child.kind === 'filter' && child.values.length) {
      filters[child.key] = [...child.values];
    }
  }
  return filters;
}

/** Architectures requested by a deb line's `[arch=...]` option, if any. */
function archesOf(deb: DebNode | undefined): string[] {
  if (!deb) return [];
  const opt = deb.options.find((o) => /^arch=/i.test(o));
  return opt
    ? opt
        .slice(opt.indexOf('=') + 1)
        .split(',')
        .filter(Boolean)
    : [];
}
