/**
 * Live server events (GET /api/events, text/event-stream). Typed dispatch of ServerEvent,
 * reconnect with exponential backoff + jitter, and an `onReconnect` hook so callers can refetch
 * whatever they display (events missed while disconnected are not replayed).
 */
import { SERVER_EVENT_TYPES, type ServerEvent, type ServerEventType } from '@codesplainer/shared';
import { API_BASE } from './api';

export type EventConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface EventClientOptions {
  onEvent: (event: ServerEvent) => void;
  onStateChange?: (state: EventConnectionState) => void;
  /** Called when the stream is open again after an error (not on the very first connect). */
  onReconnect?: () => void;
  url?: string;
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests. */
  EventSourceImpl?: new (url: string) => EventSource;
  random?: () => number;
}

export interface EventClient {
  readonly state: EventConnectionState;
  /** Skip the backoff wait (e.g. when the tab becomes visible or the network comes back). */
  reconnectNow(): void;
  close(): void;
}

const KNOWN_TYPES = new Set<string>(SERVER_EVENT_TYPES);

/** Exponential backoff with ±20 % jitter. `attempt` starts at 0. */
export function backoffDelay(
  attempt: number,
  minDelayMs = 1000,
  maxDelayMs = 30_000,
  random: () => number = Math.random,
): number {
  const base = Math.min(maxDelayMs, minDelayMs * 2 ** Math.max(0, Math.min(attempt, 16)));
  return Math.round(base * (0.8 + 0.4 * random()));
}

/**
 * Parse one SSE message. The payload may or may not repeat the event type; the SSE `event:` name
 * is used when it does not. Unknown types and malformed JSON are ignored (null).
 */
export function parseServerEvent(sseType: string, data: string): ServerEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const inner = (json as { type?: unknown }).type;
  const type = typeof inner === 'string' && KNOWN_TYPES.has(inner) ? inner : sseType;
  if (!KNOWN_TYPES.has(type)) return null;
  return { ...(json as object), type: type as ServerEventType } as ServerEvent;
}

export function connectEvents(options: EventClientOptions): EventClient {
  const url = options.url ?? `${API_BASE}/events`;
  const minDelay = options.minDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 30_000;
  const Impl = options.EventSourceImpl ?? globalThis.EventSource;

  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let closed = false;
  let failedBefore = false;
  let state: EventConnectionState = 'connecting';

  const setState = (next: EventConnectionState) => {
    if (state === next) return;
    state = next;
    options.onStateChange?.(next);
  };

  const markOpen = () => {
    if (closed || state === 'open') return;
    attempt = 0;
    setState('open');
    if (failedBefore) options.onReconnect?.();
  };

  const scheduleReconnect = () => {
    if (closed) return;
    failedBefore = true;
    setState('reconnecting');
    clearTimeout(timer);
    timer = setTimeout(open, backoffDelay(attempt, minDelay, maxDelay, options.random));
    attempt++;
  };

  function open() {
    if (closed) return;
    clearTimeout(timer);
    timer = undefined;
    let es: EventSource;
    try {
      es = new Impl(url);
    } catch {
      scheduleReconnect();
      return;
    }
    source = es;
    const listener = (sseType: string) => (message: Event) => {
      if (source !== es) return;
      const data = (message as MessageEvent<unknown>).data;
      if (typeof data !== 'string') return;
      const event = parseServerEvent(sseType, data);
      if (!event) return;
      markOpen();
      options.onEvent(event);
    };
    for (const type of SERVER_EVENT_TYPES) es.addEventListener(type, listener(type));
    es.addEventListener('message', listener('message'));
    es.onopen = () => {
      if (source === es) markOpen();
    };
    es.onerror = () => {
      if (source !== es) return;
      es.close();
      source = null;
      scheduleReconnect();
    };
  }

  open();

  return {
    get state() {
      return state;
    },
    reconnectNow() {
      if (closed || state === 'open') return;
      if (source) return; // an attempt is already in flight
      attempt = 0;
      open();
    },
    close() {
      closed = true;
      clearTimeout(timer);
      source?.close();
      source = null;
      setState('closed');
    },
  };
}
