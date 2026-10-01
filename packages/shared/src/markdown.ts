import type { Conversation, GraphEntry } from './conversation';
import type { CodeRef } from './graph';
import { NODE_KIND_INFO } from './kinds';
import { toMermaid } from './mermaid';
import {
  buildTree,
  getGraph,
  graphDisplayTitle,
  parentIdOf,
  relationLabel,
  type GraphTreeNode,
} from './tree';
import { APP_NAME } from './version';
import type { WorkspaceFolder } from './workspace';

/** Render a conversation as Markdown with Mermaid diagrams (for docs, PRs, wikis). */

export function formatRef(ref: CodeRef, multiFolder = true): string {
  const prefix = multiFolder && ref.folder ? `${ref.folder}:` : '';
  const lines =
    ref.startLine !== undefined
      ? ref.endLine !== undefined && ref.endLine !== ref.startLine
        ? `:${ref.startLine}-${ref.endLine}`
        : `:${ref.startLine}`
      : '';
  return `${prefix}${ref.path || '.'}${lines}`;
}

function anchor(entry: GraphEntry): string {
  return `g-${entry.id}`;
}

function cell(text: string | undefined): string {
  return (text ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

export interface MarkdownOptions {
  workspace?: { name: string; folders: WorkspaceFolder[] };
  now?: Date;
}

export function conversationToMarkdown(conv: Conversation, options: MarkdownOptions = {}): string {
  const out: string[] = [];
  const multiFolder = (options.workspace?.folders.length ?? 1) > 1;
  out.push(`# ${conv.title}`, '');
  const meta = [`${APP_NAME} export`, (options.now ?? new Date()).toISOString().slice(0, 10)];
  if (options.workspace) {
    meta.push(
      `workspace **${options.workspace.name}** (${options.workspace.folders.map((f) => `\`${f.path}\``).join(', ')})`,
    );
  }
  out.push(`> ${meta.join(' · ')}`, '');

  // Table of contents mirrors the discussion tree.
  const tree = buildTree(conv);
  const order: GraphEntry[] = [];
  const toc: string[] = [];
  const walk = (nodes: GraphTreeNode[]) => {
    for (const n of nodes) {
      order.push(n.entry);
      const status = n.entry.status === 'done' ? '' : ` _(${n.entry.status})_`;
      const rel = n.entry.origin.type === 'question' ? '' : `${relationLabel(n.entry)} → `;
      toc.push(
        `${'  '.repeat(n.depth)}- [${rel}${graphDisplayTitle(n.entry)}](#${anchor(n.entry)})${status}`,
      );
      walk(n.children);
    }
  };
  walk(tree);
  if (toc.length) out.push('## Discussion map', '', ...toc, '');

  order.forEach((entry, index) => {
    out.push(
      '---',
      '',
      `<a name="${anchor(entry)}"></a>`,
      '',
      `## ${index + 1}. ${graphDisplayTitle(entry)}`,
      '',
    );
    const parent = getGraph(conv, parentIdOf(entry.origin));
    const facts: string[] = [];
    facts.push(`**Question:** ${entry.question}`);
    if (parent)
      facts.push(
        `**From:** ${relationLabel(entry)} in [${graphDisplayTitle(parent)}](#${anchor(parent)})`,
      );
    out.push(facts.join('  \n'), '');
    if (!entry.spec) {
      out.push(
        `_${entry.status === 'error' ? `Failed: ${entry.error ?? 'unknown error'}` : `Status: ${entry.status}`}_`,
        '',
      );
      return;
    }
    const spec = entry.spec;
    if (spec.summary) out.push(spec.summary, '');
    out.push('```mermaid', toMermaid(spec), '```', '');
    out.push('| Box | Kind | What | Code |', '|---|---|---|---|');
    for (const node of spec.nodes) {
      const refs = node.refs.map((r) => `\`${formatRef(r, multiFolder)}\``).join(', ');
      out.push(
        `| ${cell(node.highlight ? `**${node.label}**` : node.label)} | ${NODE_KIND_INFO[node.kind].label} | ${cell(node.detail)} | ${cell(refs)} |`,
      );
    }
    out.push('');
    const arrowsWithCode = spec.edges.filter((e) => e.refs?.length);
    if (arrowsWithCode.length) {
      const labels = new Map(spec.nodes.map((n) => [n.id, n.label]));
      out.push('| Arrow | Code |', '|---|---|');
      for (const edge of arrowsWithCode) {
        const step = edge.step !== undefined ? `${edge.step}. ` : '';
        const arrow = `${labels.get(edge.from) ?? edge.from} → ${labels.get(edge.to) ?? edge.to}`;
        const label = edge.label ? `: ${edge.label}` : '';
        const refs = (edge.refs ?? []).map((r) => `\`${formatRef(r, multiFolder)}\``).join(', ');
        out.push(`| ${cell(`${step}${arrow}${label}`)} | ${cell(refs)} |`);
      }
      out.push('');
    }
    if (entry.note) out.push(`> **Note:** ${entry.note.replace(/\n/g, '\n> ')}`, '');
  });
  return `${out.join('\n').trimEnd()}\n`;
}
