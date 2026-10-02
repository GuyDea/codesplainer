/** Shared helpers for the server tests: temp dirs, fake providers, app + request helpers. */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  APP_VERSION,
  CLIENT_HEADER,
  CLIENT_HEADER_VALUE,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  isPending,
  type AskBody,
  type Conversation,
  type GraphEntry,
  type ProviderId,
  type ProviderInfo,
  type ServerEvent,
  type Settings,
  type Workspace,
} from '@codesplainer/shared';
import { createApp, type AppOverrides, type CodesplainerApp } from '../src/app';
import { ProcessTracker } from '../src/agents/process';
import { createMockProvider } from '../src/agents/providers/mock';
import {
  AgentError,
  type AgentProvider,
  type AgentRunRequest,
  type AgentRunResult,
  type DetectedProvider,
  type ProviderRegistry,
} from '../src/agents/types';
import type { ServerConfig } from '../src/config';
import { silentLogger } from '../src/log';

process.env.CODESPLAINER_MOCK_DELAY_MS = '0';

export async function tempDir(prefix = 'cs-server-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Write files (relative path -> content) below a root. */
export async function writeTree(
  root: string,
  files: Record<string, string | Buffer>,
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }
}

export function makeConfig(dataDir: string, patch: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir,
    open: false,
    browser: false,
    folders: [],
    cwd: dataDir,
    warnings: [],
    ...patch,
  };
}

/** A small TypeScript project. */
export const PROJECT_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'demo-proj', version: '1.0.0' }, null, 2),
  'README.md': '# Demo\n',
  '.gitignore': 'secret.txt\nlogs/\n',
  'secret.txt': 'ignored by .gitignore',
  'logs/app.log': 'ignored',
  'node_modules/dep/index.js': 'module.exports = 1;',
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

// ---- fake providers ----------------------------------------------------------------------------

type Run = (req: AgentRunRequest) => Promise<AgentRunResult>;

export interface FakeProvider extends AgentProvider {
  requests: AgentRunRequest[];
  /** Replace the run behaviour. */
  behave(run: Run): void;
  /** Back to the default behaviour (simpleAnswer); keeps the recorded requests. */
  reset(): void;
}

function detected(id: ProviderId, fork: boolean): DetectedProvider {
  return {
    id,
    name: PROVIDER_LABELS[id],
    description: `Fake ${id}`,
    available: true,
    version: APP_VERSION,
    warnings: [],
    models: [],
    capabilities: { fork, structuredOutput: true, cost: false, streaming: true },
    experimental: false,
  };
}

/** A diagram answer whose refs point into the first workspace folder. */
export function simpleAnswer(req: AgentRunRequest, n: number): AgentRunResult {
  const alias = req.folders[0]?.alias ?? 'x';
  const output = {
    title: `Fake diagram ${n}`,
    summary: 'A fake answer.',
    kind: 'architecture',
    nodes: [
      {
        id: 'app',
        label: 'app.ts',
        kind: 'file',
        refs: [{ folder: alias, path: 'src/app.ts', startLine: 4, endLine: 999 }],
      },
      { id: 'db', label: 'db/', kind: 'module', refs: [{ folder: alias, path: 'src/db' }] },
      {
        id: 'ghost',
        label: 'Ghost',
        kind: 'module',
        refs: [{ folder: alias, path: 'does/not/exist.ts' }],
      },
    ],
    edges: [{ from: 'app', to: 'db', label: 'saves', kind: 'write' }],
  };
  return {
    output,
    rawText: JSON.stringify(output),
    session: { provider: req.task.graph.provider, id: `session-${n}` },
    usage: { inputTokens: 10, outputTokens: 5 },
    warnings: [],
  };
}

/** Fake provider: answers with simpleAnswer (after emitting one activity item) unless told otherwise. */
export function fakeProvider(id: ProviderId, opts: { fork?: boolean } = {}): FakeProvider {
  const requests: AgentRunRequest[] = [];
  let count = 0;
  const initial: Run = async (req) => {
    req.onActivity({ kind: 'tool', text: 'Reading src/app.ts', path: 'src/app.ts' });
    return simpleAnswer(req, count);
  };
  let behaviour = initial;
  return {
    id,
    requests,
    behave(run) {
      behaviour = run;
    },
    reset() {
      behaviour = initial;
    },
    detect: async () => detected(id, opts.fork ?? true),
    run: (req) => {
      requests.push(req);
      count++;
      return behaviour(req);
    },
  };
}

/** Runs until aborted, then rejects like real providers do. */
export const hang: Run = (req) =>
  new Promise((_resolve, reject) => {
    req.onActivity({ kind: 'status', text: 'Thinking hard' });
    const fail = () => reject(new AgentError('cancelled', 'Cancelled.'));
    if (req.signal.aborted) fail();
    else req.signal.addEventListener('abort', fail, { once: true });
  });

