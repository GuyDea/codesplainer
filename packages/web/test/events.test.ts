import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerEvent } from '@codesplainer/shared';
import { backoffDelay, connectEvents, parseServerEvent } from '../src/lib/events';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((e: Event) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    const event = new MessageEvent(type, {
      data: typeof data === 'string' ? data : JSON.stringify(data),
    });
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  open() {
    this.onopen?.(new Event('open'));
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
}

describe('parseServerEvent', () => {
  it('uses the payload type or the SSE event name', () => {
    expect(parseServerEvent('workspace.deleted', '{"workspaceId":"w1"}')).toEqual({
      type: 'workspace.deleted',
      workspaceId: 'w1',
    });
    expect(
      parseServerEvent('message', '{"type":"hello","version":"1","serverTime":"t"}')?.type,
    ).toBe('hello');
    expect(parseServerEvent('nope', '{}')).toBeNull();
    expect(parseServerEvent('hello', 'not json')).toBeNull();
    expect(parseServerEvent('hello', '[1]')).toBeNull();
  });
});

describe('connectEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const start = (extra: Partial<Parameters<typeof connectEvents>[0]> = {}) => {
    const events: ServerEvent[] = [];
    const states: string[] = [];
    const onReconnect = vi.fn();
    const client = connectEvents({
      onEvent: (e) => events.push(e),
      onStateChange: (s) => states.push(s),
      onReconnect,
      EventSourceImpl: FakeEventSource as unknown as new (url: string) => EventSource,
      random: () => 0.5,
      ...extra,
    });
    return { client, events, states, onReconnect };
  };

  it('dispatches typed events from /api/events', () => {
    const { events, states, onReconnect } = start();
    const es = FakeEventSource.instances[0] as FakeEventSource;
    expect(es.url).toBe('/api/events');
    es.open();
    es.emit('graph.deleted', { conversationId: 'c1', graphIds: ['g1'] });
    es.emit('settings.updated', 'garbage');
    expect(events).toEqual([{ type: 'graph.deleted', conversationId: 'c1', graphIds: ['g1'] }]);
    expect(states).toEqual(['open']);
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it('reconnects with backoff and reports the reconnect', () => {
    const { client, states, onReconnect } = start({ minDelayMs: 1000 });
    const first = FakeEventSource.instances[0] as FakeEventSource;
    first.open();
    first.fail();
    expect(first.closed).toBe(true);
    expect(states.at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    const second = FakeEventSource.instances[1] as FakeEventSource;
    second.fail();
    vi.advanceTimersByTime(1999);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    const third = FakeEventSource.instances[2] as FakeEventSource;
    third.emit('hello', { version: '1', serverTime: 'now' });
    expect(states.at(-1)).toBe('open');
    expect(onReconnect).toHaveBeenCalledOnce();
    client.close();
    expect(third.closed).toBe(true);
    expect(states.at(-1)).toBe('closed');
  });

  it('reconnectNow skips the wait; close stops retrying', () => {
    const { client } = start();
    (FakeEventSource.instances[0] as FakeEventSource).fail();
    client.reconnectNow();
    expect(FakeEventSource.instances).toHaveLength(2);
    client.close();
    (FakeEventSource.instances[1] as FakeEventSource).fail();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('caps the backoff', () => {
    expect(backoffDelay(0, 1000, 30_000, () => 0.5)).toBe(1000);
    expect(backoffDelay(3, 1000, 30_000, () => 0.5)).toBe(8000);
    expect(backoffDelay(20, 1000, 30_000, () => 0.5)).toBe(30_000);
    expect(backoffDelay(0, 1000, 30_000, () => 1)).toBe(1200);
  });
});
