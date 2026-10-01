/**
 * Prompt engineering for every provider. The system prompt is static (same text for every task,
 * so it can live in an agent config file and be cached by the CLIs); everything task specific
 * (workspace, conversation path, parent diagram, size limit, language) goes into the user prompt.
 */
import {
  DETAIL_LEVEL_INFO,
  EDGE_KIND_INFO,
  EDGE_KINDS,
  GRAPH_KIND_INFO,
  GRAPH_KINDS,
  NODE_KIND_INFO,
  NODE_KINDS,
  findNode,
  neighbours,
  relationLabel,
  type CodeRef,
  type GraphEdge,
  type GraphEntry,
  type GraphNode,
  type GraphSpec,
  type WorkspaceOverview,
} from '@codesplainer/shared';
import type { BuiltPrompt, GenerationTask } from './types';

const MAX_TREE_LINES = 400;
const MAX_TREE_CHARS = 24_000;
const MAX_SNIPPET_LINES = 400;
const MAX_SNIPPET_CHARS = 20_000;
/** Longer lines (minified code, data) are clipped. */
const MAX_LINE_CHARS = 400;
const MAX_BREADCRUMB = 6;

const GRAPH_KIND_USE: Record<(typeof GRAPH_KINDS)[number], string> = {
  architecture: 'the default for "how does X work / how is X built"',
  flow: '"what happens when…"; number the edges (step 1, 2, 3…)',
  sequence: 'request/response round trips; step on every edge',
  dataflow: 'where data comes from and where it ends up',
  structure: 'what contains or extends what',
  dependency: 'who depends on whom',
  state: 'the lifecycle of one thing',
};

/** Compact example of the exact output shape (kept small: it is sent with every request). */
const EXAMPLE = JSON.stringify({
  title: 'Checkout flow',
  summary: 'CheckoutApi validates the cart, then OrderService saves the order to Postgres.',
  kind: 'architecture',
  direction: 'LR',
  nodes: [
    {
      id: 'checkout-api',
      label: 'CheckoutApi',
      kind: 'function',
      detail: 'POST /checkout handler',
      group: null,
      expandable: true,
      highlight: false,
      refs: [
        {
          folder: 'shop',
          path: 'src/api/checkout.ts',
          startLine: 12,
          endLine: 58,
          symbol: 'checkout',
        },
      ],
    },
    {
      id: 'order-service',
      label: 'OrderService',
      kind: 'service',
      detail: 'Validates and stores orders',
      group: null,
      expandable: true,
      highlight: true,
      refs: [{ folder: 'shop', path: 'src/orders', startLine: null, endLine: null, symbol: null }],
    },
    {
      id: 'postgres',
      label: 'Postgres',
      kind: 'store',
      detail: '',
      group: null,
      expandable: false,
      highlight: false,
      refs: [],
    },
  ],
  edges: [
    {
      from: 'checkout-api',
      to: 'order-service',
      label: 'places order',
      kind: 'call',
      step: null,
      refs: [
        {
          folder: 'shop',
          path: 'src/api/checkout.ts',
          startLine: 41,
          endLine: 41,
          symbol: 'placeOrder',
        },
      ],
    },
    {
      from: 'order-service',
      to: 'postgres',
      label: 'inserts',
      kind: 'write',
      step: null,
      refs: [],
    },
  ],
  groups: [],
});

function vocabulary(kinds: readonly string[], info: Record<string, { hint: string }>): string {
  return kinds.map((k) => `${k} (${info[k]?.hint ?? ''})`).join('; ');
}

