import type {
  DebNode,
  CleanNode,
  FilterNode,
  MirrorNode,
  SectionNode,
  SetNode,
  UsageNode,
} from './types';

/**
 * Render the AST back to text. Each node emits its preserved `raw` source when
 * present; otherwise it falls back to a canonical rendering. Mutating helpers in
 * `model.ts` clear `raw` on the nodes they touch, so only edited lines are
 * reformatted — everything else round-trips byte-for-byte.
 */

export function renderDeb(node: DebNode): string {
  const prefix = node.enabled ? '' : '# ';
  const opts = node.options.length ? `[${node.options.join(' ')}] ` : '';
  const tail = [node.suite, ...node.components].filter(Boolean).join(' ');
  return `${prefix}${node.debType} ${opts}${node.uri}${tail ? ` ${tail}` : ''}`;
}

function renderClean(node: CleanNode): string {
  return `${node.enabled ? '' : '# '}clean ${node.uri}`;
}

function renderSet(node: SetNode): string {
  return `set ${node.key} ${node.value}`;
}

function renderFilter(node: FilterNode): string {
  return `${node.enabled ? '' : '# '}${[node.key, node.uri, ...node.values].join(' ')}`;
}

function renderUsage(node: UsageNode): string {
  if (node.raw) return node.raw.join('\n');
  return ['# Usage start', ...node.lines, '# Usage end'].join('\n');
}

function renderNode(node: MirrorNode): string {
  switch (node.kind) {
    case 'blank':
      return node.raw ?? '';
    case 'comment':
      return node.raw ?? node.text;
    case 'raw':
      return node.text;
    case 'set':
      return node.raw ?? renderSet(node);
    case 'deb':
      return node.raw ?? renderDeb(node);
    case 'clean':
      return node.raw ?? renderClean(node);
    case 'filter':
      return node.raw ?? renderFilter(node);
    case 'usage':
      return renderUsage(node);
    case 'section':
      return renderSection(node);
  }
}

function renderSection(node: SectionNode): string {
  const out: string[] = [];
  out.push(node.startRaw ?? `# ---start---${node.title}---`);
  for (const child of node.children) out.push(renderNode(child));
  // An end marker is emitted only when one exists — a parsed-but-unterminated
  // section stays unterminated. Sections built by the model set `endRaw`.
  if (node.endRaw !== undefined) out.push(node.endRaw);
  return out.join('\n');
}

/** Serialize a full AST back into `mirror.list` text. */
export function serialize(nodes: MirrorNode[]): string {
  return nodes.map(renderNode).join('\n');
}
