/** GET /api/events over a real socket. */
import { get, type ClientRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_VERSION, SERVER_EVENT_TYPES, type ServerEvent } from '@codesplainer/shared';
import { EventBus, SseHub, formatSse, registerEventRoutes } from '../src/events';
import {
  ask,
  createConversation,
  createWorkspace,
  makeProject,
  removeDir,
  startServer,
  waitFor,
  type TestServer,
} from './support';

interface SseMessage {
  event?: string;
  data?: string;
  comment?: string;
}

interface Stream {
  req: ClientRequest;
  res: IncomingMessage;
  messages: SseMessage[];
  ended: Promise<void>;
  /** Wait for a message matching `pred` (already received ones count). */
  next(pred: (m: SseMessage) => boolean): Promise<SseMessage>;
  close(): void;
}

function openStream(port: number, headers: Record<string, string> = {}): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const req = get({ host: '127.0.0.1', port, path: '/api/events', headers }, (res) => {
      res.setEncoding('utf8');
      const messages: SseMessage[] = [];
      let buffer = '';
      res.on('data', (chunk: string) => {
        buffer += chunk;
        for (let idx = buffer.indexOf('\n\n'); idx >= 0; idx = buffer.indexOf('\n\n')) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const msg: SseMessage = {};
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) msg.comment = line.slice(1).trim();
            else if (line.startsWith('event: ')) msg.event = line.slice('event: '.length);
            else if (line.startsWith('data: ')) msg.data = line.slice('data: '.length);
          }
          messages.push(msg);
        }
      });
      const ended = new Promise<void>((done) => {
        res.on('end', done);
        res.on('close', done);
      });
      resolve({
        req,
        res,
        messages,
        ended,
        next: (pred) => waitFor(() => messages.find(pred), 5_000, 5),
        close: () => req.destroy(),
      });
    });
    req.on('error', reject);
  });
}

const parse = (m: SseMessage) => JSON.parse(m.data ?? 'null') as ServerEvent;

let server: TestServer;
let port: number;
let project: string;

beforeAll(async () => {
  project = await makeProject();
  server = await startServer();
  await server.app.listen({ port: 0, host: '127.0.0.1' });
  port = (server.app.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await server.close();
  await removeDir(server.dataDir);
  await removeDir(project);
});

describe('server-sent events', () => {
  it('sends hello, then live events for a run', async () => {
    const stream = await openStream(port);
    try {
      expect(stream.res.statusCode).toBe(200);
      expect(stream.res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      expect(stream.res.headers['cache-control']).toContain('no-cache');
      expect(stream.res.headers['x-accel-buffering']).toBe('no');
      expect(stream.res.headers['access-control-allow-origin']).toBeUndefined();

      const hello = await stream.next((m) => m.event === 'hello');
      expect(stream.messages[0]).toBe(hello);
      expect(parse(hello)).toMatchObject({
        type: 'hello',
        version: APP_VERSION,
        serverTime: expect.any(String),
      });

      const ws = await createWorkspace(server, [project]);
      const conv = await createConversation(server, ws.id);
      const graph = await ask(server, conv.id, {
        question: 'Live?',
        origin: { type: 'question' },
        provider: 'mock',
      });

      const updated = await stream.next((m) => m.event === 'graph.updated');
      const event = parse(updated);
      expect(event).toMatchObject({
        type: 'graph.updated',
        conversationId: conv.id,
        graph: { id: graph.id },
      });
      if (event.type === 'graph.updated') {
        expect(event.graph.activity).toEqual([]);
        expect(event.graph.session).toBeUndefined();
      }
      const doneMsg = await stream.next((m) => {
        if (m.event !== 'graph.updated') return false;
        const e = parse(m);
        return e.type === 'graph.updated' && e.graph.status === 'done';
      });
      expect(parse(doneMsg)).toMatchObject({ graph: { id: graph.id, status: 'done' } });
      await stream.next((m) => m.event === 'graph.activity');
      await stream.next((m) => m.event === 'workspace.updated');
      await stream.next((m) => m.event === 'conversation.updated');

      // Every message is a known event type whose payload repeats the type.
      for (const m of stream.messages) {
        if (m.comment !== undefined) continue;
        expect(SERVER_EVENT_TYPES).toContain(m.event);
        expect(parse(m).type).toBe(m.event);
      }
    } finally {
      stream.close();
    }
  });

  it('drops listeners when the client disconnects', async () => {
    // The stream of the previous test is cleaned up asynchronously.
    await waitFor(() => server.ctx.bus.size === 0 && server.ctx.hub.size === 0);
    const before = server.ctx.bus.size;
    const stream = await openStream(port);
    await stream.next((m) => m.event === 'hello');
    expect(server.ctx.bus.size).toBe(before + 1);
    expect(server.ctx.hub.size).toBeGreaterThanOrEqual(1);
    stream.close();
    await waitFor(() => server.ctx.bus.size === before && server.ctx.hub.size === 0);
  });

  it('rejects foreign hosts and origins', async () => {
    const badHost = await openStream(port, { host: 'evil.example.com' });
    expect(badHost.res.statusCode).toBe(403);
    await badHost.ended;
    const badOrigin = await openStream(port, { origin: 'http://evil.example.com' });
    expect(badOrigin.res.statusCode).toBe(403);
    await badOrigin.ended;
  });

  it('ends open streams on shutdown', async () => {
    const other = await startServer();
    await other.app.listen({ port: 0, host: '127.0.0.1' });
    const otherPort = (other.app.server.address() as AddressInfo).port;
    const stream = await openStream(otherPort);
    await stream.next((m) => m.event === 'hello');
    await other.close();
    await stream.ended;
    await removeDir(other.dataDir);
  });
});

describe('SSE route internals', () => {
  it('formats events and sends heartbeat comments', async () => {
    expect(formatSse({ type: 'workspace.deleted', workspaceId: 'w' })).toBe(
      'event: workspace.deleted\ndata: {"type":"workspace.deleted","workspaceId":"w"}\n\n',
    );
    const app = Fastify();
    const bus = new EventBus();
    const hub = new SseHub();
    registerEventRoutes(app, { bus, hub, pingMs: 20 });
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const stream = await openStream((app.server.address() as AddressInfo).port);
      await stream.next((m) => m.comment === 'ping');
      bus.emit({ type: 'workspace.deleted', workspaceId: 'w1' });
      const msg = await stream.next((m) => m.event === 'workspace.deleted');
      expect(parse(msg)).toEqual({ type: 'workspace.deleted', workspaceId: 'w1' });
      stream.close();
      await waitFor(() => bus.size === 0 && hub.size === 0);
    } finally {
      hub.closeAll();
      await app.close();
    }
  });
});
