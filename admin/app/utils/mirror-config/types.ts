/**
 * Typed AST for the apt-mirror2 `mirror.list` file.
 *
 * The parser turns the raw file into an ordered list of {@link MirrorNode}s and
 * the serializer turns it back. Every node parsed from disk keeps its original
 * source text in a `raw` field, so an unmodified `serialize(parse(x))` is
 * byte-for-byte identical to `x`. Mutating a node clears its `raw`, which makes
 * the serializer fall back to a canonical rendering for that node only — every
 * other line stays exactly as the user wrote it.
 *
 * This is the single source of truth for reading and editing the config.
 * Previously three separate hand-rolled regex state machines
 * (`utils/mirror-list.ts`, `routes/home/actions.tsx`, `routes/home/loader.tsx`)
 * each interpreted the format slightly differently; they now all go through
 * this model.
 */

export type DebType = 'deb' | 'deb-src';

/** A `deb` / `deb-src` source directive, active or commented-out (disabled). */
export interface DebNode {
  kind: 'deb';
  debType: DebType;
  /** `false` when the line is commented out (e.g. `#deb http://...`). */
  enabled: boolean;
  /** Tokens inside `[ ... ]`, e.g. `['trusted=yes']`. Empty when absent. */
  options: string[];
  uri: string;
  /** apt-mirror2 deb lines carry a single suite per line. */
  suite: string;
  components: string[];
  /** Original source line; absent once the node has been modified. */
  raw?: string;
}

/** A global `set <key> <value>` directive. */
export interface SetNode {
  kind: 'set';
  key: string;
  value: string;
  raw?: string;
}

/** A `clean <uri>` directive, active or commented-out. */
export interface CleanNode {
  kind: 'clean';
  enabled: boolean;
  uri: string;
  raw?: string;
}

/** A comment line that is not a disabled directive (e.g. a description). */
export interface CommentNode {
  kind: 'comment';
  /** Full original line, including the leading `#`. */
  text: string;
  raw?: string;
}

/** A blank (or whitespace-only) line. */
export interface BlankNode {
  kind: 'blank';
  raw?: string;
}

/**
 * The client-facing deb822 "Usage" snippet inside a section, delimited by
 * `# Usage start` / `# Usage end`. Treated as opaque: its inner lines are
 * preserved verbatim and never reinterpreted as real directives.
 */
export interface UsageNode {
  kind: 'usage';
  /** Inner lines between the markers, verbatim (including leading `#`). */
  lines: string[];
  /** Full original block including markers; absent once modified. */
  raw?: string[];
}

/** Any line the parser does not recognize; preserved verbatim. */
export interface RawNode {
  kind: 'raw';
  text: string;
}

/** A sentinel-delimited named repository section. */
export interface SectionNode {
  kind: 'section';
  title: string;
  children: MirrorNode[];
  /** Original `# ---start---<title>---` line; absent once modified. */
  startRaw?: string;
  /** Original `# ---end---<title>---` line; absent once modified. */
  endRaw?: string;
}

export type MirrorNode =
  | DebNode
  | SetNode
  | CleanNode
  | CommentNode
  | BlankNode
  | UsageNode
  | RawNode
  | SectionNode;

/** Node kinds that can appear nested inside a {@link SectionNode}. */
export type SectionChild = Exclude<MirrorNode, SectionNode>;

/** User-supplied description of a repository to add or edit. */
export interface RepositoryInput {
  title: string;
  description?: string;
  baseUrl: string;
  suites: string[];
  components: string[];
  includeSrc: boolean;
  trusted: boolean;
}
