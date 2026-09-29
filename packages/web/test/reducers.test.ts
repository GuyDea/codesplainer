import { describe, expect, it } from 'vitest';
import { defaultSettings, type ActivityItem } from '@codesplainer/shared';
import {
  applyFetchedConversation,
  applyFetchedSummaries,
  applyFetchedWorkspaces,
  applyGraphResponse,
  graphFreshness,
  mergeActivity,
  mergePatch,
  reduceEvent,
} from '../src/store/reducers';
import { conversation, dataState, graph, summary, workspace } from './fixtures';

const item = (ts: string, text: string): ActivityItem => ({ ts, kind: 'tool', text });

describe('graph.updated', () => {
  it('upserts into the current conversation', () => {
    const state = dataState({
      conversationId: 'c1',
      conversation: conversation('c1', [graph('g1')]),
    });
    const { state: next } = reduceEvent(state, {
      type: 'graph.updated',
      conversationId: 'c1',
      graph: graph('g2', { status: 'queued' }),
    });
    expect(next.conversation?.graphs.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(next.sync.touched['g:g2']).toBe(next.sync.seq);
  });

  it('ignores other conversations', () => {
    const state = dataState({ conversationId: 'c1', conversation: conversation('c1', []) });
    const { state: next } = reduceEvent(state, {
      type: 'graph.updated',
      conversationId: 'other',
      graph: graph('g2'),
    });
    expect(next).toBe(state);
  });

  it('buffers events while the conversation is still loading', () => {
    const state = dataState({ conversationId: 'c1', conversation: null });
    const { state: next } = reduceEvent(state, {
      type: 'graph.updated',
      conversationId: 'c1',
      graph: graph('g1', { status: 'running' }),
    });
    expect(next.pendingGraphs.map((g) => g.id)).toEqual(['g1']);
  });

  it('ignores stale copies (status never goes backwards) but accepts retries', () => {
    const state = dataState({
      conversationId: 'c1',
      conversation: conversation('c1', [graph('g1', { status: 'done' })]),
    });
    const stale = reduceEvent(state, {
      type: 'graph.updated',
      conversationId: 'c1',
      graph: graph('g1', { status: 'running', spec: undefined }),
    }).state;
    expect(stale.conversation?.graphs[0]?.status).toBe('done');

    const retried = reduceEvent(state, {
      type: 'graph.updated',
      conversationId: 'c1',
      graph: graph('g1', { status: 'queued', attempt: 2, spec: undefined }),
    }).state;
    expect(retried.conversation?.graphs[0]?.status).toBe('queued');
    expect(graphFreshness({ attempt: 2, status: 'queued' })).toBeGreaterThan(
      graphFreshness({ attempt: 1, status: 'error' }),
    );
  });

  it('forgets the live log of the previous attempt on retry', () => {
    const state = dataState({
      conversationId: 'c1',
      conversation: conversation('c1', [graph('g1', { status: 'error', spec: undefined })]),
      activity: { g1: [item('t1', 'old attempt')] },
    });
    const retried = reduceEvent(state, {
      type: 'graph.updated',
      conversationId: 'c1',
      graph: graph('g1', { status: 'queued', attempt: 2, spec: undefined }),
    }).state;
    expect(retried.activity.g1).toBeUndefined();
    const viaResponse = applyGraphResponse(
      state,
      'c1',
      graph('g1', { status: 'queued', attempt: 2 }),
    );
    expect(viaResponse.activity.g1).toBeUndefined();
  });

  it('keeps local activity when the event carries none', () => {
    const state = dataState({
      conversationId: 'c1',
      conversation: conversation('c1', [
        graph('g1', { status: 'running', activity: [item('t1', 'read')] }),
      ]),
    });
    const next = reduceEvent(state, {
      type: 'graph.updated',
      conversationId: 'c1',
      graph: graph('g1', { status: 'done', activity: [] }),
    }).state;
    expect(next.conversation?.graphs[0]?.activity).toHaveLength(1);
  });

  it('reports diagrams that finished', () => {
    const state = dataState({
      conversationId: 'c1',
      conversation: conversation('c1', [graph('g1', { status: 'running', spec: undefined })]),
    });
    const { effects } = reduceEvent(state, {
      type: 'graph.updated',
      conversationId: 'c1',
      graph: graph('g1', { status: 'done' }),
    });
    expect(effects).toEqual([
      expect.objectContaining({ type: 'graph-finished', previousStatus: 'running' }),
    ]);
  });
});

describe('graph.activity / graph.deleted', () => {
  it('appends activity once', () => {
    const state = dataState({ conversationId: 'c1' });
    const event = {
      type: 'graph.activity',
      conversationId: 'c1',
      graphId: 'g1',
      item: item('t1', 'x'),
    } as const;
    const once = reduceEvent(state, event).state;
    const twice = reduceEvent(once, event).state;
    expect(twice.activity.g1).toHaveLength(1);
    const other = reduceEvent(state, { ...event, conversationId: 'c2' }).state;
    expect(other.activity.g1).toBeUndefined();
  });

  it('removes deleted graphs and ignores late updates for them', () => {
    const state = dataState({
      conversationId: 'c1',
      conversation: conversation('c1', [graph('g1'), graph('g2')]),
      activity: { g2: [item('t', 'x')] },
    });
    const deleted = reduceEvent(state, {
      type: 'graph.deleted',
      conversationId: 'c1',
      graphIds: ['g2'],
    });
    expect(deleted.state.conversation?.graphs.map((g) => g.id)).toEqual(['g1']);
    expect(deleted.state.activity.g2).toBeUndefined();
    expect(deleted.effects[0]).toEqual({
      type: 'graphs-deleted',
      conversationId: 'c1',
      graphIds: ['g2'],
    });
    const late = reduceEvent(deleted.state, {
      type: 'graph.updated',
      conversationId: 'c1',
      graph: graph('g2'),
    }).state;
    expect(late.conversation?.graphs.map((g) => g.id)).toEqual(['g1']);
  });
});

describe('conversation / workspace / providers / settings events', () => {
  it('upserts summaries of the listed workspace, newest first, and syncs the title', () => {
    const state = dataState({
      conversationsWorkspaceId: 'w1',
      conversations: [summary('a', { updatedAt: '2024-01-02T00:00:00.000Z' })],
      conversationId: 'b',
      conversation: conversation('b', []),
    });
    const next = reduceEvent(state, {
      type: 'conversation.updated',
      conversation: summary('b', { title: 'Renamed', updatedAt: '2024-01-03T00:00:00.000Z' }),
    }).state;
    expect(next.conversations.map((c) => c.id)).toEqual(['b', 'a']);
    expect(next.conversation?.title).toBe('Renamed');

    const otherWs = reduceEvent(state, {
      type: 'conversation.updated',
      conversation: summary('z', { workspaceId: 'w2' }),
    }).state;
    expect(otherWs.conversations.map((c) => c.id)).toEqual(['a']);
  });

  it('ignores older summaries', () => {
    const state = dataState({
      conversationsWorkspaceId: 'w1',
      conversations: [summary('a', { title: 'New', updatedAt: '2024-01-05T00:00:00.000Z' })],
    });
    const next = reduceEvent(state, {
      type: 'conversation.updated',
      conversation: summary('a', { title: 'Old', updatedAt: '2024-01-01T00:00:00.000Z' }),
    }).state;
    expect(next.conversations[0]?.title).toBe('New');
  });

  it('removes deleted conversations and workspaces', () => {
    const state = dataState({
      workspaces: [workspace('w1'), workspace('w2')],
      conversationsWorkspaceId: 'w1',
      conversations: [summary('a'), summary('b')],
    });
    const c = reduceEvent(state, {
      type: 'conversation.deleted',
      conversationId: 'a',
      workspaceId: 'w1',
    });
    expect(c.state.conversations.map((x) => x.id)).toEqual(['b']);
    expect(c.effects[0]?.type).toBe('conversation-deleted');
    const w = reduceEvent(c.state, { type: 'workspace.deleted', workspaceId: 'w1' });
    expect(w.state.workspaces.map((x) => x.id)).toEqual(['w2']);
    expect(w.state.conversations).toEqual([]);
    const late = reduceEvent(w.state, {
      type: 'workspace.updated',
      workspace: workspace('w1'),
    }).state;
    expect(late.workspaces.map((x) => x.id)).toEqual(['w2']);
  });

  it('replaces providers and re-applies pending settings edits', () => {
    const state = dataState({ settingsPending: { detail: 'detailed' } });
    const server = { ...defaultSettings(), detail: 'simple' as const, theme: 'dark' as const };
    const next = reduceEvent(state, { type: 'settings.updated', settings: server }).state;
    expect(next.settings?.detail).toBe('detailed');
    expect(next.settings?.theme).toBe('dark');
    const providers = reduceEvent(state, { type: 'providers.updated', providers: [] }).state;
    expect(providers.providers).toEqual([]);
  });
});

describe('fetched snapshots vs live events', () => {
  it('prefers events that arrived during the fetch when they are fresher', () => {
    let state = dataState({
      conversationId: 'c1',
      conversation: conversation('c1', [graph('g1', { status: 'running', spec: undefined })]),
    });
    const since = state.sync.seq;
    state = reduceEvent(state, {
      type: 'graph.updated',
      conversationId: 'c1',
      graph: graph('g1', { status: 'done' }),
    }).state;
    const fetched = conversation('c1', [graph('g1', { status: 'running', spec: undefined })]);
    const next = applyFetchedConversation(state, fetched, since);
    expect(next.conversation?.graphs[0]?.status).toBe('done');
  });

  it('takes the snapshot for untouched graphs, keeps graphs created meanwhile, drops deleted ones', () => {
    let state = dataState({
      conversationId: 'c1',
      conversation: conversation('c1', [
        graph('g1', { status: 'running', spec: undefined }),
        graph('g2'),
      ]),
    });
    const since = state.sync.seq;
    state = reduceEvent(state, {
      type: 'graph.updated',
      conversationId: 'c1',
      graph: graph('g3'),
    }).state;
    state = reduceEvent(state, {
      type: 'graph.deleted',
      conversationId: 'c1',
      graphIds: ['g2'],
    }).state;
    const fetched = conversation('c1', [graph('g1', { status: 'done' }), graph('g2')], {
      title: 'Fresh',
    });
    const next = applyFetchedConversation(state, fetched, since);
    expect(next.conversation?.graphs.map((g) => `${g.id}:${g.status}`)).toEqual([
      'g1:done',
      'g3:done',
    ]);
    expect(next.conversation?.title).toBe('Fresh');
  });

  it('merges events buffered before the first load', () => {
    let state = dataState({ conversationId: 'c1', conversation: null });
    const since = state.sync.seq;
    state = reduceEvent(state, {
      type: 'graph.updated',
      conversationId: 'c1',
      graph: graph('g1', { status: 'done' }),
    }).state;
    const next = applyFetchedConversation(
      state,
      conversation('c1', [graph('g1', { status: 'running' })]),
      since,
    );
    expect(next.conversation?.graphs[0]?.status).toBe('done');
    expect(next.pendingGraphs).toEqual([]);
  });

  it('ignores a snapshot of a conversation the user left', () => {
    const state = dataState({ conversationId: 'c2' });
    expect(applyFetchedConversation(state, conversation('c1', []), 0)).toBe(state);
  });

  it('seeds activity from the snapshot', () => {
    const state = dataState({ conversationId: 'c1', activity: { g1: [item('t2', 'live')] } });
    const fetched = conversation('c1', [
      graph('g1', { activity: [item('t1', 'old'), item('t2', 'live')] }),
    ]);
    const next = applyFetchedConversation(state, fetched, 0);
    expect(next.activity.g1?.map((a) => a.text)).toEqual(['old', 'live']);
  });

  it('merges summaries and workspaces lists', () => {
    let state = dataState({ conversationsWorkspaceId: 'w1', conversations: [] });
    const since = state.sync.seq;
    state = reduceEvent(state, {
      type: 'conversation.updated',
      conversation: summary('new', { updatedAt: '2024-02-01T00:00:00.000Z' }),
    }).state;
    const merged = applyFetchedSummaries(state, 'w1', [summary('old')], since);
    expect(merged.conversations.map((c) => c.id)).toEqual(['new', 'old']);
    expect(applyFetchedSummaries(state, 'w2', [summary('x')], since)).toBe(state);

    const ws = applyFetchedWorkspaces(
      dataState({ workspaces: [workspace('gone')] }),
      [workspace('w1')],
      0,
    );
    expect(ws.workspaces.map((w) => w.id)).toEqual(['w1']);
  });

  it('applies mutation responses to the right place', () => {
    const loaded = dataState({ conversationId: 'c1', conversation: conversation('c1', []) });
    expect(applyGraphResponse(loaded, 'c1', graph('g1')).conversation?.graphs).toHaveLength(1);
    const loading = dataState({ conversationId: 'c1' });
    expect(applyGraphResponse(loading, 'c1', graph('g1')).pendingGraphs).toHaveLength(1);
    expect(applyGraphResponse(loaded, 'c9', graph('g1'))).toBe(loaded);
  });
});

describe('helpers', () => {
  it('merges activity logs without duplicates, ordered by time', () => {
    const merged = mergeActivity(
      [item('3', 'c'), item('1', 'a')],
      [item('1', 'a'), item('2', 'b')],
    );
    expect(merged.map((a) => a.text)).toEqual(['a', 'b', 'c']);
  });

  it('deep-merges settings patches', () => {
    const patch = mergePatch(
      { detail: 'simple', providers: { claude: { model: 'opus' } }, acp: { command: 'a' } },
      {
        providers: { claude: { effort: 'high' }, codex: { enabled: false } },
        acp: { args: ['x'] },
      },
    );
    expect(patch).toEqual({
      detail: 'simple',
      providers: { claude: { model: 'opus', effort: 'high' }, codex: { enabled: false } },
      acp: { command: 'a', args: ['x'] },
    });
  });
});
