/** Shared builders for the agent tests (tasks, requests, temp dirs, settings). */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import {
  defaultSettings,
  normalizeGraphSpec,
  type GraphEntry,
  type GraphOrigin,
  type GraphSpec,
  type Settings,
} from '@codesplainer/shared';
import { buildPrompt } from '../../src/agents/prompt';
import { GRAPH_OUTPUT_SCHEMA } from '../../src/agents/schema';
import type { ActivityInput, AgentRunRequest, GenerationTask } from '../../src/agents/types';

// Fake CLIs are `#!/usr/bin/env node` scripts: make sure `node` resolves to this runtime.
if (!(process.env.PATH ?? '').split(delimiter).includes(dirname(process.execPath))) {
  process.env.PATH = `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`;
}

export async function tempDir(prefix = 'cs-agents-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Write files (path → content) below a root. */
export async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content, 'utf8');
  }
}

export function makeSettings(patch: (s: Settings) => void = () => undefined): Settings {
  const s = defaultSettings();
  patch(s);
  return s;
}

let counter = 0;

export function makeEntry(
  origin: GraphOrigin,
  question: string,
  extra: Partial<GraphEntry> = {},
): GraphEntry {
  counter++;
  return {
    id: extra.id ?? `g${counter}`,
    origin,
    question,
    status: 'running',
    provider: 'mock',
    detail: 'balanced',
    warnings: [],
    createdAt: new Date().toISOString(),
    activity: [],
    attempt: 1,
    ...extra,
  };
}

export function makeTask(opts: {
  folders: { alias: string; path: string }[];
  graph: GraphEntry;
  parent?: GraphEntry;
  ancestors?: GraphEntry[];
  settings?: Settings;
  tree?: string;
  codeSnippet?: GenerationTask['codeSnippet'];
}): GenerationTask {
  const now = new Date().toISOString();
  const graphs = [...(opts.ancestors ?? []), opts.graph];
  return {
    workspace: {
      id: 'ws1',
      name: 'Demo project',
      folders: opts.folders,
      createdAt: now,
      updatedAt: now,
    },
    conversation: {
      id: 'c1',
      title: 'Demo',
      workspaceId: 'ws1',
      createdAt: now,
      updatedAt: now,
      graphs,
    },
    graph: opts.graph,
    ...(opts.parent ? { parent: opts.parent } : {}),
    ancestors: opts.ancestors ?? (opts.parent ? [opts.parent] : []),
    settings: opts.settings ?? makeSettings(),
    ...(opts.tree ? { tree: opts.tree } : {}),
    ...(opts.codeSnippet ? { codeSnippet: opts.codeSnippet } : {}),
  };
}

/** The validate function the generation service uses. */
export function validateSpec(output: unknown): { ok: true } | { ok: false; error: string } {
  const r = normalizeGraphSpec(output);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export function makeRequest(
  task: GenerationTask,
  opts: Partial<AgentRunRequest> & { activity?: ActivityInput[] } = {},
): AgentRunRequest {
  const provider = task.graph.provider;
  const activity = opts.activity ?? [];
  return {
    task,
    prompt: buildPrompt(task),
    outputSchema: GRAPH_OUTPUT_SCHEMA,
    folders: task.workspace.folders,
    providerSettings: task.settings.providers[provider],
    settings: task.settings,
    timeoutMs: 20_000,
    signal: new AbortController().signal,
    onActivity: (item) => activity.push(item),
    validate: validateSpec,
    ...opts,
  };
}

export function specOf(output: unknown): GraphSpec {
  const r = normalizeGraphSpec(output);
  if (!r.ok) throw new Error(`Invalid spec: ${r.error}`);
  return r.spec;
}

/** A small valid spec used as parent diagram. */
export function parentSpec(alias: string): GraphSpec {
  return specOf({
    title: 'Demo overview',
    summary: 'App uses the store and a logger.',
    kind: 'architecture',
    nodes: [
      {
        id: 'app',
        label: 'app.ts',
        kind: 'file',
        detail: 'Entry point',
        refs: [{ folder: alias, path: 'src/app.ts' }],
      },
      {
        id: 'db',
        label: 'db/',
        kind: 'module',
        detail: 'Persistence',
        refs: [{ folder: alias, path: 'src/db' }],
      },
      { id: 'lib', label: 'lib/', kind: 'module', refs: [{ folder: alias, path: 'lib' }] },
      { id: 'user', label: 'User', kind: 'actor', expandable: false },
    ],
    edges: [
      { from: 'user', to: 'app', label: 'runs', kind: 'call' },
      { from: 'app', to: 'db', label: 'saves', kind: 'write' },
      { from: 'app', to: 'lib', label: 'logs', kind: 'call' },
    ],
  });
}

/** Small project used by several tests. */
export const DEMO_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'demo-proj', version: '1.0.0' }, null, 2),
  'README.md': '# Demo\n',
  'src/app.ts': [
    "import { save } from './db/store';",
    "import { log } from '../lib/log';",
    '',
    'export function main(): void {',
    '  const value = save();',
    '  if (!value) {',
    "    log('nothing saved');",
    '  }',
    '  return;',
    '}',
    '',
    'export class App {',
    '  run(): void {',
    '    main();',
    '  }',
    '}',
    '',
  ].join('\n'),
  'src/db/store.ts': [
    'export function save(): number {',
    '  return 1;',
    '}',
    '',
    'export function load(): number {',
    '  return save();',
    '}',
    '',
  ].join('\n'),
  'lib/log.ts': [
    'export function log(message: string): void {',
    '  console.log(message);',
    '}',
    '',
  ].join('\n'),
};