function buildSystemPrompt(): string {
  return [
    'You are Codesplainer, a read-only codebase explainer. You answer every request with exactly ONE small diagram, written as a single JSON object. Boxes and arrows carry the explanation; words are kept to a minimum.',
    '',
    '## Hard rules',
    '1. Few words. title: max 6 words. label: 1-3 words, the name used in the code ("AuthService", "jobs/"). detail: max 10 words, or "" when the label says it all. Edge label: a 1-3 word verb phrase ("calls", "saves order"), or "". summary: 1-2 short sentences (max 25 words) that directly answer the question.',
    '2. Size: stay within the box count given in the task and never exceed its maximum. Fewer meaningful boxes beat many trivial ones. Draw only the edges that matter.',
    '3. One altitude: all boxes of a diagram are on the same level of abstraction.',
    '4. highlight: true for the 1-3 boxes that answer the question, false for all others.',
    '5. Groups only when they clarify (max 4 groups); otherwise groups: [] and every group: null.',
    '6. Only state what you verified in the code. Never invent components, paths or line numbers.',
    '',
    '## Altitude',
    'Pick the abstraction level that fits the scope of the request:',
    '- large repo or broad question → subsystems, apps, services or top-level folders',
    '- a module or folder → its components or key files',
    '- a file → its main functions, classes and types',
    '- a function → its steps and decisions, each with a line range',
    'expandable: true for every box with code inside worth a closer look (folders, modules, services, files, classes, non-trivial functions); false only for actors, external systems and single steps.',
    '',
    '## Diagram kind',
    ...GRAPH_KINDS.map((k) => `- ${k}: ${GRAPH_KIND_INFO[k].hint}; ${GRAPH_KIND_USE[k]}`),
    'step is null except in flow and sequence diagrams. direction: "TB" for flow, state and structure, otherwise "LR".',
    '',
    '## Vocabulary',
    `Node kinds: ${vocabulary(NODE_KINDS, NODE_KIND_INFO)}.`,
    `Edge kinds: ${vocabulary(EDGE_KINDS, EDGE_KIND_INFO)}.`,
    '',
    '## Refs (where boxes and arrows live in the code)',
    '- folder: a workspace folder alias from the task. path: relative to that folder\'s root, forward slashes; "" is the folder root.',
    '- Boxes for folders, modules, services and whole files: the path only (startLine/endLine null); folders and modules may point to a directory.',
    '- Code-level boxes (function, class, step, decision): startLine and endLine from line numbers your tools showed (search results include them); never estimate.',
    '- Only paths you saw in the tree or opened; never guess. If unsure, use refs: []. Actors and external systems usually have none.',
    '- symbol: the function/class name when the box is one symbol, else null.',
    '- Arrows: refs point to the line where the relationship happens: the call, import, emit/subscribe, read or write (startLine = endLine for one line; symbol: the called function, or null). Code-level diagrams (inside a file or function) should have them. For arrows between folders or services one representative line is optional; do not search just to find one.',
    '',
    '## Exploring (read-only)',
    '- Never create, modify, move or delete files. Never run builds, tests, installs, git commands or network requests.',
    '- Be efficient: start from the tree in the task, read manifests and entry points, search (grep/glob) for names instead of reading whole directories, and read only what this one diagram needs.',
    '',
    '## Language',
    'Write title, summary, labels and details in the answer language named in the task. Keep code identifiers as they are.',
    '',
    '## Output',
    'Reply with ONLY the JSON object: no prose, no markdown fences. All keys are required; use "", null or [] when empty. Shape and style example:',
    EXAMPLE,
  ].join('\n');
}

export const SYSTEM_PROMPT = buildSystemPrompt();

// ---------------------------------------------------------------------------------------------
// User prompt
// ---------------------------------------------------------------------------------------------

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

function quote(text: string, max = 300): string {
  return `"${clip(text, max).replace(/"/g, "'")}"`;
}

export function refText(ref: CodeRef): string {
  const path = ref.path || '.';
  const loc = `${ref.folder ? `${ref.folder}:` : ''}${path}${ref.isDir && ref.path ? '/' : ''}`;
  const lines =
    ref.startLine !== undefined
      ? `:${ref.startLine}${ref.endLine !== undefined && ref.endLine !== ref.startLine ? `-${ref.endLine}` : ''}`
      : '';
  return `${loc}${lines}${ref.symbol ? ` (${ref.symbol})` : ''}`;
}

function refsText(refs: CodeRef[]): string {
  return refs.length ? refs.map(refText).join(', ') : '-';
}

