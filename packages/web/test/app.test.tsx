/**
 * Smoke tests of the whole shell against a fake server (fetch + EventSource stubs). They only
 * assert on elements the shell owns, so they keep working when the real graph/panels land.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultSettings,
  summarizeConversation,
  type Conversation,
  type GraphEntry,
  type ProviderInfo,
  type Workspace,
} from '@codesplainer/shared';
import { App } from '../src/App';
import { selectNode, useAppStore } from '../src/store';
import { initialDataState } from '../src/store/reducers';
import { stopEvents } from '../src/store/session';
import { initialUiState } from '../src/store/store';
import { conversation, graph, workspace } from './fixtures';

interface FakeServer {
  down: boolean;
  workspaces: Workspace[];
  conversations: Conversation[];
  providers: ProviderInfo[];
}

const provider = (id: ProviderInfo['id'], available: boolean): ProviderInfo => ({
  id,
  name: id === 'mock' ? 'Demo (offline)' : id,
  description: 'test provider',
  available,
  enabled: true,
  warnings: [],
  models: [],
  capabilities: { fork: false, structuredOutput: false, cost: false, streaming: false },
  experimental: false,
  ...(available ? {} : { reason: 'not on PATH' }),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installServer(server: FakeServer) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (server.down) throw new TypeError('Failed to fetch');
    const url = new URL(input, 'http://127.0.0.1');
    const method = init?.method ?? 'GET';
    const path = url.pathname;
    if (path === '/api/health') {
      return json({
        ok: true,
        name: 'Codesplainer',
        version: '0.1.0',
        dataDir: '/tmp/cs',
        pid: 1,
        platform: 'linux',
        homeDir: '/home/me',
        nativePicker: false,
      });
    }
    if (path === '/api/providers') return json({ providers: server.providers });
    if (path === '/api/settings') return json({ ...defaultSettings(), defaultProvider: 'mock' });
    if (path === '/api/workspaces' && method === 'GET')
      return json({ workspaces: server.workspaces });
    const ws = /^\/api\/workspaces\/([^/]+)$/.exec(path);
    if (ws) {
      const found = server.workspaces.find((w) => w.id === ws[1]);
      return found
        ? json(found)
        : json({ error: { code: 'not_found', message: 'No workspace' } }, 404);
    }
    if (/^\/api\/workspaces\/[^/]+\/overview$/.test(path)) {
      return json({
        workspaceId: 'w1',
        scannedAt: '2024-01-01T00:00:00.000Z',
        folders: [],
        totals: { files: 12, bytes: 2048 },
        languages: [{ language: 'TypeScript', files: 10, bytes: 2000 }],
      });
    }
    if (path === '/api/conversations' && method === 'GET') {
      const id = url.searchParams.get('workspaceId');
      return json({
        conversations: server.conversations
          .filter((c) => c.workspaceId === id)
          .map(summarizeConversation),
      });
    }
    const conv = /^\/api\/conversations\/([^/]+)$/.exec(path);
    if (conv) {
      const found = server.conversations.find((c) => c.id === conv[1]);
      return found
        ? json(found)
        : json({ error: { code: 'not_found', message: 'No conversation' } }, 404);
    }
    if (/\/activity$/.test(path)) return json({ activity: [] });
    const ask = /^\/api\/conversations\/([^/]+)\/ask$/.exec(path);
    if (ask && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as {
        question: string;
        origin: GraphEntry['origin'];
      };
      const created: GraphEntry = {
        id: `g-new-${server.conversations.length}`,
        origin: body.origin,
        question: body.question || 'Expand: API',
        status: 'queued',
        provider: 'mock',
        detail: 'balanced',
        warnings: [],
        createdAt: '2024-01-03T00:00:00.000Z',
        activity: [],
        attempt: 1,
      };
      server.conversations.find((c) => c.id === ask[1])?.graphs.push(created);
      return json({ graph: created });
    }
    return json({ error: { code: 'not_found', message: `No route ${method} ${path}` } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

describe('app shell', () => {
  let server: FakeServer;

  beforeEach(() => {
    server = {
      down: false,
      workspaces: [],
      conversations: [],
      providers: [provider('kiro', false), provider('mock', true)],
    };
    installServer(server);
    vi.stubGlobal('EventSource', FakeEventSource);
    if (!('ResizeObserver' in globalThis)) {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
    }
    useAppStore.setState({ ...initialDataState(), ...initialUiState() }, true);
    window.history.replaceState(null, '', '#/');
  });

  afterEach(() => {
    cleanup();
    stopEvents();
    vi.unstubAllGlobals();
  });

  it('shows the welcome hero on first run', async () => {
    render(<App />);
    expect(await screen.findByText('Understand any codebase, one diagram at a time.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add folders/ })).toBeTruthy();
    const agents = await screen.findByRole('region', { name: 'Agents on this machine' });
    expect(within(agents).getByText('not on PATH')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Default provider Demo \(offline\): ready/ }),
    ).toBeTruthy();
  });

  it('explains when the server is down', async () => {
    server.down = true;
    render(<App />);
    expect(await screen.findByText("Can't reach the Codesplainer server")).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry now/ })).toBeTruthy();
  });

  it('lists workspaces and opens the command palette with Ctrl+K', async () => {
    server.workspaces = [workspace('w1')];
    render(<App />);
    expect(await screen.findByText('Workspace w1')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(within(palette).getByText('Keyboard shortcuts')).toBeTruthy();
    fireEvent.keyDown(within(palette).getByRole('combobox'), { key: 'Escape' });
    await flush();
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('renders the workspace screen', async () => {
    server.workspaces = [workspace('w1')];
    server.conversations = [conversation('c1', [graph('g1')])];
    window.history.replaceState(null, '', '#/w/w1');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Workspace w1' })).toBeTruthy();
    expect(await screen.findByText('Conversation c1')).toBeTruthy();
    expect(screen.getByText('What is the high-level architecture?')).toBeTruthy();
  });

  it('renders a conversation and resolves the current diagram into the URL', async () => {
    server.workspaces = [workspace('w1')];
    server.conversations = [conversation('c1', [graph('g1'), graph('g2')])];
    window.history.replaceState(null, '', '#/w/w1/c/c1');
    render(<App />);
    expect(
      await screen.findByRole('button', { name: 'Conversation title: Conversation c1' }),
    ).toBeTruthy();
    expect(await screen.findByRole('tab', { name: /Outline/ })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeTruthy();
    await flush();
    expect(window.location.hash).toBe('#/w/w1/c/c1/g/g2');
    expect(useAppStore.getState().currentGraphId).toBe('g2');

    fireEvent.keyDown(window, { key: 'm' });
    await flush();
    expect(window.location.hash).toBe('#/w/w1/c/c1/g/g2?view=map');
    expect(useAppStore.getState().view).toBe('map');
  });

  it('expands the selected box with E, opens the new diagram, applies live updates', async () => {
    server.workspaces = [workspace('w1')];
    server.conversations = [conversation('c1', [graph('g1')])];
    window.history.replaceState(null, '', '#/w/w1/c/c1/g/g1');
    const fetchMock = installServer(server);
    render(<App />);
    expect(
      await screen.findByRole('button', { name: 'Conversation title: Conversation c1' }),
    ).toBeTruthy();
    await flush();
    act(() => selectNode('api'));
    expect(useAppStore.getState().rightPanel).toEqual({ type: 'node' });
    fireEvent.keyDown(window, { key: 'e' });
    await flush();
    const askCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/ask'));
    expect(JSON.parse(String(askCall?.[1]?.body))).toMatchObject({
      question: '',
      origin: { type: 'expand', parentGraphId: 'g1', nodeId: 'api', nodeLabel: 'API' },
      provider: 'mock',
      detail: 'balanced',
    });
    expect(window.location.hash).toBe('#/w/w1/c/c1/g/g-new-1');
    expect(useAppStore.getState().currentGraphId).toBe('g-new-1');
    // Box selection belongs to the previous diagram.
    expect(useAppStore.getState().rightPanel).toBeNull();

    const created = server.conversations[0]?.graphs.find((g) => g.id === 'g-new-1') as GraphEntry;
    act(() => {
      FakeEventSource.last?.emit('graph.updated', {
        conversationId: 'c1',
        graph: {
          ...created,
          status: 'done',
          spec: { ...graph('x').spec, title: 'Inside the API' },
        },
      });
    });
    await flush();
    expect(
      useAppStore.getState().conversation?.graphs.find((g) => g.id === 'g-new-1')?.status,
    ).toBe('done');
    expect(screen.getAllByText('Inside the API').length).toBeGreaterThan(0);
    // Viewed diagrams do not toast.
    expect(useAppStore.getState().toasts).toEqual([]);

    // Pressing E again on the same box of the parent opens the existing expansion.
    fireEvent.keyDown(window, { key: 'u' });
    await flush();
    expect(window.location.hash).toBe('#/w/w1/c/c1/g/g1');
    act(() => selectNode('api'));
    fireEvent.keyDown(window, { key: 'e' });
    await flush();
    expect(window.location.hash).toBe('#/w/w1/c/c1/g/g-new-1');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/ask'))).toHaveLength(1);
  });

  it('toasts when a diagram finishes in the background', async () => {
    server.workspaces = [workspace('w1')];
    const running = graph('g2', { status: 'running', spec: undefined });
    server.conversations = [conversation('c1', [graph('g1'), running])];
    window.history.replaceState(null, '', '#/w/w1/c/c1/g/g1');
    render(<App />);
    expect(
      await screen.findByRole('button', { name: 'Conversation title: Conversation c1' }),
    ).toBeTruthy();
    await flush();
    act(() => {
      FakeEventSource.last?.emit('graph.updated', {
        conversationId: 'c1',
        graph: { ...running, status: 'done', spec: { ...graph('y').spec, title: 'Background' } },
      });
    });
    await flush();
    expect(await screen.findByText('“Background” ready')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await flush();
    expect(window.location.hash).toBe('#/w/w1/c/c1/g/g2');
  });

  it('shows a not-found state for a missing conversation', async () => {
    server.workspaces = [workspace('w1')];
    window.history.replaceState(null, '', '#/w/w1/c/nope');
    render(<App />);
    expect(await screen.findByText('Conversation not found')).toBeTruthy();
  });
});
