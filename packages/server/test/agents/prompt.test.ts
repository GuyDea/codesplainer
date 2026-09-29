import { describe, expect, it } from 'vitest';
import {
  DETAIL_LEVEL_INFO,
  GRAPH_KINDS,
  NODE_KINDS,
  normalizeGraphSpec,
} from '@codesplainer/shared';
import {
  buildPrompt,
  buildRepairPrompt,
  buildTestPrompt,
  SYSTEM_PROMPT,
} from '../../src/agents/prompt';
import { makeEntry, makeSettings, makeTask, parentSpec } from './helpers';

const folders = [
  { alias: 'api', path: '/work/api' },
  { alias: 'web', path: '/work/web' },
];

describe('system prompt', () => {
  it('covers vocabulary, rules and output format', () => {
    for (const k of NODE_KINDS) expect(SYSTEM_PROMPT).toContain(`${k} (`);
    for (const k of GRAPH_KINDS) expect(SYSTEM_PROMPT).toContain(`- ${k}:`);
    expect(SYSTEM_PROMPT).toMatch(/title: max 6 words/);
    expect(SYSTEM_PROMPT).toMatch(/label: 1-3 words/);
    expect(SYSTEM_PROMPT).toMatch(/Reply with ONLY the JSON object/);
    expect(SYSTEM_PROMPT).toMatch(/Never create, modify, move or delete files/);
  });

  it('embeds an example that is a valid diagram', () => {
    const line = SYSTEM_PROMPT.split('\n').find((l) => l.startsWith('{"title"'));
    expect(line).toBeDefined();
    const r = normalizeGraphSpec(JSON.parse(line as string));
    expect(r.ok).toBe(true);
  });

  it('is static (same for every task)', () => {
    const a = buildPrompt(makeTask({ folders, graph: makeEntry({ type: 'question' }, 'How?') }));
    const b = buildPrompt(
      makeTask({
        folders: [folders[0] as (typeof folders)[number]],
        graph: makeEntry({ type: 'question' }, 'Wie?', { detail: 'detailed' }),
        settings: makeSettings((s) => (s.answerLanguage = 'German')),
      }),
    );
    expect(a.system).toBe(b.system);
  });
});

