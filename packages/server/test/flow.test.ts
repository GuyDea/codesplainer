/**
 * End-to-end flow with the offline mock provider: workspace -> conversation -> question -> expand
 * -> ask-code -> retry -> cancel -> follow-up -> delete subtree -> export -> import -> duplicate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parentIdOf,
  type ActivityItem,
  type Conversation,
  type ConversationExport,
  type ConversationSummary,
  type GraphEntry,
  type GraphStatus,
  type ImportResponse,
  type RawOutputResponse,
  type Workspace,
  type WorkspaceBundle,
} from '@codesplainer/shared';
import {
  ask,
  call,
  createConversation,
  createWorkspace,
  expectStatus,
  getConversation,
  makeProject,
  recordEvents,
  removeDir,
  startServer,
  waitForGraph,
  type EventLog,
  type TestServer,
} from './support';

let server: TestServer;
let project: string;
let otherProject: string;
let ws: Workspace;
let conv: Conversation;
let log: EventLog;
const cleanup: string[] = [];

// Filled in by the steps below (the tests of this file run in order).
let q1: GraphEntry;
let e1: GraphEntry;
let c1: GraphEntry;
let q2: GraphEntry;
let f1: GraphEntry;
let exported: ConversationExport;

const QUESTION = 'How is this project organized?';

beforeAll(async () => {
  project = await makeProject();
  otherProject = await makeProject();
  cleanup.push(project, otherProject);
  server = await startServer();
  log = recordEvents(server);
  ws = await createWorkspace(server, [project]);
  conv = await createConversation(server, ws.id);
});

afterAll(async () => {
  log.stop();
  await server.close();
  await removeDir(server.dataDir);
  for (const dir of cleanup) await removeDir(dir);
});

const alias = () => ws.folders[0]!.alias;

describe('conversation flow (mock provider)', () => {
  it('answers a root question and titles the conversation', async () => {
    expect(conv.title).toBe('New conversation');
    const created = await ask(server, conv.id, {
      question: QUESTION,
      origin: { type: 'question' },
      provider: 'mock',
    });
    expect(created).toMatchObject({
      question: QUESTION,
      provider: 'mock',
      detail: 'balanced',
      attempt: 1,
    });
    expect(['queued', 'running']).toContain(created.status);
    q1 = await waitForGraph(server, conv.id, created.id);
    expect(q1.status).toBe('done');
    expect(q1.spec?.nodes.length).toBeGreaterThan(0);
    expect(q1.completedAt).toBeDefined();
    expect(q1.usage?.durationMs).toEqual(expect.any(Number));
    expect(q1.activity.length).toBeGreaterThan(0);
    expect(q1.error).toBeUndefined();
    for (const node of q1.spec!.nodes) {
      for (const ref of node.refs) expect(ref.folder).toBe(alias());
    }
    const fresh = await getConversation(server, conv.id);
    expect(fresh.title).toBe(QUESTION);
    const activity = expectStatus(
      await call<{ activity: ActivityItem[] }>(
        server,
        'GET',
        `/api/conversations/${conv.id}/graphs/${q1.id}/activity`,
      ),
      200,
    );
    expect(activity.activity).toEqual(q1.activity);
    const raw = expectStatus(
      await call<RawOutputResponse>(
        server,
        'GET',
        `/api/conversations/${conv.id}/graphs/${q1.id}/raw`,
      ),
      200,
    );
    expect(raw).toEqual({ text: null });
  });

  it('expands a node (question and label filled in by the server)', async () => {
    const node = q1.spec!.nodes.find((n) => n.expandable) ?? q1.spec!.nodes[0]!;
    const created = await ask(server, conv.id, {
      question: '',
      origin: { type: 'expand', parentGraphId: q1.id, nodeId: node.id, nodeLabel: '' },
      provider: 'mock',
    });
    expect(created.question).toBe(`Expand: ${node.label}`);
    expect(created.origin).toEqual({
      type: 'expand',
      parentGraphId: q1.id,
      nodeId: node.id,
      nodeLabel: node.label,
    });
    e1 = await waitForGraph(server, conv.id, created.id);
    expect(e1.status).toBe('done');
    expect(parentIdOf(e1.origin)).toBe(q1.id);
    const bad = await call(server, 'POST', `/api/conversations/${conv.id}/ask`, {
      origin: { type: 'expand', parentGraphId: q1.id, nodeId: 'no-such-node', nodeLabel: '' },
    });
    expect(bad.status).toBe(404);
  });

  it('asks about a code selection', async () => {
    const created = await ask(server, conv.id, {
      question: 'What does main do?',
      origin: {
        type: 'ask-code',
        ref: { folder: alias(), path: './src/app.ts', startLine: 10, endLine: 4 },
        parentGraphId: e1.id,
      },
      provider: 'mock',
    });
    expect(created.origin).toEqual({
      type: 'ask-code',
      ref: { folder: alias(), path: 'src/app.ts', startLine: 4, endLine: 10 },
      parentGraphId: e1.id,
    });
    c1 = await waitForGraph(server, conv.id, created.id);
    expect(c1.status).toBe('done');
    const missing = await call(server, 'POST', `/api/conversations/${conv.id}/ask`, {
      question: 'x',
      origin: { type: 'ask-code', ref: { folder: alias(), path: 'src/missing.ts' } },
    });
    expect(missing.status).toBe(404);
  });

  it('retries a diagram in place (attempt 2)', async () => {
    const res = await call<{ graph: GraphEntry }>(
      server,
      'POST',
      `/api/conversations/${conv.id}/graphs/${q1.id}/retry`,
      { detail: 'simple' },
    );
    const retried = expectStatus(res, 200).graph;
    expect(retried).toMatchObject({ id: q1.id, attempt: 2, detail: 'simple', warnings: [] });
    expect(retried.spec).toBeUndefined();
    expect(['queued', 'running']).toContain(retried.status);
    q1 = await waitForGraph(server, conv.id, q1.id, (g) => g.attempt === 2 && g.status === 'done');
    expect(q1.spec).toBeDefined();
    const conflict = await call(
      server,
      'POST',
      `/api/conversations/${conv.id}/graphs/nope/retry`,
      {},
    );
    expect(conflict.status).toBe(404);
  });

  it('cancels a running diagram', async () => {
    const previous = process.env.CODESPLAINER_MOCK_DELAY_MS;
    process.env.CODESPLAINER_MOCK_DELAY_MS = '10000';
    try {
      const created = await ask(server, conv.id, {
        question: 'A slow one',
        origin: { type: 'question' },
        provider: 'mock',
      });
      await waitForGraph(
        server,
        conv.id,
        created.id,
        (g) => g.status === 'running' && g.activity.length > 0,
      );
      const res = await call<{ graph: GraphEntry }>(
        server,
        'POST',
        `/api/conversations/${conv.id}/graphs/${created.id}/cancel`,
        {},
      );
      q2 = expectStatus(res, 200).graph;
      expect(q2.status).toBe('cancelled');
      expect(q2.activity.length).toBeGreaterThan(0);
    } finally {
      process.env.CODESPLAINER_MOCK_DELAY_MS = previous;
    }
    await new Promise((r) => setTimeout(r, 100));
    const after = (await getConversation(server, conv.id)).graphs.find((g) => g.id === q2.id)!;
    expect(after.status).toBe('cancelled');
    // Cancelling a finished diagram is a no-op.
    const again = await call<{ graph: GraphEntry }>(
      server,
      'POST',
      `/api/conversations/${conv.id}/graphs/${q2.id}/cancel`,
      {},
    );
    expect(expectStatus(again, 200).graph.status).toBe('cancelled');
  });

  it('asks a follow-up about a whole diagram', async () => {
    const created = await ask(server, conv.id, {
      question: 'What talks to what?',
      origin: { type: 'ask-graph', parentGraphId: q1.id },
      provider: 'mock',
    });
    f1 = await waitForGraph(server, conv.id, created.id);
    expect(f1.status).toBe('done');
    expect(parentIdOf(f1.origin)).toBe(q1.id);
  });

  it('edits a diagram (title, note, star)', async () => {
    const res = await call<{ graph: GraphEntry }>(
      server,
      'PATCH',
      `/api/conversations/${conv.id}/graphs/${f1.id}`,
      {
        title: 'Who talks to whom',
        note: 'Check the store later',
        starred: true,
      },
    );
    const graph = expectStatus(res, 200).graph;
    expect(graph.spec?.title).toBe('Who talks to whom');
    expect(graph).toMatchObject({ note: 'Check the store later', starred: true });
    const cleared = await call<{ graph: GraphEntry }>(
      server,
      'PATCH',
      `/api/conversations/${conv.id}/graphs/${f1.id}`,
      {
        note: '',
        starred: false,
      },
    );
    expect(expectStatus(cleared, 200).graph.note).toBeUndefined();
    expect(expectStatus(cleared, 200).graph.starred).toBeUndefined();
    f1 = expectStatus(cleared, 200).graph;
    // A title without a spec is ignored.
    const noSpec = await call<{ graph: GraphEntry }>(
      server,
      'PATCH',
      `/api/conversations/${conv.id}/graphs/${q2.id}`,
      {
        title: 'x',
      },
    );
    expect(expectStatus(noSpec, 200).graph.spec).toBeUndefined();
  });

  it('deletes a diagram together with its descendants', async () => {
    const before = log.of('graph.deleted').length;
    const res = await call<{ deleted: string[] }>(
      server,
      'DELETE',
      `/api/conversations/${conv.id}/graphs/${e1.id}`,
    );
    expect(expectStatus(res, 200).deleted).toEqual([e1.id, c1.id]);
    const deletedEvents = log.of('graph.deleted').slice(before);
    expect(deletedEvents).toEqual([
      { type: 'graph.deleted', conversationId: conv.id, graphIds: [e1.id, c1.id] },
    ]);
    const fresh = await getConversation(server, conv.id);
    expect(fresh.graphs.map((g) => g.id)).toEqual([q1.id, q2.id, f1.id]);
    expect(
      (await call(server, 'DELETE', `/api/conversations/${conv.id}/graphs/${e1.id}`)).status,
    ).toBe(404);
  });

  it('exports JSON and Markdown downloads', async () => {
    const json = await call<ConversationExport>(
      server,
      'GET',
      `/api/conversations/${conv.id}/export?format=json`,
    );
    expect(json.status).toBe(200);
    expect(json.headers['content-disposition']).toBe(
      'attachment; filename="how-is-this-project-organized.codesplainer.json"',
    );
    exported = json.json;
    expect(exported.format).toBe('codesplainer/conversation');
    expect(exported.workspace.folders).toEqual(ws.folders);
    expect(exported.conversation.graphs.map((g) => g.id)).toEqual([q1.id, q2.id, f1.id]);
    for (const g of exported.conversation.graphs) {
      expect(g.session).toBeUndefined();
      expect(g.activity).toEqual([]);
    }

    const md = await call(server, 'GET', `/api/conversations/${conv.id}/export?format=md`);
    expect(md.status).toBe(200);
    expect(md.headers['content-type']).toMatch(/text\/markdown/);
    expect(md.headers['content-disposition']).toBe(
      'attachment; filename="how-is-this-project-organized.md"',
    );
    expect(md.body).toContain(`# ${QUESTION}`);
    expect(md.body).toContain('```mermaid');
    expect(md.body).toContain(project);

    const bundle = await call<WorkspaceBundle>(server, 'GET', `/api/workspaces/${ws.id}/export`);
    expect(bundle.status).toBe(200);
    expect(bundle.headers['content-disposition']).toMatch(
      /^attachment; filename=".+\.codesplainer\.json"$/,
    );
    expect(bundle.json.format).toBe('codesplainer/bundle');
    expect(bundle.json.conversations.map((c) => c.id)).toEqual([conv.id]);
    expect(
      (await call(server, 'GET', `/api/conversations/${conv.id}/export?format=pdf`)).status,
    ).toBe(400);
    expect((await call(server, 'GET', '/api/conversations/nope/export')).status).toBe(404);
  });

  it('imports into the workspace with the same folders (new ids, parent links intact)', async () => {
    const before = log.events.length;
    const res = await call<ImportResponse>(server, 'POST', '/api/import', { data: exported });
    const body = expectStatus(res, 200);
    expect(body.workspace.id).toBe(ws.id);
    expect(body.conversations).toHaveLength(1);
    const copy = body.conversations[0]!;
    expect(copy.id).not.toBe(conv.id);
    expect(copy.workspaceId).toBe(ws.id);
    const oldIds = new Set([q1.id, q2.id, f1.id]);
    expect(copy.graphs.every((g) => !oldIds.has(g.id))).toBe(true);
    const [cq1, cq2, cf1] = copy.graphs as [GraphEntry, GraphEntry, GraphEntry];
    expect(parentIdOf(cf1.origin)).toBe(cq1.id);
    expect(cq2.status).toBe('cancelled');
    expect(cq1.spec).toEqual(q1.spec);
    const events = log.events.slice(before);
    expect(events.filter((e) => e.type === 'workspace.updated')).toEqual([]);
    expect(
      events.some((e) => e.type === 'conversation.updated' && e.conversation.id === copy.id),
    ).toBe(true);
    expect((await getConversation(server, copy.id)).graphs).toHaveLength(3);
  });

  it('imports into another workspace, rewriting folder aliases', async () => {
    const ws2 = await createWorkspace(server, [otherProject]);
    const target = ws2.folders[0]!.alias;
    expect(target).not.toBe(alias());
    const res = await call<ImportResponse>(server, 'POST', '/api/import', {
      data: exported,
      workspaceId: ws2.id,
    });
    const body = expectStatus(res, 200);
    expect(body.workspace.id).toBe(ws2.id);
    const refs = body.conversations[0]!.graphs.flatMap(
      (g) => g.spec?.nodes.flatMap((n) => n.refs) ?? [],
    );
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((r) => r.folder === target)).toBe(true);

    // A bundle whose folder is mapped onto ws2's folder lands in ws2 as well.
    const bundle = (await call<WorkspaceBundle>(server, 'GET', `/api/workspaces/${ws.id}/export`))
      .json;
    const viaMap = await call<ImportResponse>(server, 'POST', '/api/import', {
      data: bundle,
      folderMap: { [alias()]: otherProject },
    });
    expect(expectStatus(viaMap, 200).workspace.id).toBe(ws2.id);
    expect(viaMap.json.conversations.length).toBe(bundle.conversations.length);
  });

  it('creates a workspace for unknown folders (paths may not exist here)', async () => {
    const before = log.events.length;
    const res = await call<ImportResponse>(server, 'POST', '/api/import', {
      data: exported,
      folderMap: { [alias()]: '/definitely/not/here/proj' },
      workspaceName: 'Imported project',
    });
    const body = expectStatus(res, 200);
    expect(body.workspace).toMatchObject({
      name: 'Imported project',
      folders: [{ alias: alias(), path: '/definitely/not/here/proj' }],
    });
    expect(
      log.events
        .slice(before)
        .some((e) => e.type === 'workspace.updated' && e.workspace.id === body.workspace.id),
    ).toBe(true);
    const listed = expectStatus(
      await call<{ workspaces: Workspace[] }>(server, 'GET', '/api/workspaces'),
      200,
    );
    expect(listed.workspaces.some((w) => w.id === body.workspace.id)).toBe(true);
  });

  it('rejects invalid import files', async () => {
    for (const data of [
      { format: 'nope' },
      'garbage',
      { format: 'codesplainer/conversation', version: 1 },
    ]) {
      const res = await call(server, 'POST', '/api/import', { data });
      expect(res.status).toBe(400);
      expect(res.json).toMatchObject({ error: { code: 'invalid_request' } });
    }
    const missingWs = await call(server, 'POST', '/api/import', {
      data: exported,
      workspaceId: 'nope',
    });
    expect(missingWs.status).toBe(404);
  });

  it('duplicates a conversation', async () => {
    const res = await call<Conversation>(
      server,
      'POST',
      `/api/conversations/${conv.id}/duplicate`,
      {},
    );
    const copy = expectStatus(res, 201);
    expect(copy.title).toBe(`${QUESTION} (copy)`);
    expect(copy.workspaceId).toBe(ws.id);
    expect(copy.id).not.toBe(conv.id);
    const [dq1, , df1] = copy.graphs as [GraphEntry, GraphEntry, GraphEntry];
    expect(dq1.id).not.toBe(q1.id);
    expect(parentIdOf(df1.origin)).toBe(dq1.id);
    expect(copy.graphs.every((g) => g.session === undefined)).toBe(true);
    const original = await getConversation(server, conv.id);
    expect(original.graphs.map((g) => g.id)).toEqual([q1.id, q2.id, f1.id]);
  });

  it('lists, renames and deletes conversations', async () => {
    const renamed = expectStatus(
      await call<Conversation>(server, 'PATCH', `/api/conversations/${conv.id}`, {
        title: 'Renamed',
      }),
      200,
    );
    expect(renamed.title).toBe('Renamed');
    const list = expectStatus(
      await call<{ conversations: ConversationSummary[] }>(
        server,
        'GET',
        `/api/conversations?workspaceId=${ws.id}`,
      ),
      200,
    ).conversations;
    expect(list[0]).toMatchObject({
      id: conv.id,
      title: 'Renamed',
      graphCount: 3,
      runningCount: 0,
    });
    expect(list[0]?.lastQuestion).toBe('What talks to what?');
    for (let i = 1; i < list.length; i++)
      expect(list[i - 1]!.updatedAt >= list[i]!.updatedAt).toBe(true);
    expect(list.every((c) => c.workspaceId === ws.id)).toBe(true);

    expect(
      expectStatus(await call(server, 'DELETE', `/api/conversations/${conv.id}`), 200),
    ).toEqual({ ok: true });
    expect((await call(server, 'GET', `/api/conversations/${conv.id}`)).status).toBe(404);
    expect(
      log
        .of('conversation.deleted')
        .some((e) => e.conversationId === conv.id && e.workspaceId === ws.id),
    ).toBe(true);
  });

  it('only ever moved statuses forward and updatedAt up', () => {
    const rank: Record<GraphStatus, number> = {
      queued: 0,
      running: 1,
      done: 2,
      error: 2,
      cancelled: 2,
    };
    const last = new Map<string, number>();
    for (const e of log.of('graph.updated')) {
      const key = `${e.conversationId}/${e.graph.id}`;
      const freshness = e.graph.attempt * 10 + rank[e.graph.status];
      expect(freshness).toBeGreaterThanOrEqual(last.get(key) ?? 0);
      last.set(key, freshness);
      expect(e.graph.session).toBeUndefined();
      expect(e.graph.activity).toEqual([]);
    }
    const updated = new Map<string, string>();
    for (const e of log.of('conversation.updated')) {
      const prev = updated.get(e.conversation.id);
      if (prev) expect(e.conversation.updatedAt > prev).toBe(true);
      updated.set(e.conversation.id, e.conversation.updatedAt);
    }
    expect(log.of('graph.activity').length).toBeGreaterThan(0);
  });
});
