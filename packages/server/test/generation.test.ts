/** GenerationService behaviour with scripted fake providers (forking, failures, queue, activity). */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ActivityItem, Conversation, GraphEntry, Workspace } from '@codesplainer/shared';
import { GRAPH_OUTPUT_SCHEMA } from '../src/agents/schema';
import { AgentError } from '../src/agents/types';
import {
  PROJECT_FILES,
  ask,
  call,
  createConversation,
  createWorkspace,
  expectStatus,
  fakeProvider,
  getConversation,
  hang,
  makeProject,
  removeDir,
  simpleAnswer,
  startServer,
  waitFor,
  waitForGraph,
  type TestServer,
} from './support';

const claude = fakeProvider('claude', { fork: true });
const codex = fakeProvider('codex', { fork: true });
const acp = fakeProvider('acp', { fork: false });

let server: TestServer;
let project: string;
let ws: Workspace;

beforeAll(async () => {
  project = await makeProject();
  server = await startServer({ fakes: { claude, codex, acp } });
  ws = await createWorkspace(server, [project]);
});

afterEach(async () => {
  claude.reset();
  codex.reset();
  acp.reset();
  await call(server, 'PUT', '/api/settings', {
    maxConcurrentJobs: 2,
    defaultProvider: 'kiro',
    detail: 'balanced',
    providers: { claude: { reuseSessions: true, model: '' }, mock: { enabled: true } },
  });
});

afterAll(async () => {
  await server.close();
  await removeDir(server.dataDir);
  await removeDir(project);
});

const alias = () => ws.folders[0]!.alias;
const newConversation = (title?: string): Promise<Conversation> =>
  createConversation(server, ws.id, title);
const lastRequest = (p: typeof claude) => p.requests[p.requests.length - 1]!;

async function done(convId: string, body: Parameters<typeof ask>[2]): Promise<GraphEntry> {
  const created = await ask(server, convId, body);
  return waitForGraph(server, convId, created.id);
}