describe('user prompt', () => {
  it('lists folder aliases, the tree and the size limit for a question', () => {
    const task = makeTask({
      folders,
      graph: makeEntry({ type: 'question' }, 'How does auth work?', { detail: 'simple' }),
      tree: 'api/\n  src/\n    auth.ts\nweb/\n  app.tsx',
    });
    const { user, followUp } = buildPrompt(task);
    expect(user).toContain('- api: /work/api  (working directory)');
    expect(user).toContain('- web: /work/web');
    expect(user).toContain('Ref folders: api, web.');
    expect(user).toContain('    auth.ts');
    expect(user).toContain('"How does auth work?"');
    const { min, max } = DETAIL_LEVEL_INFO.simple;
    expect(user).toContain(`${min}-${max} boxes`);
    expect(user).toContain(`never more than ${max}`);
    // The fork variant keeps the folders but not the tree.
    expect(followUp).toContain('- api: /work/api');
    expect(followUp).not.toContain('auth.ts');
  });

  it('describes the expanded box, its neighbours and the altitude chain', () => {
    const alias = 'api';
    const parent = makeEntry({ type: 'question' }, 'What is in this repo?', {
      status: 'done',
      spec: parentSpec(alias),
    });
    const graph = makeEntry(
      { type: 'expand', parentGraphId: parent.id, nodeId: 'db', nodeLabel: 'db/' },
      'Expand: db/',
      { detail: 'detailed' },
    );
    const { user } = buildPrompt(makeTask({ folders, graph, parent }));
    expect(user).toContain('# Task: explain & expand one box');
    expect(user).toContain('Box: "db/" (id db, module): Persistence');
    expect(user).toContain('Code: api:src/db');
    expect(user).toContain('Incoming: app.ts (saves)');
    expect(user).toContain('Diagram ONLY the inside of this box');
    expect(user).toMatch(/at most 2 boundary boxes/);
    // Parent diagram with every box and arrow.
    expect(user).toContain('- app | app.ts | file | Entry point | api:src/app.ts');
    expect(user).toContain('- app → db: saves (write)');
    // Breadcrumb and language taken from the root question (not "Expand: db/").
    expect(user).toContain('1. Question "What is in this repo?" → "Demo overview"');
    expect(user).toContain(
      'Answer language: the language of the user\'s question "What is in this repo?"',
    );
    expect(user).toContain(
      `${DETAIL_LEVEL_INFO.detailed.min}-${DETAIL_LEVEL_INFO.detailed.max} boxes`,
    );
  });

  it('includes the code selection with line numbers for ask-code', () => {
    const ref = { folder: 'api', path: 'src/auth.ts', startLine: 12, endLine: 14 };
    const graph = makeEntry({ type: 'ask-code', ref }, 'Why is the token checked twice?');
    const task = makeTask({
      folders,
      graph,
      codeSnippet: { ref, text: 'if (!token) {\n  throw new Error();\n}\n', language: 'ts' },
    });
    const { user } = buildPrompt(task);
    expect(user).toContain('Selected code: api:src/auth.ts:12-14');
    expect(user).toContain('```ts');
    expect(user).toContain('12 | if (!token) {');
    expect(user).toContain('14 | }');
    expect(user).toContain('"Why is the token checked twice?"');
  });

  it('caps huge selections and trees (long lines included)', () => {
    const ref = { folder: 'api', path: 'dist/bundle.js', startLine: 1, endLine: 1 };
    const graph = makeEntry({ type: 'ask-code', ref }, 'What is this?');
    const task = makeTask({
      folders,
      graph,
      codeSnippet: { ref, text: 'x'.repeat(200_000) },
      tree: Array.from(
        { length: 2000 },
        (_, i) => `  file-${i}.ts ${'y'.repeat(i === 0 ? 50_000 : 10)}`,
      ).join('\n'),
    });
    const { user } = buildPrompt(task);
    expect(user.length).toBeLessThan(50_000);
    expect(user).toContain('(selection truncated; read the rest if needed)');
    expect(user).toContain('… (tree truncated)');
  });

  it('uses the configured answer language', () => {
    const graph = makeEntry({ type: 'question' }, 'How does it work?');
    const task = makeTask({
      folders,
      graph,
      settings: makeSettings((s) => (s.answerLanguage = 'German')),
    });
    expect(buildPrompt(task).user).toContain('Answer language: German.');
  });

  it('frames ask-node and ask-graph follow-ups', () => {
    const parent = makeEntry({ type: 'question' }, 'Overview?', {
      status: 'done',
      spec: parentSpec('api'),
    });
    const askNode = makeEntry(
      { type: 'ask-node', parentGraphId: parent.id, nodeId: 'lib', nodeLabel: 'lib/' },
      'Is the logger async?',
    );
    const u1 = buildPrompt(makeTask({ folders, graph: askNode, parent })).user;
    expect(u1).toContain('# Task: a question about one box');
    expect(u1).toContain('Box: "lib/" (id lib, module)');
    expect(u1).toContain('Question: "Is the logger async?"');
    const askGraph = makeEntry(
      { type: 'ask-graph', parentGraphId: parent.id },
      'Where are errors handled?',
    );
    const u2 = buildPrompt(makeTask({ folders, graph: askGraph, parent })).user;
    expect(u2).toContain('# Task: a follow-up question about the parent diagram');
    expect(u2).toContain('# Parent diagram');
  });

  it('builds repair and test prompts', () => {
    expect(buildRepairPrompt('Diagram has no nodes.')).toContain('Diagram has no nodes.');
    expect(buildRepairPrompt('x')).toMatch(/ONLY the corrected JSON object/);
    const t = buildTestPrompt();
    expect(t.system).toBe(SYSTEM_PROMPT);
    expect(t.user).toContain('{"ok": true}');
  });
});