const isAutoExpandQuestion = (entry: GraphEntry): boolean =>
  entry.origin.type === 'expand' &&
  (!entry.question.trim() || /^expand\b/i.test(entry.question.trim()));

/** The closest question actually written by the user (for the language rule). */
function humanQuestion(task: GenerationTask): string | undefined {
  const chain = [task.graph, ...[...task.ancestors].reverse()];
  return chain.find((g) => g.question.trim() && !isAutoExpandQuestion(g))?.question;
}

function overviewLines(overview: WorkspaceOverview | undefined): string[] {
  if (!overview) return [];
  const lines = overview.folders.map((f) => {
    if (!f.exists) return `- ${f.alias}: missing on disk`;
    const langs = f.languages
      .slice(0, 4)
      .map((l) => `${l.language} ${l.files}`)
      .join(', ');
    const manifests = f.manifests.slice(0, 10).join(', ');
    return `- ${f.alias}: ${f.fileCount}${f.truncated ? '+' : ''} files${langs ? `; ${langs}` : ''}${manifests ? `; manifests: ${manifests}` : ''}`;
  });
  return ['Overview:', ...lines];
}

/** Cut text to `max` chars, at a line break when there is one in the second half. */
function cutText(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const nl = text.lastIndexOf('\n', max);
  return { text: text.slice(0, nl > max / 2 ? nl : max), cut: true };
}

const clipLine = (line: string, max: number) =>
  line.length > max ? `${line.slice(0, max)}…` : line;

function treeLines(tree: string | undefined): string[] {
  if (!tree?.trim()) return [];
  const all = tree.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n');
  const lines = all.slice(0, MAX_TREE_LINES).map((l) => clipLine(l, MAX_LINE_CHARS));
  const { text, cut } = cutText(lines.join('\n'), MAX_TREE_CHARS);
  const truncated = cut || all.length > lines.length;
  return [
    'Tree (generated and ignored files omitted):',
    text,
    ...(truncated ? ['… (tree truncated)'] : []),
  ];
}

function workspaceSection(task: GenerationTask, full: boolean): string[] {
  const folders = task.workspace.folders;
  const lines = ['# Workspace', 'Folders (alias: absolute path):'];
  folders.forEach((f, i) =>
    lines.push(`- ${f.alias}: ${f.path}${i === 0 ? '  (working directory)' : ''}`),
  );
  if (folders.length > 1) lines.push('Read files of other folders by their absolute path.');
  if (full) {
    lines.push(...overviewLines(task.overview));
    lines.push(...treeLines(task.tree));
  } else {
    lines.push('(Same workspace as before: its tree is in the earlier messages.)');
  }
  return lines;
}

function entryStep(g: GraphEntry): string {
  const rel =
    g.origin.type === 'question'
      ? `Question ${quote(g.question, 160)}`
      : isAutoExpandQuestion(g)
        ? relationLabel(g)
        : `${relationLabel(g)}: ${quote(g.question, 160)}`;
  const result = g.spec
    ? ` → "${g.spec.title}" (${g.spec.kind}, ${g.spec.nodes.length} boxes)`
    : '';
  return `${rel}${result}`;
}

function breadcrumbSection(task: GenerationTask): string[] {
  const chain = task.ancestors;
  if (!chain.length) return [];
  const lines = ['# Conversation so far (root → parent)'];
  const skipFrom = chain.length > MAX_BREADCRUMB ? 1 : chain.length;
  const skipTo = chain.length > MAX_BREADCRUMB ? chain.length - (MAX_BREADCRUMB - 1) : chain.length;
  chain.forEach((g, i) => {
    if (i >= skipFrom && i < skipTo) {
      if (i === skipFrom) lines.push('…');
      return;
    }
    lines.push(`${i + 1}. ${entryStep(g)}`);
  });
  lines.push('Keep this altitude chain: the new diagram continues from the last step.');
  return lines;
}