/** Registry with the real offline mock provider plus optional fakes; others are unavailable. */
export function testRegistry(
  dataDir: string,
  fakes: Partial<Record<ProviderId, AgentProvider>> = {},
): ProviderRegistry & { disposed: number } {
  const tracker = new ProcessTracker();
  const providers: Partial<Record<ProviderId, AgentProvider>> = {
    mock: createMockProvider({ dataDir, tracker, homeDir: dataDir }),
    ...fakes,
  };
  const info = async (id: ProviderId, settings: Settings): Promise<ProviderInfo> => {
    const p = providers[id];
    const d: DetectedProvider = p
      ? await p.detect(settings, { refresh: false })
      : {
          id,
          name: PROVIDER_LABELS[id],
          description: PROVIDER_LABELS[id],
          available: false,
          reason: 'not installed (test)',
          warnings: [],
          models: [],
          capabilities: { fork: false, structuredOutput: false, cost: false, streaming: false },
          experimental: false,
        };
    return { ...d, enabled: settings.providers[id].enabled };
  };
  const registry = {
    disposed: 0,
    list: (settings: Settings) => Promise.all(PROVIDER_IDS.map((id) => info(id, settings))),
    info,
    get(id: ProviderId): AgentProvider {
      const p = providers[id];
      if (!p) throw new AgentError('unavailable', `Unknown provider ${id}`);
      return p;
    },
    async test(id: ProviderId) {
      return { ok: Boolean(providers[id]), provider: id, durationMs: 1, message: 'test' };
    },
    async dispose() {
      registry.disposed++;
      await tracker.killAll();
    },
  };
  return registry;
}

export interface TestServer extends CodesplainerApp {
  dataDir: string;
}

/** createApp with a temp data dir (unless given), the test registry and a silent logger. */
export async function startServer(
  opts: {
    dataDir?: string;
    config?: Partial<ServerConfig>;
    fakes?: Partial<Record<ProviderId, AgentProvider>>;
    overrides?: AppOverrides;
  } = {},
): Promise<TestServer> {
  const dataDir = opts.dataDir ?? (await tempDir('cs-data-'));
  const server = await createApp(makeConfig(dataDir, opts.config), {
    registry: testRegistry(dataDir, opts.fakes),
    log: silentLogger,
    saveDebounceMs: 10,
    ...opts.overrides,
  });
  return { ...server, dataDir };
}

// ---- requests ------------------------------------------------------------------------------------

export interface Res<T = unknown> {
  status: number;
  json: T;
  body: string;
  headers: Record<string, string | string[] | number | undefined>;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** app.inject with the client header, a localhost Host and JSON bodies. */
export async function call<T = unknown>(
  server: CodesplainerApp,
  method: Method,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Res<T>> {
  const res = await server.app.inject({
    method,
    url,
    headers: {
      host: '127.0.0.1:4777',
      [CLIENT_HEADER]: CLIENT_HEADER_VALUE,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined
      ? { payload: typeof body === 'string' ? body : JSON.stringify(body) }
      : {}),
  });
  let json: unknown;
  try {
    json = res.body ? JSON.parse(res.body) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.statusCode, json: json as T, body: res.body, headers: res.headers };
}

/** Poll until `check` returns a value (not undefined/false). */
export async function waitFor<T>(
  check: () => Promise<T | undefined | false> | T | undefined | false,
  timeoutMs = 10_000,
  intervalMs = 20,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---- API shortcuts -------------------------------------------------------------------------------

/** A temp project (real path) with PROJECT_FILES or the given files. */
export async function makeProject(
  files: Record<string, string | Buffer> = PROJECT_FILES,
  prefix = 'cs-proj-',
): Promise<string> {
  const root = await realpath(await tempDir(prefix));
  await writeTree(root, files);
  return root;
}

/** Assert a status and return the JSON body. */
export function expectStatus<T>(res: Res<T>, status: number): T {
  if (res.status !== status) {
    throw new Error(`Expected HTTP ${status}, got ${res.status}: ${res.body.slice(0, 500)}`);
  }
  return res.json;
}

export async function createWorkspace(
  server: CodesplainerApp,
  folders: string[],
  name?: string,
): Promise<Workspace> {
  const res = await call<Workspace>(server, 'POST', '/api/workspaces', {
    folders,
    ...(name ? { name } : {}),
  });
  return expectStatus(res, 201);
}

export async function createConversation(
  server: CodesplainerApp,
  workspaceId: string,
  title?: string,
): Promise<Conversation> {
  const res = await call<Conversation>(server, 'POST', '/api/conversations', {
    workspaceId,
    ...(title ? { title } : {}),
  });
  return expectStatus(res, 201);
}

export async function getConversation(server: CodesplainerApp, id: string): Promise<Conversation> {
  return expectStatus(await call<Conversation>(server, 'GET', `/api/conversations/${id}`), 200);
}

export async function ask(
  server: CodesplainerApp,
  conversationId: string,
  body: AskBody,
): Promise<GraphEntry> {
  const res = await call<{ graph: GraphEntry }>(
    server,
    'POST',
    `/api/conversations/${conversationId}/ask`,
    body,
  );
  return expectStatus(res, 200).graph;
}

/** Poll the conversation until the diagram satisfies `until` (default: finished). */
export async function waitForGraph(
  server: CodesplainerApp,
  conversationId: string,
  graphId: string,
  until: (g: GraphEntry) => boolean = (g) => !isPending(g.status),
  timeoutMs = 10_000,
): Promise<GraphEntry> {
  return waitFor(async () => {
    const conv = await getConversation(server, conversationId);
    const graph = conv.graphs.find((g) => g.id === graphId);
    return graph && until(graph) ? graph : undefined;
  }, timeoutMs);
}

export interface EventLog {
  events: ServerEvent[];
  of<K extends ServerEvent['type']>(type: K): Extract<ServerEvent, { type: K }>[];
  stop(): void;
}

/** Record every event emitted on the server's bus. */
export function recordEvents(server: CodesplainerApp): EventLog {
  const events: ServerEvent[] = [];
  const stop = server.ctx.bus.on((e) => events.push(structuredClone(e)));
  return {
    events,
    of: <K extends ServerEvent['type']>(type: K) =>
      events.filter((e): e is Extract<ServerEvent, { type: K }> => e.type === type),
    stop,
  };
}
