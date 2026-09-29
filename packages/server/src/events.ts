/**
 * Server events: a typed in-process bus plus the SSE endpoint (GET /api/events).
 * Each SSE message is `event: <type>` + `data: <json of the whole event, type included>`.
 * `hello` is sent on connect and a `: ping` comment every 20 s keeps proxies from timing out.
 */
import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import {
  APP_VERSION,
  stripGraphEntry,
  summarizeConversation,
  type Conversation,
  type GraphEntry,
  type ServerEvent,
} from '@codesplainer/shared';

export type EventListener = (event: ServerEvent) => void;

export class EventBus {
  private readonly listeners = new Set<EventListener>();

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get size(): number {
    return this.listeners.size;
  }

  emit(event: ServerEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A broken listener (e.g. a closed socket) must not affect the others.
      }
    }
  }

  /** `graph.updated` with the SSE-safe payload (no activity, no session; a snapshot copy). */
  graphUpdated(conversationId: string, entry: GraphEntry): void {
    this.emit({
      type: 'graph.updated',
      conversationId,
      graph: structuredClone(stripGraphEntry(entry)),
    });
  }

  conversationUpdated(conversation: Conversation): void {
    this.emit({ type: 'conversation.updated', conversation: summarizeConversation(conversation) });
  }
}

export const PING_INTERVAL_MS = 20_000;
/** Drop a client whose socket buffer grows beyond this (it reconnects and refetches). */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export function formatSse(event: ServerEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Tracks open SSE responses so they can be ended on shutdown. */
export class SseHub {
  private readonly streams = new Set<ServerResponse>();

  add(res: ServerResponse): void {
    this.streams.add(res);
  }

  remove(res: ServerResponse): void {
    this.streams.delete(res);
  }

  get size(): number {
    return this.streams.size;
  }

  closeAll(): void {
    for (const res of this.streams) {
      try {
        res.end();
      } catch {
        // already closed
      }
    }
    this.streams.clear();
  }
}

export function registerEventRoutes(
  app: FastifyInstance,
  deps: { bus: EventBus; hub: SseHub; pingMs?: number },
): void {
  app.get('/api/events', (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders();
    // Optional chaining: injected test requests use a mock socket without these methods.
    request.raw.socket?.setNoDelay?.(true);
    request.raw.socket?.setKeepAlive?.(true);

    let open = true;
    const write = (chunk: string) => {
      if (!open || res.writableEnded || res.destroyed) return;
      res.write(chunk);
      if (res.writableLength > MAX_BUFFERED_BYTES) res.destroy();
    };
    write(formatSse({ type: 'hello', version: APP_VERSION, serverTime: new Date().toISOString() }));
    const off = deps.bus.on((event) => write(formatSse(event)));
    const ping = setInterval(() => write(': ping\n\n'), deps.pingMs ?? PING_INTERVAL_MS);
    ping.unref();
    deps.hub.add(res);

    const cleanup = () => {
      if (!open) return;
      open = false;
      clearInterval(ping);
      off();
      deps.hub.remove(res);
    };
    request.raw.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  });
}