function describeSpec(spec: GraphSpec, heading: string): string[] {
  const groups = new Map(spec.groups.map((g) => [g.id, g.label]));
  const lines = [`${heading}: "${spec.title}" (${spec.kind})`];
  if (spec.summary) lines.push(`Summary: ${spec.summary}`);
  lines.push('Boxes (id | label | kind | detail | code):');
  for (const n of spec.nodes) {
    const tags = [
      n.kind,
      n.group ? `in ${groups.get(n.group) ?? n.group}` : '',
      n.highlight ? 'highlighted' : '',
    ]
      .filter(Boolean)
      .join(', ');
    lines.push(`- ${n.id} | ${n.label} | ${tags} | ${n.detail ?? ''} | ${refsText(n.refs)}`);
  }
  if (spec.edges.length) {
    lines.push('Arrows:');
    for (const e of spec.edges) {
      lines.push(
        `- ${e.from} → ${e.to}${e.label ? `: ${e.label}` : ''} (${e.kind}${e.step ? `, step ${e.step}` : ''})${e.refs?.length ? ` | ${refsText(e.refs)}` : ''}`,
      );
    }
  }
  return lines;
}

function boxLines(
  spec: GraphSpec | undefined,
  node: GraphNode | undefined,
  fallbackLabel: string,
): string[] {
  if (!node)
    return [
      `Box: "${fallbackLabel}" (not found in the parent diagram; locate it in the code first)`,
    ];
  const lines = [
    `Box: "${node.label}" (id ${node.id}, ${node.kind})${node.detail ? `: ${node.detail}` : ''}`,
  ];
  lines.push(
    `Code: ${node.refs.length ? refsText(node.refs) : 'no refs yet (locate it in the code first)'}`,
  );
  if (spec) {
    const label = (id: string) => findNode(spec, id)?.label ?? id;
    const { incoming, outgoing } = neighbours(spec, node.id);
    const site = (e: GraphEdge) => (e.refs?.length ? ` at ${refsText(e.refs)}` : '');
    if (incoming.length) {
      lines.push(
        `Incoming: ${incoming.map((e) => `${label(e.from)}${e.label ? ` (${e.label})` : ''}${site(e)}`).join('; ')}`,
      );
    }
    if (outgoing.length) {
      lines.push(
        `Outgoing: ${outgoing.map((e) => `${label(e.to)}${e.label ? ` (${e.label})` : ''}${site(e)}`).join('; ')}`,
      );
    }
  }
  return lines;
}

function snippetLines(task: GenerationTask, ref: CodeRef): string[] {
  const snippet = task.codeSnippet;
  if (!snippet) return [`Selected code: ${refText(ref)} (read it yourself)`];
  const start = snippet.ref.startLine ?? 1;
  const all = snippet.text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const shown = all.slice(0, MAX_SNIPPET_LINES);
  const width = String(start + shown.length - 1).length;
  const numbered = shown.map(
    (l, i) => `${String(start + i).padStart(width)} | ${clipLine(l, MAX_LINE_CHARS)}`,
  );
  const { text: body, cut: cutChars } = cutText(numbered.join('\n'), MAX_SNIPPET_CHARS);
  const cut = cutChars || all.length > shown.length || shown.some((l) => l.length > MAX_LINE_CHARS);
  return [
    `Selected code: ${refText(snippet.ref)}`,
    `\`\`\`${snippet.language ?? ''}`,
    body,
    '```',
    ...(cut ? ['(selection truncated; read the rest if needed)'] : []),
  ];
}

