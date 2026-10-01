/** Startup repair of interrupted diagrams and graceful shutdown. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Conversation, GraphEntry, Workspace } from '@codesplainer/shared';
import { silentLogger } from '../src/log';
import { ConversationStore } from '../src/storage/conversations';
import {
  ask,
  createConversation,
  createWorkspace,
  fakeProvider,
  getConversation,
  hang,
  makeProject,
  removeDir,
  startServer,
  tempDir,
  waitForGraph,
} from './support';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await removeDir(dir);
});

function entry(id: string, status: GraphEntry['status']): GraphEntry {
  return {
    id,
    origin: { type: 'question' },
    question: `Question ${id}`,
    status,
    provider: 'mock',
    detail: 'balanced',
    warnings: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    activity: [],
    attempt: 1,
    ...(status === 'done'
      ? {
          spec: {
            title: 'Done',
            kind: 'architecture',
            nodes: [{ id: 'a', label: 'A', kind: 'module', refs: [], expandable: true }],
            edges: [],
            groups: [],
          },
        }
      : {}),
  };
}

describe('startup repair', () => {
  it('marks diagrams left queued/running by a previous process as interrupted', async () => {
    const dataDir = await tempDir('cs-data-');
    dirs.push(dataDir);
    const now = new Date().toISOString();
    const workspace: Workspace = {
      id: 'w1',
      name: 'W',
      folders: [{ alias: 'w', path: dataDir }],
      createdAt: now,
      updatedAt: now,
    };
    const conversation: Conversation = {
      id: 'c1',
      title: 'Old',
      workspaceId: 'w1',
      createdAt: now,
      updatedAt: now,
      graphs: [entry('g1', 'queued'), entry('g2', 'running'), entry('g3', 'done')],
    };
    await writeFile(
      join(dataDir, 'workspaces.json'),
      JSON.stringify({ version: 1, workspaces: [workspace] }),
    );
    await mkdir(join(dataDir, 'conversations'), { recursive: true });
    await writeFile(join(dataDir, 'conversations', 'c1.json'), JSON.stringify(conversation));

    const server = await startServer({ dataDir });
    const conv = await getConversation(server, 'c1');
    expect(conv.graphs.map((g) => [g.status, g.error])).toEqual([
      ['error', 'Interrupted (server restarted)'],
      ['error', 'Interrupted (server restarted)'],
      ['done', undefined],
    ]);
    expect(conv.graphs[0]?.completedAt).toBeDefined();
    expect(conv.updatedAt > now).toBe(true);
    await server.close();

    const onDisk = JSON.parse(
      await readFile(join(dataDir, 'conversations', 'c1.json'), 'utf8'),
    ) as Conversation;
    expect(onDisk.graphs.map((g) => g.status)).toEqual(['error', 'error', 'done']);
  });
});

describe('shutdown', () => {
  it('cancels running jobs ("Server stopped"), stops agents and saves everything', async () => {
    const project = await makeProject();
    dirs.push(project);
    const claude = fakeProvider('claude');
    claude.behave(hang);
    const server = await startServer({ fakes: { claude } });
    dirs.push(server.dataDir);
    const ws = await createWorkspace(server, [project]);
    const conv = await createConversation(server, ws.id);
    const running = await ask(server, conv.id, {
      question: 'Long',
      origin: { type: 'question' },
      provider: 'claude',
    });
    const queued = await ask(server, conv.id, {
      question: 'Also long',
      origin: { type: 'question' },
      provider: 'claude',
    });
    const third = await ask(server, conv.id, {
      question: 'Queued',
      origin: { type: 'question' },
      provider: 'claude',
    });
    await waitForGraph(server, conv.id, queued.id, (g) => g.status === 'running');
    expect(third.status).toBe('queued');

    await Promise.all([server.close(), server.close()]);
    expect((server.ctx.registry as unknown as { disposed: number }).disposed).toBe(1);
    expect(claude.requests.every((r) => r.signal.aborted)).toBe(true);

    const store = await ConversationStore.open(server.dataDir, silentLogger);
    const saved = store.get(conv.id)!;
    expect(saved.graphs.map((g) => [g.id, g.status, g.error])).toEqual([
      [running.id, 'cancelled', 'Server stopped'],
      [queued.id, 'cancelled', 'Server stopped'],
      [third.id, 'cancelled', 'Server stopped'],
    ]);

    // The next start leaves them alone (they are no longer pending).
    const next = await startServer({ dataDir: server.dataDir });
    const reloaded = await getConversation(next, conv.id);
    expect(
      reloaded.graphs.every((g) => g.status === 'cancelled' && g.error === 'Server stopped'),
    ).toBe(true);
    await next.close();
  });

  it('refuses new questions while shutting down', async () => {
    const project = await makeProject();
    dirs.push(project);
    const server = await startServer();
    dirs.push(server.dataDir);
    const ws = await createWorkspace(server, [project]);
    const conv = await createConversation(server, ws.id);
    server.ctx.generation.shutdown();
    await expect(
      server.ctx.generation.ask(conv.id, {
        question: 'x',
        origin: { type: 'question' },
        provider: 'mock',
      }),
    ).rejects.toMatchObject({ status: 503, code: 'shutting_down' });
    await server.close();
  });
});