describe('generation', () => {
  it('builds the task, resolves refs and stores the result', async () => {
    const conv = await newConversation();
    const graph = await done(conv.id, {
      question: 'Explain the app',
      origin: { type: 'question' },
      provider: 'claude',
    });
    const req = lastRequest(claude);
    expect(req.task.graph.id).toBe(graph.id);
    expect(req.task.workspace.id).toBe(ws.id);
    expect(req.task.parent).toBeUndefined();
    expect(req.task.ancestors).toEqual([]);
    expect(req.task.overview?.workspaceId).toBe(ws.id);
    expect(req.task.tree?.split('\n')[0]).toBe(`${alias()}/  (${project})`);
    expect(req.prompt.system.length).toBeGreaterThan(100);
    expect(req.prompt.user).toContain('Explain the app');
    expect(req.outputSchema).toBe(GRAPH_OUTPUT_SCHEMA);
    expect(req.folders).toEqual([{ alias: alias(), path: project }]);
    expect(req.model).toBeUndefined();
    expect(req.forkSessionId).toBeUndefined();
    expect(req.timeoutMs).toBe(900_000);
    expect(req.validate({ nodes: [] })).toMatchObject({ ok: false });
    expect(req.validate({ nodes: [{ label: 'A' }] })).toEqual({ ok: true });

    expect(graph.status).toBe('done');
    const [app, db, ghost] = graph.spec!.nodes;
    expect(app?.refs).toEqual([{ folder: alias(), path: 'src/app.ts', startLine: 4, endLine: 16 }]);
    expect(db?.refs).toEqual([{ folder: alias(), path: 'src/db', isDir: true }]);
    expect(ghost?.refs).toEqual([]);
    expect(graph.warnings).toContain('Removed 1 reference(s) to missing files');
    expect(graph.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      durationMs: expect.any(Number),
    });
    expect(graph.session).toEqual({ provider: 'claude', id: expect.stringMatching(/^session-/) });
    expect(graph.activity.map((a) => a.text)).toEqual([
      'Starting Claude Code',
      'Reading src/app.ts',
    ]);
    expect(graph.startedAt! <= graph.completedAt!).toBe(true);
  });

  it('forks the parent session for follow-ups of the same provider', async () => {
    const conv = await newConversation();
    const root = await done(conv.id, {
      question: 'Root',
      origin: { type: 'question' },
      provider: 'claude',
    });
    const sessionId = root.session!.id;
    const expandBody = {
      origin: {
        type: 'expand' as const,
        parentGraphId: root.id,
        nodeId: 'app',
        nodeLabel: 'app.ts',
      },
      provider: 'claude' as const,
    };
    const child = await done(conv.id, expandBody);
    expect(lastRequest(claude).forkSessionId).toBe(sessionId);
    expect(lastRequest(claude).task.parent?.id).toBe(root.id);
    expect(lastRequest(claude).task.ancestors.map((a) => a.id)).toEqual([root.id]);

    // Fresh retry: no fork. Normal retry: fork again.
    await call(server, 'POST', `/api/conversations/${conv.id}/graphs/${child.id}/retry`, {
      fresh: true,
    });
    await waitForGraph(server, conv.id, child.id, (g) => g.attempt === 2 && g.status === 'done');
    expect(lastRequest(claude).forkSessionId).toBeUndefined();
    await call(server, 'POST', `/api/conversations/${conv.id}/graphs/${child.id}/retry`, {});
    await waitForGraph(server, conv.id, child.id, (g) => g.attempt === 3 && g.status === 'done');
    expect(lastRequest(claude).forkSessionId).toBe(sessionId);

    // Grandchild: ancestors are root..parent.
    await done(conv.id, {
      question: 'Why?',
      origin: { type: 'ask-node', parentGraphId: child.id, nodeId: 'db', nodeLabel: '' },
      provider: 'claude',
    });
    expect(lastRequest(claude).task.ancestors.map((a) => a.id)).toEqual([root.id, child.id]);
    expect(lastRequest(claude).task.graph.origin).toMatchObject({ nodeLabel: 'db/' });

    // Session reuse switched off.
    await call(server, 'PUT', '/api/settings', { providers: { claude: { reuseSessions: false } } });
    await done(conv.id, expandBody);
    expect(lastRequest(claude).forkSessionId).toBeUndefined();

    // Another provider cannot fork a Claude session.
    await done(conv.id, { ...expandBody, provider: 'codex' });
    expect(lastRequest(codex).forkSessionId).toBeUndefined();

    // A provider without fork support never forks.
    const acpRoot = await done(conv.id, {
      question: 'Root 2',
      origin: { type: 'question' },
      provider: 'acp',
    });
    await done(conv.id, {
      ...expandBody,
      origin: { ...expandBody.origin, parentGraphId: acpRoot.id },
      provider: 'acp',
    });
    expect(lastRequest(acp).forkSessionId).toBeUndefined();
  });

  it('validates questions and origins', async () => {
    const conv = await newConversation();
    const url = `/api/conversations/${conv.id}/ask`;
    const post = (body: unknown) => call(server, 'POST', url, body);
    expect((await post({ question: '  ', origin: { type: 'question' } })).status).toBe(400);
    expect((await post({ origin: { type: 'bogus' } })).status).toBe(400);
    expect(
      (await post({ question: 'x', origin: { type: 'question' }, provider: 'gpt' })).status,
    ).toBe(400);
    expect(
      (await post({ question: 'x', origin: { type: 'ask-graph', parentGraphId: 'nope' } })).status,
    ).toBe(404);
    expect(
      (
        await call(server, 'POST', '/api/conversations/nope/ask', {
          question: 'x',
          origin: { type: 'question' },
        })
      ).status,
    ).toBe(404);

    claude.behave(hang);
    const pending = await ask(server, conv.id, {
      question: 'Slow',
      origin: { type: 'question' },
      provider: 'claude',
    });
    const notDone = await post({
      origin: { type: 'expand', parentGraphId: pending.id, nodeId: 'app', nodeLabel: 'app' },
    });
    expect(notDone.status).toBe(400);
    expect(notDone.json).toMatchObject({
      error: { message: expect.stringMatching(/not finished/) },
    });
    const retryPending = await call(
      server,
      'POST',
      `/api/conversations/${conv.id}/graphs/${pending.id}/retry`,
      {},
    );
    expect(retryPending.status).toBe(409);
    await call(server, 'POST', `/api/conversations/${conv.id}/graphs/${pending.id}/cancel`, {});

    claude.reset();
    const root = await done(conv.id, {
      question: 'Root',
      origin: { type: 'question' },
      provider: 'claude',
    });
    const emptyNodeQuestion = await post({
      question: '',
      origin: { type: 'ask-node', parentGraphId: root.id, nodeId: 'app', nodeLabel: 'app' },
    });
    expect(emptyNodeQuestion.status).toBe(400);
    const emptyGraphQuestion = await post({
      origin: { type: 'ask-graph', parentGraphId: root.id },
    });
    expect(emptyGraphQuestion.status).toBe(400);
  });

  it('fails fast when a provider is unavailable or disabled', async () => {
    const conv = await newConversation();
    const kiro = await done(conv.id, {
      question: 'x',
      origin: { type: 'question' },
      provider: 'kiro',
    });
    expect(kiro.status).toBe('error');
    expect(kiro.error).toBe('Kiro CLI is not available: not installed (test)');
    expect(kiro.activity.at(-1)).toMatchObject({ kind: 'error', text: kiro.error });

    await call(server, 'PUT', '/api/settings', { providers: { mock: { enabled: false } } });
    const mock = await done(conv.id, {
      question: 'x',
      origin: { type: 'question' },
      provider: 'mock',
    });
    expect(mock.status).toBe('error');
    expect(mock.error).toMatch(/Demo \(offline\) is disabled/);
  });

  it('records failures with partial results and the raw answer', async () => {
    const conv = await newConversation();
    claude.behave(async () => {
      throw new AgentError('process', 'Claude Code exited with code 1:\n  boom\n  at line 3', {
        rawText: 'partial garbage',
        usage: { inputTokens: 7 },
        session: { provider: 'claude', id: 'broken-session' },
      });
    });
    const failed = await done(conv.id, {
      question: 'x',
      origin: { type: 'question' },
      provider: 'claude',
    });
    expect(failed).toMatchObject({
      status: 'error',
      error: 'Claude Code exited with code 1: boom at line 3',
      usage: { inputTokens: 7 },
      session: { provider: 'claude', id: 'broken-session' },
    });
    const raw = await call<{ text: string | null }>(
      server,
      'GET',
      `/api/conversations/${conv.id}/graphs/${failed.id}/raw`,
    );
    expect(expectStatus(raw, 200).text).toBe('partial garbage');

    claude.behave(async () => {
      throw new AgentError('timeout', 'The agent did not finish in time.');
    });
    const timedOut = await done(conv.id, {
      question: 'x',
      origin: { type: 'question' },
      provider: 'claude',
    });
    expect(timedOut.error).toBe('Timed out after 900 s');

    claude.behave(async () => ({
      output: { nothing: true },
      rawText: 'not a diagram',
      warnings: [],
    }));
    const invalid = await done(conv.id, {
      question: 'x',
      origin: { type: 'question' },
      provider: 'claude',
    });
    expect(invalid.status).toBe('error');
    expect(invalid.error).toMatch(/^The answer is not a valid diagram:/);
    const invalidRaw = await call<{ text: string | null }>(
      server,
      'GET',
      `/api/conversations/${conv.id}/graphs/${invalid.id}/raw`,
    );
    expect(invalidRaw.json.text).toBe('not a diagram');

    claude.behave(async () => {
      throw new Error('kaboom');
    });
    const crashed = await done(conv.id, {
      question: 'x',
      origin: { type: 'question' },
      provider: 'claude',
    });
    expect(crashed).toMatchObject({ status: 'error', error: 'kaboom' });

    // A repaired answer succeeds, and its raw text is kept for inspection.
    claude.behave(async (req) => ({
      ...simpleAnswer(req, 1),
      rawText: 'repaired raw',
      warnings: ['First answer was invalid (no nodes); asked for a fix.'],
    }));
    const repaired = await done(conv.id, {
      question: 'x',
      origin: { type: 'question' },
      provider: 'claude',
    });
    expect(repaired.status).toBe('done');
    expect(repaired.warnings).toContain('First answer was invalid (no nodes); asked for a fix.');
    const repairedRaw = await call<{ text: string | null }>(
      server,
      'GET',
      `/api/conversations/${conv.id}/graphs/${repaired.id}/raw`,
    );
    expect(repairedRaw.json.text).toBe('repaired raw');

    // Retrying clears the previous attempt's error, usage and raw answer.
    claude.reset();
    await call(server, 'POST', `/api/conversations/${conv.id}/graphs/${failed.id}/retry`, {});
    const fixed = await waitForGraph(
      server,
      conv.id,
      failed.id,
      (g) => g.attempt === 2 && g.status === 'done',
    );
    expect(fixed.error).toBeUndefined();
    expect(fixed.usage?.inputTokens).toBe(10);
    const cleared = await call<{ text: string | null }>(
      server,
      'GET',
      `/api/conversations/${conv.id}/graphs/${failed.id}/raw`,
    );
    expect(cleared.json.text).toBeNull();
  });

  it('keeps the live activity log while running and stores the last 100 items', async () => {
    const conv = await newConversation();
    claude.behave(async (req) => {
      for (let i = 0; i < 350; i++) req.onActivity({ kind: 'tool', text: `step ${i}` });
      return hang(req);
    });
    const graph = await ask(server, conv.id, {
      question: 'x',
      origin: { type: 'question' },
      provider: 'claude',
    });
    const url = `/api/conversations/${conv.id}/graphs/${graph.id}/activity`;
    const live = await waitFor(async () => {
      const res = await call<{ activity: ActivityItem[] }>(server, 'GET', url);
      return res.json.activity.at(-1)?.text === 'Thinking hard' ? res.json.activity : undefined;
    });
    expect(live).toHaveLength(300);
    for (let i = 1; i < live.length; i++) expect(live[i]!.ts > live[i - 1]!.ts).toBe(true);
    const viewed = (await getConversation(server, conv.id)).graphs.find((g) => g.id === graph.id)!;
    expect(viewed.status).toBe('running');
    expect(viewed.activity).toEqual(live.slice(-100));

    const cancelled = await call<{ graph: GraphEntry }>(
      server,
      'POST',
      `/api/conversations/${conv.id}/graphs/${graph.id}/cancel`,
      {},
    );
    expect(expectStatus(cancelled, 200).graph.activity).toEqual(live.slice(-100));
    const stored = await call<{ activity: ActivityItem[] }>(server, 'GET', url);
    expect(stored.json.activity).toEqual(live.slice(-100));
  });

  it('respects the concurrency limit from the settings', async () => {
    await call(server, 'PUT', '/api/settings', { maxConcurrentJobs: 1 });
    claude.behave(hang);
    const conv = await newConversation();
    const a = await ask(server, conv.id, {
      question: 'A',
      origin: { type: 'question' },
      provider: 'claude',
    });
    const b = await ask(server, conv.id, {
      question: 'B',
      origin: { type: 'question' },
      provider: 'claude',
    });
    expect(a.status).toBe('running');
    expect(b.status).toBe('queued');
    let graphs = (await getConversation(server, conv.id)).graphs;
    expect(graphs.map((g) => g.status)).toEqual(['running', 'queued']);
    expect(server.ctx.generation.pendingJobs).toBe(2);

    await call(server, 'POST', `/api/conversations/${conv.id}/graphs/${a.id}/cancel`, {});
    await waitForGraph(server, conv.id, b.id, (g) => g.status === 'running');
    graphs = (await getConversation(server, conv.id)).graphs;
    expect(graphs.map((g) => g.status)).toEqual(['cancelled', 'running']);

    // Raising the limit starts a waiting job right away.
    const c = await ask(server, conv.id, {
      question: 'C',
      origin: { type: 'question' },
      provider: 'claude',
    });
    expect(c.status).toBe('queued');
    await call(server, 'PUT', '/api/settings', { maxConcurrentJobs: 2 });
    await waitForGraph(server, conv.id, c.id, (g) => g.status === 'running');

    // Cancelling a queued job just dequeues it.
    const d = await ask(server, conv.id, {
      question: 'D',
      origin: { type: 'question' },
      provider: 'claude',
    });
    expect(d.status).toBe('queued');
    const res = await call<{ graph: GraphEntry }>(
      server,
      'POST',
      `/api/conversations/${conv.id}/graphs/${d.id}/cancel`,
      {},
    );
    expect(expectStatus(res, 200).graph.status).toBe('cancelled');
    for (const g of [b, c]) {
      await call(server, 'POST', `/api/conversations/${conv.id}/graphs/${g.id}/cancel`, {});
    }
    await waitFor(() => server.ctx.generation.pendingJobs === 0);
    graphs = (await getConversation(server, conv.id)).graphs;
    expect(graphs.map((g) => g.status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
  });

  it('stops the jobs of deleted diagrams and conversations', async () => {
    claude.behave(hang);
    const conv = await newConversation();
    const g = await ask(server, conv.id, {
      question: 'x',
      origin: { type: 'question' },
      provider: 'claude',
    });
    await waitFor(() => claude.requests.some((r) => r.task.graph.id === g.id));
    const req = claude.requests.find((r) => r.task.graph.id === g.id)!;
    const res = await call<{ deleted: string[] }>(
      server,
      'DELETE',
      `/api/conversations/${conv.id}/graphs/${g.id}`,
    );
    expect(expectStatus(res, 200).deleted).toEqual([g.id]);
    expect(req.signal.aborted).toBe(true);
    expect((await getConversation(server, conv.id)).graphs).toEqual([]);

    const conv2 = await newConversation();
    const g2 = await ask(server, conv2.id, {
      question: 'y',
      origin: { type: 'question' },
      provider: 'claude',
    });
    await waitFor(() => claude.requests.some((r) => r.task.graph.id === g2.id));
    const req2 = claude.requests.find((r) => r.task.graph.id === g2.id)!;
    expect(
      expectStatus(await call(server, 'DELETE', `/api/conversations/${conv2.id}`), 200),
    ).toEqual({ ok: true });
    expect(req2.signal.aborted).toBe(true);
    await waitFor(() => server.ctx.generation.pendingJobs === 0);
  });

  it('auto-titles conversations from their first root question only', async () => {
    const conv = await newConversation();
    const long = `How does the ${'very '.repeat(20)}long pipeline work?`;
    await done(conv.id, { question: long, origin: { type: 'question' }, provider: 'claude' });
    const titled = await getConversation(server, conv.id);
    expect(titled.title.length).toBeLessThanOrEqual(60);
    expect(titled.title.endsWith('…')).toBe(true);
    await done(conv.id, {
      question: 'Second question',
      origin: { type: 'question' },
      provider: 'claude',
    });
    expect((await getConversation(server, conv.id)).title).toBe(titled.title);

    const custom = await newConversation('My own title');
    await done(custom.id, {
      question: 'Anything',
      origin: { type: 'question' },
      provider: 'claude',
    });
    expect((await getConversation(server, custom.id)).title).toBe('My own title');
  });

  it('picks provider, model and detail from the request or the settings', async () => {
    const conv = await newConversation();
    const explicit = await done(conv.id, {
      question: 'x',
      origin: { type: 'question' },
      provider: 'claude',
      model: 'opus',
      detail: 'simple',
    });
    expect(explicit).toMatchObject({ provider: 'claude', model: 'opus', detail: 'simple' });
    expect(lastRequest(claude).model).toBe('opus');

    await call(server, 'PUT', '/api/settings', {
      defaultProvider: 'claude',
      detail: 'detailed',
      providers: { claude: { model: 'sonnet' } },
    });
    const defaults = await done(conv.id, { question: 'y', origin: { type: 'question' } });
    expect(defaults).toMatchObject({ provider: 'claude', detail: 'detailed' });
    expect(defaults.model).toBeUndefined();
    expect(lastRequest(claude).model).toBe('sonnet');

    await call(server, 'POST', `/api/conversations/${conv.id}/graphs/${explicit.id}/retry`, {
      provider: 'codex',
    });
    const switched = await waitForGraph(
      server,
      conv.id,
      explicit.id,
      (g) => g.attempt === 2 && g.status === 'done',
    );
    expect(switched.provider).toBe('codex');
    expect(switched.model).toBeUndefined();
    expect(lastRequest(codex).task.graph.id).toBe(explicit.id);
  });

  it('picks effort and fast mode from the request or the provider settings', async () => {
    const conv = await newConversation();
    const explicit = await done(conv.id, {
      question: 'x',
      origin: { type: 'question' },
      provider: 'claude',
      effort: 'max',
      fast: true,
    });
    expect(explicit).toMatchObject({ effort: 'max', fast: true });
    expect(lastRequest(claude)).toMatchObject({ effort: 'max', fast: true });

    await call(server, 'PUT', '/api/settings', {
      providers: { claude: { effort: 'low', fast: true } },
    });
    const defaults = await done(conv.id, {
      question: 'y',
      origin: { type: 'question' },
      provider: 'claude',
    });
    expect(defaults.effort).toBeUndefined();
    expect(defaults.fast).toBeUndefined();
    expect(lastRequest(claude)).toMatchObject({ effort: 'low', fast: true });

    // A retry keeps the diagram's options; another provider starts from its own settings.
    await call(server, 'POST', `/api/conversations/${conv.id}/graphs/${explicit.id}/retry`, {
      fast: false,
    });
    await waitForGraph(server, conv.id, explicit.id, (g) => g.attempt === 2 && g.status === 'done');
    expect(lastRequest(claude)).toMatchObject({ effort: 'max', fast: false });
    await call(server, 'POST', `/api/conversations/${conv.id}/graphs/${explicit.id}/retry`, {
      provider: 'codex',
    });
    const switched = await waitForGraph(
      server,
      conv.id,
      explicit.id,
      (g) => g.attempt === 3 && g.status === 'done',
    );
    expect(switched.effort).toBeUndefined();
    expect(switched.fast).toBeUndefined();
    expect(lastRequest(codex)).toMatchObject({ fast: false });
    expect(lastRequest(codex).effort).toBeUndefined();

    // Effort is a CLI argument: anything but a lowercase word is refused.
    const bad = await call(server, 'POST', `/api/conversations/${conv.id}/ask`, {
      question: 'z',
      origin: { type: 'question' },
      effort: 'high --danger',
    });
    expect(bad.status).toBe(400);
  });

  it('passes the selected code to ask-code prompts', async () => {
    const conv = await newConversation();
    await done(conv.id, {
      question: '',
      origin: {
        type: 'ask-code',
        ref: { folder: alias(), path: 'src/app.ts', startLine: 4, endLine: 6 },
      },
      provider: 'claude',
    });
    const snippet = lastRequest(claude).task.codeSnippet!;
    const expected = PROJECT_FILES['src/app.ts']!.split('\n').slice(3, 6).join('\n');
    expect(snippet.text).toBe(expected);
    expect(snippet.ref).toMatchObject({
      folder: alias(),
      path: 'src/app.ts',
      startLine: 4,
      endLine: 6,
    });
    expect(snippet.language).toBe('typescript');
    expect(lastRequest(claude).task.graph.question).toBe('Explain src/app.ts:4-6');
  });
});