function taskSection(task: GenerationTask): string[] {
  const { graph, parent } = task;
  const origin = graph.origin;
  const spec = parent?.spec;
  const question = graph.question.trim();
  switch (origin.type) {
    case 'question': {
      const size = task.overview
        ? ` The workspace has about ${task.overview.totals.files} files in ${task.overview.folders.length} folder(s).`
        : '';
      return [
        '# Task',
        `Answer this question about the workspace with one diagram: ${quote(question || 'How is this codebase organized?', 1000)}`,
        `Pick the altitude that fits the question and the codebase.${size}`,
      ];
    }
    case 'expand': {
      const node = findNode(spec, origin.nodeId);
      const lines = [
        '# Task: explain & expand one box of the parent diagram',
        ...boxLines(spec, node, origin.nodeLabel),
        "Diagram ONLY the inside of this box, one level deeper than the parent (a folder → its parts; a file → its functions; a function → its steps with line ranges). Reuse the parent's names. Show at most 2 boundary boxes (kind external or actor, expandable false) for its most important neighbours. Start by reading the box's code.",
      ];
      if (question && !isAutoExpandQuestion(graph))
        lines.push(`User's focus: ${quote(question, 1000)}`);
      return lines;
    }
    case 'ask-node': {
      const node = findNode(spec, origin.nodeId);
      return [
        '# Task: a question about one box of the parent diagram',
        ...boxLines(spec, node, origin.nodeLabel),
        `Question: ${quote(question, 1000)}`,
        "Answer with a diagram focused on this box (its internals or its relations, whichever answers the question). Reuse the parent's names.",
      ];
    }
    case 'ask-graph':
      return [
        '# Task: a follow-up question about the parent diagram',
        `Question: ${quote(question, 1000)}`,
        "Stay near the parent's altitude unless the question asks for more depth. Reuse its names.",
      ];
    case 'ask-code': {
      const node = origin.nodeId ? findNode(spec, origin.nodeId) : undefined;
      return [
        '# Task: explain selected code',
        `Question: ${quote(question || 'What does this code do?', 1000)}`,
        ...snippetLines(task, origin.ref),
        ...(node ? [`It belongs to box "${node.label}" of the parent diagram.`] : []),
        'Diagram what this code does: its steps, decisions and calls, each with a line range. Things outside the selection that it calls or is called by: at most 2 boundary boxes.',
      ];
    }
  }
}

function rulesSection(task: GenerationTask): string[] {
  const info = DETAIL_LEVEL_INFO[task.graph.detail];
  const lang = task.settings.answerLanguage.trim();
  const human = humanQuestion(task);
  const language = lang
    ? `${lang}.`
    : human
      ? `the language of the user's question ${quote(human, 120)}.`
      : 'English.';
  const aliases = task.workspace.folders.map((f) => f.alias).join(', ');
  return [
    '# Answer rules',
    `- Size: ${info.min}-${info.max} boxes ("${task.graph.detail}" detail); never more than ${info.max}, fewer when the subject is small.`,
    `- Answer language: ${language}`,
    `- Ref folders: ${aliases}.`,
    'Reply with ONLY the JSON object.',
  ];
}

function buildUser(task: GenerationTask, full: boolean): string {
  const sections: string[][] = [workspaceSection(task, full), breadcrumbSection(task)];
  const origin = task.graph.origin;
  if (origin.type !== 'question' && task.parent?.spec) {
    sections.push(['# Parent diagram', ...describeSpec(task.parent.spec, 'Diagram')]);
  }
  sections.push(taskSection(task), rulesSection(task));
  return sections
    .filter((s) => s.length)
    .map((s) => s.join('\n'))
    .join('\n\n');
}

export function buildPrompt(task: GenerationTask): BuiltPrompt {
  return {
    system: SYSTEM_PROMPT,
    user: buildUser(task, true),
    followUp: buildUser(task, false),
  };
}

/** Follow-up prompt used when the previous answer failed validation. */
export function buildRepairPrompt(error: string): string {
  return [
    `Your previous reply was invalid: ${clip(error, 800)}`,
    'Reply again with ONLY the corrected JSON object: no prose, no markdown fences, exactly the required shape, within the size limit. Do not explore further unless a ref is missing.',
  ].join('\n');
}

/** Tiny prompt used by provider smoke tests (answer: TEST_OUTPUT_SCHEMA). */
export function buildTestPrompt(): BuiltPrompt {
  const user =
    'Connectivity test. Do not use any tools and do not read any files. Reply with exactly this JSON object and nothing else: {"ok": true}';
  return { system: SYSTEM_PROMPT, user, followUp: user };
}
