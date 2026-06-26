import {
  FILTER_KEYS,
  type DebNode,
  type CleanNode,
  type FilterKey,
  type FilterNode,
  type MirrorNode,
  type SectionChild,
  type SectionNode,
  type SetNode,
} from './types';

const FILTER_KEY_SET = new Set<string>(FILTER_KEYS);

/**
 * Line-level grammar for `mirror.list`.
 *
 * Ordering matters: disabled directives are themselves comments, so the deb /
 * clean / set matchers run before the generic comment fallback. Anything that
 * matches nothing becomes a {@link RawNode} and is preserved verbatim.
 */

const SECTION_START = /^#\s*---start---(.+?)---\s*$/;
const SECTION_END = /^#\s*---end---(.+?)---\s*$/;
const USAGE_START = /^#\s*Usage start\s*$/i;
const USAGE_END = /^#\s*Usage end\s*$/i;

// `set <key> <value>`. Value keeps trailing-trimmed remainder (may hold spaces
// or quotes, e.g. `set _user_agent "apt-mirror2/14"`).
const SET = /^set\s+(\S+)\s+(.*?)\s*$/;

// `deb` / `deb-src`, optionally commented and with `[opt ...]`. The trailing
// `\S` after the keyword's whitespace ensures `# Debian ...` does not match.
const DEB =
  /^(#\s*)?(deb-src|deb)\s+(?:\[([^\]]*)\]\s+)?(\S+)(?:\s+(\S+)(?:\s+(.*?))?)?\s*$/i;

// `clean <uri>`, optionally commented.
const CLEAN = /^(#\s*)?clean\s+(\S+)\s*$/i;

function parseDeb(line: string): DebNode | null {
  const m = DEB.exec(line);
  if (!m) return null;
  const [, commentPrefix, debType, options, uri, suite, rest] = m;
  if (!uri) return null;
  return {
    kind: 'deb',
    debType: debType.toLowerCase() === 'deb-src' ? 'deb-src' : 'deb',
    enabled: !commentPrefix,
    options: options ? options.trim().split(/\s+/).filter(Boolean) : [],
    uri,
    suite: suite ?? '',
    components: rest ? rest.trim().split(/\s+/).filter(Boolean) : [],
    raw: line,
  };
}

function parseClean(line: string): CleanNode | null {
  const m = CLEAN.exec(line);
  if (!m) return null;
  return {
    kind: 'clean',
    enabled: !m[1],
    uri: m[2],
    raw: line,
  };
}

function parseSet(line: string): SetNode | null {
  const m = SET.exec(line);
  if (!m) return null;
  return { kind: 'set', key: m[1], value: m[2], raw: line };
}

// `<filter_key> <repo-url> <value> <value> ...` (apt-mirror2 package filters).
function parseFilter(line: string): FilterNode | null {
  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || !FILTER_KEY_SET.has(tokens[0])) return null;
  return {
    kind: 'filter',
    key: tokens[0] as FilterKey,
    uri: tokens[1],
    values: tokens.slice(2),
    raw: line,
  };
}

/** Classify a single line into a section-level node (never a section itself). */
function parseLeaf(line: string): SectionChild {
  if (line.trim() === '') return { kind: 'blank', raw: line };
  return (
    parseSet(line) ??
    parseDeb(line) ??
    parseClean(line) ??
    parseFilter(line) ??
    (line.trimStart().startsWith('#')
      ? { kind: 'comment', text: line, raw: line }
      : { kind: 'raw', text: line })
  );
}

/** Parse a `mirror.list` file body into its AST. */
export function parse(content: string): MirrorNode[] {
  const lines = content.split('\n');
  const nodes: MirrorNode[] = [];

  // Target for appends: top level, or the children of the open section.
  let section: SectionNode | null = null;
  const push = (node: MirrorNode) => {
    if (section) section.children.push(node as SectionChild);
    else nodes.push(node);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const startMatch = SECTION_START.exec(line);
    if (startMatch) {
      // A `start` while already inside a section closes the previous one so a
      // missing `end` marker can never swallow the rest of the file.
      if (section) nodes.push(section);
      section = {
        kind: 'section',
        title: startMatch[1].trim(),
        children: [],
        startRaw: line,
      };
      continue;
    }

    if (section && SECTION_END.test(line)) {
      section.endRaw = line;
      nodes.push(section);
      section = null;
      continue;
    }

    // Usage block: only meaningful inside a section. Collect verbatim until the
    // matching end marker (or EOF / section end, defensively).
    if (section && USAGE_START.test(line)) {
      const inner: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (USAGE_END.test(lines[j]) || SECTION_END.test(lines[j])) break;
        inner.push(lines[j]);
      }
      const closedByUsageEnd = j < lines.length && USAGE_END.test(lines[j]);
      const rawBlock = lines.slice(i, closedByUsageEnd ? j + 1 : j);
      section.children.push({ kind: 'usage', lines: inner, raw: rawBlock });
      i = closedByUsageEnd ? j : j - 1;
      continue;
    }

    push(parseLeaf(line));
  }

  // Unterminated trailing section: keep it (without an end marker).
  if (section) nodes.push(section);

  return nodes;
}
