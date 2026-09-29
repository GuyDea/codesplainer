/**
 * MANUAL smoke runs against the real CLIs (costs credits; not part of vitest).
 *
 *   npx tsx packages/server/test/agents/smoke.manual.ts <provider> <step> [--model M] [--effort E] [--unsafe]
 *
 * provider: kiro | claude | codex | acp | mock
 * step:     prompt   print the prompts only (free)
 *           detect   run detection only (free)
 *           question root question on a tiny demo project in /tmp/cs-smoke
 *           expand   expand a box of the previous question result (forks the session if supported)
 *           code     ask-code about a function of the demo project
 *           test     registry.test()
 * Results are written to /tmp/cs-smoke/results/<provider>-<step>.json.
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  defaultSettings,
  normalizeGraphSpec,
  wordCount,
  type GraphEntry,
  type GraphSpec,
  type ProviderId,
  type WorkspaceOverview,
} from '@codesplainer/shared';
import { buildPrompt, buildTestPrompt } from '../../src/agents/prompt';
import { createProviderRegistry } from '../../src/agents/registry';
import { GRAPH_OUTPUT_SCHEMA, TEST_OUTPUT_SCHEMA } from '../../src/agents/schema';
import type { AgentRunResult, GenerationTask } from '../../src/agents/types';

const ROOT = '/tmp/cs-smoke';
const PROJECT = join(ROOT, 'todo-api');
const RESULTS = join(ROOT, 'results');

const FILES: Record<string, string> = {
  'package.json': JSON.stringify(
    { name: 'todo-api', version: '1.0.0', main: 'src/server.js' },
    null,
    2,
  ),
  'src/server.js': `const http = require('http');
const { route } = require('./router');

const PORT = process.env.PORT || 3000;

function start() {
  const server = http.createServer(async (req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      const result = await route(req.method, req.url, body ? JSON.parse(body) : undefined);
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });
  });
  server.listen(PORT, () => console.log('listening on ' + PORT));
}

start();
`,
  'src/router.js': `const todos = require('./todoService');

async function route(method, url, body) {
  if (method === 'GET' && url === '/todos') return { status: 200, body: await todos.list() };
  if (method === 'POST' && url === '/todos') {
    if (!body || !body.title) return { status: 400, body: { error: 'title required' } };
    return { status: 201, body: await todos.add(body.title) };
  }
  const match = url.match(/^\\/todos\\/(\\d+)\\/done$/);
  if (method === 'POST' && match) return { status: 200, body: await todos.complete(Number(match[1])) };
  return { status: 404, body: { error: 'not found' } };
}

module.exports = { route };
`,
  'src/todoService.js': `const db = require('./db');

async function list() {
  return db.all();
}

async function add(title) {
  const todo = { id: db.nextId(), title: title.trim(), done: false, createdAt: Date.now() };
  db.save(todo);
  return todo;
}

async function complete(id) {
  const todo = db.get(id);
  if (!todo) throw new Error('todo not found');
  todo.done = true;
  db.save(todo);
  return todo;
}

module.exports = { list, add, complete };
`,
  'src/db.js': `const store = new Map();
let counter = 0;

function nextId() {
  counter += 1;
  return counter;
}

function save(todo) {
  store.set(todo.id, { ...todo });
}

function get(id) {
  return store.get(id);
}

function all() {
  return [...store.values()];
}

module.exports = { nextId, save, get, all };
`,
};

async function setupProject(): Promise<void> {
  for (const [rel, content] of Object.entries(FILES)) {
    const p = join(PROJECT, rel);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, content, 'utf8');
  }
  await mkdir(RESULTS, { recursive: true });
}

async function tree(dir: string, depth = 0): Promise<string[]> {
  const out: string[] = depth === 0 ? ['todo-api/'] : [];
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const e of entries) {
    out.push(`${'  '.repeat(depth + 1)}${e.name}${e.isDirectory() ? '/' : ''}`);
    if (e.isDirectory()) out.push(...(await tree(join(dir, e.name), depth + 1)));
  }
  return out;
}

function overview(): WorkspaceOverview {
  return {
    workspaceId: 'smoke',
    scannedAt: new Date().toISOString(),
    folders: [
      {
        alias: 'todo-api',
        path: PROJECT,
        exists: true,
        fileCount: 5,
        dirCount: 1,
        totalBytes: 2000,
        truncated: false,
        languages: [
          { language: 'JavaScript', files: 4, bytes: 1800 },
          { language: 'JSON', files: 1, bytes: 200 },
        ],
        manifests: ['package.json'],
        isGitRepo: false,
      },
    ],
    totals: { files: 5, bytes: 2000 },
    languages: [{ language: 'JavaScript', files: 4, bytes: 1800 }],
  };
}

function entry(
  origin: GraphEntry['origin'],
  question: string,
  provider: ProviderId,
  extra: Partial<GraphEntry> = {},
): GraphEntry {
  return {
    id: `smoke-${origin.type}`,
    origin,
    question,
    status: 'running',
    provider,
    detail: 'balanced',
    warnings: [],
    createdAt: new Date().toISOString(),
    activity: [],
    attempt: 1,
    ...extra,
  };
}

interface Saved {
  entry: GraphEntry;
  result: AgentRunResult;
  activity: { kind: string; text: string }[];
  durationMs: number;
}

async function checkRefs(spec: GraphSpec): Promise<string[]> {
  const problems: string[] = [];
  for (const n of spec.nodes) {
    for (const r of n.refs) {
      const abs = join(PROJECT, r.path);
      const s = await stat(abs).catch(() => undefined);
      if (!s) {
        problems.push(`${n.label}: missing ${r.folder}:${r.path}`);
        continue;
      }
      if (r.startLine !== undefined && s.isFile()) {
        const lines = (await readFile(abs, 'utf8')).split('\n').length;
        if ((r.endLine ?? r.startLine) > lines)
          problems.push(`${n.label}: lines ${r.startLine}-${r.endLine} > ${lines}`);
      }
    }
  }
  return problems;
}

function report(label: string, saved: Saved): void {
  const { result } = saved;
  const norm = normalizeGraphSpec(result.output);
  console.log(`\n=== ${label}: ${Math.round(saved.durationMs / 100) / 10} s ===`);
  console.log('usage:', JSON.stringify(result.usage), 'session:', result.session?.id ?? '-');
  if (result.warnings.length) console.log('warnings:', result.warnings);
  if (!norm.ok) {
    console.log('INVALID:', norm.error, '\nraw:', result.rawText.slice(0, 1500));
    return;
  }
  const spec = norm.spec;
  const maxWords = (xs: (string | undefined)[]) =>
    Math.max(0, ...xs.map((x) => wordCount(x ?? '')));
  console.log(
    `valid ✓  kind=${spec.kind} nodes=${spec.nodes.length} edges=${spec.edges.length} groups=${spec.groups.length} ` +
      `highlight=${spec.nodes.filter((n) => n.highlight).length} suggestions=${spec.suggestions.length}`,
  );
  console.log(
    `words: title=${wordCount(spec.title)} label<=${maxWords(spec.nodes.map((n) => n.label))} ` +
      `detail<=${maxWords(spec.nodes.map((n) => n.detail))} edge<=${maxWords(spec.edges.map((e) => e.label))} ` +
      `summary=${wordCount(spec.summary ?? '')}`,
  );
  console.log(`title: ${spec.title}\nsummary: ${spec.summary}`);
  for (const n of spec.nodes) {
    const refs = n.refs
      .map((r) => `${r.path}${r.startLine ? `:${r.startLine}-${r.endLine}` : ''}`)
      .join(', ');
    console.log(
      `  [${n.kind}] ${n.label}${n.highlight ? ' ★' : ''}${n.expandable ? ' +' : ''} — ${n.detail ?? ''}  {${refs}}`,
    );
  }
  for (const e of spec.edges)
    console.log(
      `  ${e.from} -> ${e.to} ${e.label ?? ''} (${e.kind}${e.step ? ` #${e.step}` : ''})`,
    );
  console.log('suggestions:', spec.suggestions);
  console.log(
    'activity:',
    saved.activity.slice(0, 25).map((a) => `${a.kind}: ${a.text}`),
  );
}

async function main(): Promise<void> {
  const [providerArg, step = 'prompt', ...rest] = process.argv.slice(2);
  const provider = (providerArg ?? 'mock') as ProviderId;
  const opt = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  await setupProject();
  const settings = defaultSettings();
  const ps = settings.providers[provider];
  ps.effort = opt('--effort') ?? (provider === 'kiro' ? '' : 'low');
  if (rest.includes('--unsafe')) ps.unsafeNoSandbox = true;
  if (provider === 'claude') ps.extraArgs = ['--max-budget-usd', '1'];
  const model = opt('--model') ?? (provider === 'claude' ? 'sonnet' : undefined);
  const registry = createProviderRegistry({ dataDir: join(ROOT, 'data') });
  const folders = [{ alias: 'todo-api', path: PROJECT }];
  const treeText = (await tree(PROJECT)).join('\n');
  const now = new Date().toISOString();
  const workspace = { id: 'smoke', name: 'todo-api', folders, createdAt: now, updatedAt: now };

  const makeTask = (
    graph: GraphEntry,
    parent?: GraphEntry,
    snippet?: GenerationTask['codeSnippet'],
  ): GenerationTask => ({
    workspace,
    conversation: {
      id: 'smoke',
      title: 'Smoke',
      workspaceId: 'smoke',
      createdAt: now,
      updatedAt: now,
      graphs: [graph],
    },
    graph,
    ...(parent ? { parent } : {}),
    ancestors: parent ? [parent] : [],
    settings,
    overview: overview(),
    tree: treeText,
    ...(snippet ? { codeSnippet: snippet } : {}),
  });

  let task: GenerationTask;
  let forkSessionId: string | undefined;
  const question = entry({ type: 'question' }, 'How does this app work?', provider);
  if (step === 'detect') {
    console.log(JSON.stringify(await registry.info(provider, settings), null, 2));
    await registry.dispose();
    return;
  }
  if (step === 'test') {
    console.log(await registry.test(provider, settings));
    await registry.dispose();
    return;
  }
  if (step === 'repair') {
    // Tiny connectivity prompt whose first (valid) answer is rejected once: exercises the repair round.
    let calls = 0;
    const started = Date.now();
    const activity: { kind: string; text: string }[] = [];
    const result = await registry.get(provider).run({
      task: makeTask(question),
      prompt: buildTestPrompt(),
      outputSchema: TEST_OUTPUT_SCHEMA,
      folders,
      ...(model ? { model } : {}),
      providerSettings: ps,
      settings,
      timeoutMs: 180_000,
      signal: new AbortController().signal,
      onActivity: (a) => activity.push({ kind: a.kind, text: a.text }),
      validate: () =>
        ++calls === 1
          ? { ok: false, error: 'Synthetic rejection to test the repair round.' }
          : { ok: true },
      purpose: 'test',
    });
    console.log({
      durationMs: Date.now() - started,
      validateCalls: calls,
      output: result.output,
      session: result.session,
      usage: result.usage,
      warnings: result.warnings,
      activity,
    });
    await registry.dispose();
    return;
  }
  if (step === 'question' || step === 'prompt') {
    task = makeTask(question);
  } else if (step === 'expand') {
    const prev = JSON.parse(
      await readFile(join(RESULTS, `${provider}-question.json`), 'utf8'),
    ) as Saved;
    const norm = normalizeGraphSpec(prev.result.output);
    if (!norm.ok) throw new Error('previous question result is invalid');
    const parent: GraphEntry = {
      ...prev.entry,
      status: 'done',
      spec: norm.spec,
      session: prev.result.session,
    };
    const target =
      norm.spec.nodes.find((n) => /service/i.test(n.label)) ??
      norm.spec.nodes.find((n) => n.highlight && n.expandable) ??
      norm.spec.nodes[0];
    if (!target) throw new Error('no node to expand');
    console.log(`expanding "${target.label}" (${target.id})`);
    task = makeTask(
      entry(
        { type: 'expand', parentGraphId: parent.id, nodeId: target.id, nodeLabel: target.label },
        `Expand: ${target.label}`,
        provider,
      ),
      parent,
    );
    const info = await registry.info(provider, settings);
    if (info.capabilities.fork && ps.reuseSessions && prev.result.session)
      forkSessionId = prev.result.session.id;
  } else if (step === 'code') {
    const text = FILES['src/todoService.js'] as string;
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l.startsWith('async function complete')) + 1;
    const ref = {
      folder: 'todo-api',
      path: 'src/todoService.js',
      startLine: start,
      endLine: start + 6,
    };
    const snippet = lines.slice(start - 1, start + 6).join('\n');
    task = makeTask(
      entry({ type: 'ask-code', ref }, 'What can go wrong here?', provider),
      undefined,
      {
        ref,
        text: snippet,
        language: 'javascript',
      },
    );
  } else {
    throw new Error(`unknown step ${step}`);
  }

  const prompt = buildPrompt(task);
  if (step === 'prompt') {
    console.log('----- SYSTEM -----\n' + prompt.system + '\n----- USER -----\n' + prompt.user);
    console.log(`\n(system ${prompt.system.length} chars, user ${prompt.user.length} chars)`);
    return;
  }
  const activity: { kind: string; text: string }[] = [];
  const started = Date.now();
  const result = await registry.get(provider).run({
    task,
    prompt,
    outputSchema: GRAPH_OUTPUT_SCHEMA,
    folders,
    ...(model ? { model } : {}),
    providerSettings: ps,
    settings,
    ...(forkSessionId ? { forkSessionId } : {}),
    timeoutMs: 300_000,
    signal: new AbortController().signal,
    onActivity: (a) => {
      activity.push({ kind: a.kind, text: a.text });
      if (process.env.SMOKE_VERBOSE)
        console.log(`  · ${a.kind}: ${a.text}${a.path ? ` (${relative(PROJECT, a.path)})` : ''}`);
    },
    validate: (o) => {
      const r = normalizeGraphSpec(o);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
  });
  const saved: Saved = { entry: task.graph, result, activity, durationMs: Date.now() - started };
  await writeFile(join(RESULTS, `${provider}-${step}.json`), JSON.stringify(saved, null, 2));
  report(`${provider} ${step}`, saved);
  const norm = normalizeGraphSpec(result.output);
  if (norm.ok) {
    const problems = await checkRefs(norm.spec);
    console.log(problems.length ? `ref problems: ${problems.join('; ')}` : 'refs: all exist ✓');
  }
  await registry.dispose();
}

main().catch((e: unknown) => {
  console.error('FAILED:', e);
  process.exitCode = 1;
});
