import type { GraphEdge, GraphNode, GraphSpec } from './graph';
import { defaultDirection } from './graph';
import type { EdgeKind, NodeKind } from './kinds';

/** Mermaid export of a diagram (flowchart, or sequenceDiagram for sequence diagrams). */

function mid(id: string): string {
  return `n_${id.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function gid(id: string): string {
  return `g_${id.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

/** Escape text for use inside a quoted Mermaid label. */
export function mermaidText(text: string): string {
  return text
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\|/g, '#124;')
    .replace(/[\r\n]+/g, ' ');
}

const SHAPES: Record<NodeKind, [string, string]> = {
  actor: ['([', '])'],
  ui: ['[', ']'],
  service: ['[', ']'],
  module: ['[[', ']]'],
  component: ['[', ']'],
  class: ['[', ']'],
  function: ['(', ')'],
  data: ['[/', '/]'],
  store: ['[(', ')]'],
  external: ['{{', '}}'],
  queue: ['[/', '\\]'],
  config: ['>', ']'],
  file: ['[', ']'],
  step: ['(', ')'],
  decision: ['{', '}'],
  event: ['>', ']'],
  test: ['[', ']'],
  other: ['[', ']'],
};

const ARROWS: Record<EdgeKind, string> = {
  call: '-->',
  data: '-->',
  event: '-.->',
  dependency: '-.->',
  contains: '---',
  flow: '-->',
  read: '-->',
  write: '==>',
  inherit: '-->',
  other: '-->',
};

function edgeText(edge: GraphEdge): string | undefined {
  const parts = [edge.step !== undefined ? `${edge.step}.` : undefined, edge.label].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

function nodeLine(node: GraphNode, withDetails: boolean): string {
  const [open, close] = SHAPES[node.kind];
  const detail =
    withDetails && node.detail ? `<br/><small>${mermaidText(node.detail)}</small>` : '';
  return `${mid(node.id)}${open}"${mermaidText(node.label)}${detail}"${close}`;
}

export interface MermaidOptions {
  /** Include node details as a second line. */
  details?: boolean;
}

export function toMermaid(spec: GraphSpec, options: MermaidOptions = {}): string {
  if (spec.kind === 'sequence') return toMermaidSequence(spec);
  const lines: string[] = [`flowchart ${defaultDirection(spec)}`];
  const grouped = new Map<string, GraphNode[]>();
  const loose: GraphNode[] = [];
  for (const node of spec.nodes) {
    if (node.group && spec.groups.some((g) => g.id === node.group)) {
      const list = grouped.get(node.group) ?? [];
      list.push(node);
      grouped.set(node.group, list);
    } else {
      loose.push(node);
    }
  }
  for (const group of spec.groups) {
    const members = grouped.get(group.id);
    if (!members?.length) continue;
    lines.push(`  subgraph ${gid(group.id)}["${mermaidText(group.label)}"]`);
    for (const node of members) lines.push(`    ${nodeLine(node, Boolean(options.details))}`);
    lines.push('  end');
  }
  for (const node of loose) lines.push(`  ${nodeLine(node, Boolean(options.details))}`);
  for (const edge of spec.edges) {
    const text = edgeText(edge);
    const arrow = ARROWS[edge.kind];
    lines.push(
      text
        ? `  ${mid(edge.from)} ${arrow}|"${mermaidText(text)}"| ${mid(edge.to)}`
        : `  ${mid(edge.from)} ${arrow} ${mid(edge.to)}`,
    );
  }
  const highlighted = spec.nodes.filter((n) => n.highlight);
  if (highlighted.length) {
    lines.push('  classDef highlight stroke-width:3px,font-weight:bold;');
    lines.push(`  class ${highlighted.map((n) => mid(n.id)).join(',')} highlight;`);
  }
  return lines.join('\n');
}

function sequenceText(text: string): string {
  return text.replace(/[;#\r\n]+/g, ' ').trim();
}

/** Messages ordered by step (unnumbered ones keep their relative order after numbered ones). */
export function orderedMessages(spec: GraphSpec): GraphEdge[] {
  return spec.edges
    .map((edge, index) => ({ edge, index }))
    .sort((a, b) => {
      const sa = a.edge.step ?? Number.POSITIVE_INFINITY;
      const sb = b.edge.step ?? Number.POSITIVE_INFINITY;
      return sa === sb ? a.index - b.index : sa - sb;
    })
    .map((x) => x.edge);
}

export function toMermaidSequence(spec: GraphSpec): string {
  const lines = ['sequenceDiagram'];
  for (const node of spec.nodes) {
    const keyword = node.kind === 'actor' ? 'actor' : 'participant';
    lines.push(`  ${keyword} ${mid(node.id)} as ${sequenceText(node.label)}`);
  }
  for (const edge of orderedMessages(spec)) {
    const arrow = edge.kind === 'event' ? '-)' : edge.kind === 'data' ? '-->>' : '->>';
    const text = sequenceText(edgeText(edge) ?? ' ');
    lines.push(`  ${mid(edge.from)}${arrow}${mid(edge.to)}: ${text || ' '}`);
  }
  return lines.join('\n');
}
